import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type DatabaseClient,
  DuelStatus as DatabaseDuelStatus,
  DuelMode,
  type DuelTransactionAction,
  type DuelTransactionStatus,
  type Prisma,
  ProviderMode,
} from '@openpacksduel/db';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import type {
  Duel,
  DuelEvent,
  DuelStatus,
  DuelTransactionRecord,
  MatchmakingMode,
  Page,
} from '../domain.js';
import type { ListDuelsQuery } from './duel.dto.js';
import {
  type CreateDuelRecord,
  DuelRepository,
  type TransactionClient,
  type TransitionDuelRecord,
} from './duel.repository.js';

const ACTIVE_TIMEOUT_STATUSES = new Set<DatabaseDuelStatus>([
  DatabaseDuelStatus.WAITING,
  DatabaseDuelStatus.MATCHED,
]);
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class PrismaDuelRepository extends DuelRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {
    super();
  }

  async findAll(query: ListDuelsQuery): Promise<Page<Duel>> {
    const cursor = query.cursor
      ? await this.database.duel.findUnique({ where: { id: query.cursor } })
      : null;
    if (query.cursor && (!cursor || !matchesQuery(cursor, query))) {
      throw new BadRequestException('cursor does not identify a visible duel');
    }

    const rows = await this.database.duel.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      where: {
        ...(query.matchmakingMode ? { mode: toDatabaseMode(query.matchmakingMode) } : {}),
        ...(query.packId ? { packId: query.packId } : {}),
        ...(query.status ? { status: toDatabaseStatus(query.status as DuelStatus) } : {}),
        ...(query.wallet
          ? {
              OR: [
                { creatorWallet: query.wallet },
                { opponentWallet: query.wallet },
                { winnerWallet: query.wallet },
              ],
            }
          : {}),
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
    });
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      data: visible.map(toDuel),
      hasMore,
      nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  async findOne(duelId: string): Promise<Duel | null> {
    const row = await this.database.duel.findUnique({ where: { id: duelId } });
    return row ? toDuel(row) : null;
  }

  async create(
    input: CreateDuelRecord,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<Duel> {
    const scope = 'duels:create';
    const replay = await this.replay(scope, idempotencyKey, requestHash);
    if (replay) return replay;

    try {
      const row = await this.database.$transaction(async (transaction) => {
        const created = await transaction.duel.create({
          data: {
            creatorWallet: input.creatorWallet,
            expiresAt: input.expiresAt,
            houseOpponent: input.houseOpponent,
            id: input.id,
            mode: toDatabaseMode(input.matchmakingMode),
            ...(input.opponentJoinedAt
              ? { matchedAt: input.opponentJoinedAt, opponentJoinedAt: input.opponentJoinedAt }
              : {}),
            ...(input.opponentWallet ? { opponentWallet: input.opponentWallet } : {}),
            packId: input.pack.id,
            packName: input.pack.name,
            packProvider: input.pack.provider,
            providerMode: toDatabaseProviderMode(input.providerMode),
            ...(input.pack.providerPackId ? { providerPackId: input.pack.providerPackId } : {}),
            stakeAmount: input.pack.price.amount,
            stakeCurrency: input.pack.price.currency,
            stakeDecimals: input.pack.price.decimals,
            status: input.houseOpponent ? DatabaseDuelStatus.MATCHED : DatabaseDuelStatus.WAITING,
            ...(input.pack.valuationPolicyHash
              ? { valuationPolicyHash: input.pack.valuationPolicyHash }
              : {}),
          },
        });
        await transaction.duelEvent.create({
          data: {
            data: { environment: 'solana-devnet', houseOpponent: input.houseOpponent },
            duelId: created.id,
            id: createId('evt'),
            sequence: 1,
            toStatus: created.status,
            type: 'duel.created',
          },
        });
        await this.storeIdempotency(
          transaction,
          scope,
          idempotencyKey,
          requestHash,
          created.id,
          201,
        );
        return created;
      });
      return toDuel(row);
    } catch (error) {
      const concurrentReplay = await this.replay(scope, idempotencyKey, requestHash);
      if (concurrentReplay) return concurrentReplay;
      throw error;
    }
  }

  async join(
    duelId: string,
    wallet: string,
    idempotencyKey: string,
    requestHash: string,
    now: Date,
  ): Promise<Duel> {
    const scope = `duels:${duelId}:join`;
    const replay = await this.replay(scope, idempotencyKey, requestHash);
    if (replay) return replay;

    try {
      const row = await this.database.$transaction(async (transaction) => {
        const duel = await transaction.duel.findUnique({ where: { id: duelId } });
        if (!duel) throw new NotFoundException(`Duel ${duelId} was not found`);
        if (duel.expiresAt <= now) throw new ConflictException('Duel has expired');
        if (duel.mode === DuelMode.HOUSE)
          throw new ConflictException('House duels are matched at creation');
        if (duel.creatorWallet === wallet)
          throw new ConflictException('A wallet cannot duel itself');
        if (duel.status !== DatabaseDuelStatus.WAITING) {
          throw new ConflictException(`Duel cannot be joined from ${duel.status.toLowerCase()}`);
        }
        if (duel.mode === DuelMode.DIRECT && duel.opponentWallet !== wallet) {
          throw new ConflictException('Only the invited wallet can join this duel');
        }

        const updated = await transaction.duel.updateMany({
          data: {
            matchedAt: now,
            opponentJoinedAt: now,
            ...(duel.mode === DuelMode.OPEN ? { opponentWallet: wallet } : {}),
            status: DatabaseDuelStatus.MATCHED,
            version: { increment: 1 },
          },
          where: { id: duel.id, status: DatabaseDuelStatus.WAITING, version: duel.version },
        });
        if (updated.count !== 1) throw new ConflictException('Duel was joined by another wallet');
        await transaction.duelEvent.create({
          data: {
            actorWallet: wallet,
            duelId,
            fromStatus: duel.status,
            id: createId('evt'),
            sequence: duel.version + 1,
            toStatus: DatabaseDuelStatus.MATCHED,
            type: 'duel.joined',
          },
        });
        await this.storeIdempotency(transaction, scope, idempotencyKey, requestHash, duelId, 200);
        return transaction.duel.findUniqueOrThrow({ where: { id: duelId } });
      });
      return toDuel(row);
    } catch (error) {
      const concurrentReplay = await this.replay(scope, idempotencyKey, requestHash);
      if (concurrentReplay) return concurrentReplay;
      throw error;
    }
  }

  async cancel(
    duelId: string,
    wallet: string,
    reason: string,
    idempotencyKey: string,
    requestHash: string,
    now: Date,
  ): Promise<Duel> {
    const scope = `duels:${duelId}:cancel`;
    const replay = await this.replay(scope, idempotencyKey, requestHash);
    if (replay) return replay;

    try {
      const row = await this.database.$transaction(async (transaction) => {
        const duel = await transaction.duel.findUnique({ where: { id: duelId } });
        if (!duel) throw new NotFoundException(`Duel ${duelId} was not found`);
        if (duel.creatorWallet !== wallet && duel.opponentWallet !== wallet) {
          throw new ConflictException('Only a duel participant can cancel');
        }
        if (!ACTIVE_TIMEOUT_STATUSES.has(duel.status)) {
          throw new ConflictException(`Duel cannot be cancelled from ${duel.status.toLowerCase()}`);
        }

        const updated = await transaction.duel.updateMany({
          data: {
            cancellationReason: reason,
            status: DatabaseDuelStatus.CANCELLED,
            version: { increment: 1 },
          },
          where: { id: duel.id, status: duel.status, version: duel.version },
        });
        if (updated.count !== 1)
          throw new ConflictException('Duel state changed before cancellation');
        await transaction.duelEvent.create({
          data: {
            actorWallet: wallet,
            createdAt: now,
            data: { reason },
            duelId,
            fromStatus: duel.status,
            id: createId('evt'),
            sequence: duel.version + 1,
            toStatus: DatabaseDuelStatus.CANCELLED,
            type: 'duel.cancelled',
          },
        });
        await this.storeIdempotency(transaction, scope, idempotencyKey, requestHash, duelId, 200);
        return transaction.duel.findUniqueOrThrow({ where: { id: duelId } });
      });
      return toDuel(row);
    } catch (error) {
      const concurrentReplay = await this.replay(scope, idempotencyKey, requestHash);
      if (concurrentReplay) return concurrentReplay;
      throw error;
    }
  }

  async expireTimedOut(now: Date): Promise<number> {
    const expired = await this.database.duel.findMany({
      orderBy: { expiresAt: 'asc' },
      take: 100,
      where: { expiresAt: { lte: now }, status: { in: [...ACTIVE_TIMEOUT_STATUSES] } },
    });
    let count = 0;
    for (const duel of expired) {
      const changed = await this.database.$transaction(async (transaction) => {
        const updated = await transaction.duel.updateMany({
          data: {
            cancellationReason: 'timeout',
            status: DatabaseDuelStatus.CANCELLED,
            version: { increment: 1 },
          },
          where: { id: duel.id, status: duel.status, version: duel.version },
        });
        if (updated.count !== 1) return false;
        await transaction.duelEvent.create({
          data: {
            data: { expiredAt: now.toISOString(), reason: 'timeout' },
            duelId: duel.id,
            fromStatus: duel.status,
            id: createId('evt'),
            sequence: duel.version + 1,
            toStatus: DatabaseDuelStatus.CANCELLED,
            type: 'duel.timed_out',
          },
        });
        return true;
      });
      if (changed) count += 1;
    }
    return count;
  }

  async listEvents(duelId: string): Promise<DuelEvent[]> {
    await this.requireDuel(duelId);
    const events = await this.database.duelEvent.findMany({
      orderBy: { sequence: 'asc' },
      where: { duelId },
    });
    return events.map((event) => ({
      actorWallet: event.actorWallet,
      createdAt: event.createdAt.toISOString(),
      data: toJsonObject(event.data),
      duelId: event.duelId,
      fromStatus: event.fromStatus ? toApiStatus(event.fromStatus) : null,
      id: event.id,
      sequence: event.sequence,
      toStatus: event.toStatus ? toApiStatus(event.toStatus) : null,
      type: event.type,
    }));
  }

  async listTransactions(duelId: string): Promise<DuelTransactionRecord[]> {
    await this.requireDuel(duelId);
    const transactions = await this.database.duelTransaction.findMany({
      orderBy: { createdAt: 'asc' },
      where: { duelId },
    });
    return transactions.map((transaction) => ({
      action: toApiTransactionAction(transaction.action),
      confirmedAt: transaction.confirmedAt?.toISOString() ?? null,
      createdAt: transaction.createdAt.toISOString(),
      duelId: transaction.duelId,
      errorCode: transaction.errorCode,
      errorMessage: transaction.errorMessage,
      expiresAt: transaction.expiresAt?.toISOString() ?? null,
      id: transaction.id,
      lastValidBlockHeight: transaction.lastValidBlockHeight?.toString() ?? null,
      network: 'solana-devnet',
      providerReference: transaction.providerReference,
      recentBlockhash: transaction.recentBlockhash,
      signature: transaction.signature,
      status: toApiTransactionStatus(transaction.status),
      submittedAt: transaction.submittedAt?.toISOString() ?? null,
      updatedAt: transaction.updatedAt.toISOString(),
      wallet: transaction.wallet,
    }));
  }

  async transition(input: TransitionDuelRecord): Promise<Duel> {
    const scope = `duels:${input.duelId}:transition`;
    const replay = await this.replay(scope, input.idempotencyKey, input.requestHash);
    if (replay) return replay;

    try {
      const row = await this.database.$transaction(async (transaction) => {
        const duel = await transaction.duel.findUnique({ where: { id: input.duelId } });
        if (!duel) throw new NotFoundException(`Duel ${input.duelId} was not found`);
        const current = toApiStatus(duel.status);
        if (!canTransition(current, input.toStatus)) {
          throw new ConflictException(
            `Duel cannot transition from ${current} to ${input.toStatus}`,
          );
        }
        const target = toDatabaseStatus(input.toStatus);
        const updated = await transaction.duel.updateMany({
          data: {
            status: target,
            version: { increment: 1 },
            ...(target === DatabaseDuelStatus.FUNDED ? { fundedAt: new Date() } : {}),
            ...(target === DatabaseDuelStatus.SETTLED ? { settledAt: new Date() } : {}),
          },
          where: { id: duel.id, status: duel.status, version: duel.version },
        });
        if (updated.count !== 1)
          throw new ConflictException('Duel state changed during transition');
        await transaction.duelEvent.create({
          data: {
            actorWallet: input.actorWallet,
            ...(input.data ? { data: input.data as Prisma.InputJsonValue } : {}),
            duelId: duel.id,
            fromStatus: duel.status,
            id: createId('evt'),
            sequence: duel.version + 1,
            toStatus: target,
            type: input.eventType,
          },
        });
        await this.storeIdempotency(
          transaction,
          scope,
          input.idempotencyKey,
          input.requestHash,
          duel.id,
          200,
        );
        return transaction.duel.findUniqueOrThrow({ where: { id: duel.id } });
      });
      return toDuel(row);
    } catch (error) {
      const concurrentReplay = await this.replay(scope, input.idempotencyKey, input.requestHash);
      if (concurrentReplay) return concurrentReplay;
      throw error;
    }
  }

  private async replay(scope: string, key: string, requestHash: string): Promise<Duel | null> {
    const record = await this.database.idempotencyRecord.findUnique({
      where: { scope_key: { key, scope } },
    });
    if (!record) return null;
    if (record.expiresAt <= new Date()) {
      await this.database.idempotencyRecord.deleteMany({
        where: { expiresAt: { lte: new Date() }, id: record.id },
      });
      return null;
    }
    if (record.requestHash !== requestHash) {
      throw new ConflictException('Idempotency-Key was already used with a different request');
    }
    return this.requireDuel(record.resourceId);
  }

  private async requireDuel(duelId: string): Promise<Duel> {
    const duel = await this.findOne(duelId);
    if (!duel) throw new NotFoundException(`Duel ${duelId} was not found`);
    return duel;
  }

  private async storeIdempotency(
    transaction: TransactionClient,
    scope: string,
    key: string,
    requestHash: string,
    resourceId: string,
    statusCode: number,
  ): Promise<void> {
    await transaction.idempotencyRecord.create({
      data: {
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        id: createId('idem'),
        key,
        requestHash,
        resourceId,
        scope,
        statusCode,
      },
    });
  }
}

function matchesQuery(
  duel: {
    creatorWallet: string;
    mode: DuelMode;
    opponentWallet: string | null;
    packId: string;
    status: DatabaseDuelStatus;
    winnerWallet: string | null;
  },
  query: ListDuelsQuery,
): boolean {
  if (query.matchmakingMode && duel.mode !== toDatabaseMode(query.matchmakingMode)) return false;
  if (query.packId && duel.packId !== query.packId) return false;
  if (query.status && duel.status !== toDatabaseStatus(query.status as DuelStatus)) return false;
  return (
    !query.wallet ||
    [duel.creatorWallet, duel.opponentWallet, duel.winnerWallet].includes(query.wallet)
  );
}

function toDuel(row: {
  cancellationReason: string | null;
  createdAt: Date;
  creatorWallet: string;
  escrowAddress: string | null;
  expiresAt: Date;
  houseOpponent: boolean;
  id: string;
  mode: DuelMode;
  opponentJoinedAt: Date | null;
  opponentWallet: string | null;
  packId: string;
  packName: string;
  packProvider: string;
  providerMode: ProviderMode;
  providerPackId: string | null;
  stakeAmount: string;
  stakeCurrency: string;
  stakeDecimals: number;
  status: DatabaseDuelStatus;
  updatedAt: Date;
  valuationPolicyHash: string | null;
  version: number;
  winnerWallet: string | null;
}): Duel {
  return {
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    creatorWallet: row.creatorWallet,
    environment: 'solana-devnet',
    escrowAddress: row.escrowAddress,
    expiresAt: row.expiresAt.toISOString(),
    houseOpponent: row.houseOpponent,
    id: row.id,
    matchmakingMode: row.mode.toLowerCase() as MatchmakingMode,
    opponentJoinedAt: row.opponentJoinedAt?.toISOString() ?? null,
    opponentWallet: row.opponentWallet,
    pack: {
      active: true,
      id: row.packId,
      name: row.packName,
      price: { amount: row.stakeAmount, currency: 'USDC', decimals: 6 },
      provider: row.packProvider,
      ...(row.providerPackId ? { providerPackId: row.providerPackId } : {}),
      ...(row.valuationPolicyHash ? { valuationPolicyHash: row.valuationPolicyHash } : {}),
    },
    providerMode: row.providerMode === ProviderMode.MOCK ? 'mock' : 'collector-crypt-sandbox',
    stake: { amount: row.stakeAmount, currency: 'USDC', decimals: 6 },
    status: toApiStatus(row.status),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    winnerWallet: row.winnerWallet,
  };
}

function toDatabaseMode(mode: MatchmakingMode): DuelMode {
  if (mode === 'direct') return DuelMode.DIRECT;
  if (mode === 'house') return DuelMode.HOUSE;
  return DuelMode.OPEN;
}

function toDatabaseProviderMode(mode: 'collector-crypt-sandbox' | 'mock'): ProviderMode {
  return mode === 'mock' ? ProviderMode.MOCK : ProviderMode.COLLECTOR_CRYPT_SANDBOX;
}

function toDatabaseStatus(status: DuelStatus): DatabaseDuelStatus {
  const mapped = Object.values(DatabaseDuelStatus).find(
    (candidate) => candidate.toLowerCase() === status,
  );
  if (!mapped) throw new ConflictException(`Unsupported duel status ${status}`);
  return mapped;
}

function toApiStatus(status: DatabaseDuelStatus): DuelStatus {
  return status.toLowerCase() as DuelStatus;
}

function toApiTransactionAction(action: DuelTransactionAction): DuelTransactionRecord['action'] {
  return action.toLowerCase() as DuelTransactionRecord['action'];
}

function toApiTransactionStatus(status: DuelTransactionStatus): DuelTransactionRecord['status'] {
  return status.toLowerCase() as DuelTransactionRecord['status'];
}

function toJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function hashDuelRequest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}

const ALLOWED_TRANSITIONS: Readonly<Record<DuelStatus, readonly DuelStatus[]>> = {
  awaiting_assets: ['settling', 'refunding', 'failed'],
  cancelled: [],
  cancelling: ['cancelled', 'refunding', 'failed'],
  committing: ['funded', 'refunding', 'failed'],
  failed: ['refunding'],
  funded: ['opening', 'refunding', 'failed'],
  matched: ['committing', 'cancelled', 'failed'],
  opening: ['awaiting_assets', 'refunding', 'failed'],
  refunded: [],
  refunding: ['refunded', 'failed'],
  settled: [],
  settling: ['settled', 'refunding', 'failed'],
  waiting: ['matched', 'cancelled', 'failed'],
};

export function canTransition(from: DuelStatus, to: DuelStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
