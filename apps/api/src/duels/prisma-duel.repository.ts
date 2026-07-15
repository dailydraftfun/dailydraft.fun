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
  DuelSide as DatabaseDuelSide,
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
  Money,
  Page,
} from '../domain.js';
import {
  CANONICAL_VALUATION_POLICY_HASH,
  requireCanonicalValuationPolicyHash,
} from '../providers/valuation-policy.js';
import type { ListDuelsQuery } from './duel.dto.js';
import {
  type CreateDuelRecord,
  DuelRepository,
  type ResolveOpenedPacksRecord,
  type TransactionClient,
  type TransitionDuelRecord,
} from './duel.repository.js';
import { canTransition } from './duel-state.js';

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
      include: { packOutcomes: { orderBy: { side: 'asc' } } },
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
    const row = await this.database.duel.findUnique({
      include: { packOutcomes: { orderBy: { side: 'asc' } } },
      where: { id: duelId },
    });
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
            data: {
              environment: 'solana-devnet',
              houseOpponent: input.houseOpponent,
              valuationPolicyHash: input.pack.valuationPolicyHash,
            },
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
        const queueTicket = await transaction.matchmakingTicket.findFirst({
          select: { id: true },
          where: { duelId },
        });
        if (queueTicket) {
          throw new ConflictException('Open queue duels must be assigned through matchmaking');
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
      checkAttempts: transaction.checkAttempts,
      confirmationStatus:
        transaction.confirmationStatus === 'confirmed' ||
        transaction.confirmationStatus === 'finalized'
          ? transaction.confirmationStatus
          : null,
      confirmedAt: transaction.confirmedAt?.toISOString() ?? null,
      createdAt: transaction.createdAt.toISOString(),
      duelId: transaction.duelId,
      errorCode: transaction.errorCode,
      errorMessage: transaction.errorMessage,
      expiresAt: transaction.expiresAt?.toISOString() ?? null,
      feeAmountLamports: readStringMetadata(transaction.metadata, 'feeAmountLamports'),
      id: transaction.id,
      finalizedAt: transaction.finalizedAt?.toISOString() ?? null,
      lastCheckedAt: transaction.lastCheckedAt?.toISOString() ?? null,
      lastValidBlockHeight: transaction.lastValidBlockHeight?.toString() ?? null,
      network: 'solana-devnet',
      providerReference: transaction.providerReference,
      recentBlockhash: transaction.recentBlockhash,
      recoveredAt: transaction.recoveredAt?.toISOString() ?? null,
      recoveryAlertCode:
        transaction.recoveryAlertCode === 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH'
          ? transaction.recoveryAlertCode
          : null,
      recoveryCandidateAt: transaction.recoveryCandidateAt?.toISOString() ?? null,
      recoveryCandidateSignature: transaction.recoveryCandidateSignature,
      signature: transaction.signature,
      status: toApiTransactionStatus(transaction.status),
      submittedAt: transaction.submittedAt?.toISOString() ?? null,
      stuckAt: transaction.stuckAt?.toISOString() ?? null,
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
            ...(input.actorWallet ? { actorWallet: input.actorWallet } : {}),
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
        return transaction.duel.findUniqueOrThrow({
          include: { packOutcomes: { orderBy: { side: 'asc' } } },
          where: { id: duel.id },
        });
      });
      return toDuel(row);
    } catch (error) {
      const concurrentReplay = await this.replay(scope, input.idempotencyKey, input.requestHash);
      if (concurrentReplay) return concurrentReplay;
      throw error;
    }
  }

  async resolveOpenedPacks(input: ResolveOpenedPacksRecord): Promise<Duel> {
    const scope = `duels:${input.duelId}:resolve-packs`;
    const replay = await this.replay(scope, input.idempotencyKey, input.requestHash);
    if (replay) return replay;

    try {
      const row = await this.database.$transaction(async (transaction) => {
        const duel = await transaction.duel.findUnique({ where: { id: input.duelId } });
        if (!duel) throw new NotFoundException(`Duel ${input.duelId} was not found`);
        if (duel.resultHash === input.comparison.resultHash && duel.resultReadyAt) {
          return transaction.duel.findUniqueOrThrow({
            include: { packOutcomes: { orderBy: { side: 'asc' } } },
            where: { id: duel.id },
          });
        }
        if (duel.status !== DatabaseDuelStatus.OPENING) {
          throw new ConflictException(
            `Duel packs cannot resolve from ${duel.status.toLowerCase()}`,
          );
        }
        if (!duel.opponentWallet) throw new ConflictException('Duel has no committed opponent');
        if (!duel.fundedAt) throw new ConflictException('Duel has no finalized funding boundary');
        requireCanonicalValuationPolicyHash(duel.valuationPolicyHash);
        if (
          !duel.valuationPolicyHash ||
          duel.valuationPolicyHash !== input.comparison.valuationPolicyHash ||
          input.creator.valuationPolicyHash !== duel.valuationPolicyHash ||
          input.opponent.valuationPolicyHash !== duel.valuationPolicyHash
        ) {
          throw new ConflictException('Pack results do not match the funded valuation policy');
        }
        if (
          input.creator.poolVersion !== input.comparison.poolVersion ||
          input.opponent.poolVersion !== input.comparison.poolVersion
        ) {
          throw new ConflictException('Pack results do not share one immutable pool version');
        }
        if (
          new Date(input.creator.openedAt) < duel.fundedAt ||
          new Date(input.opponent.openedAt) < duel.fundedAt
        ) {
          throw new ConflictException('Pack opening predates finalized duel funding');
        }

        const winnerWallet =
          input.comparison.winnerSide === 'creator'
            ? duel.creatorWallet
            : input.comparison.winnerSide === 'opponent'
              ? duel.opponentWallet
              : null;
        const target = resolvedPackTargetStatus(input.comparison.winnerSide);
        const now = new Date();

        await transaction.duelPackOutcome.createMany({
          data: [
            toPackOutcomeCreate(input.duelId, input.creator, input.provider, input.isMock),
            toPackOutcomeCreate(input.duelId, input.opponent, input.provider, input.isMock),
          ],
        });
        const updated = await transaction.duel.updateMany({
          data: {
            resultHash: input.comparison.resultHash,
            resultReadyAt: now,
            status: target,
            version: { increment: 1 },
            winnerWallet,
          },
          where: {
            id: duel.id,
            resultHash: null,
            status: DatabaseDuelStatus.OPENING,
            version: duel.version,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException('Duel state changed while pack results were recorded');
        }
        await transaction.duelEvent.create({
          data: {
            data: {
              comparisonMetric: input.comparison.comparisonMetric,
              isMock: input.isMock,
              poolVersion: input.comparison.poolVersion,
              resultHash: input.comparison.resultHash,
              tieRule: input.comparison.tieRule,
              valuationPolicyHash: input.comparison.valuationPolicyHash,
              winnerSide: input.comparison.winnerSide,
            },
            duelId: duel.id,
            fromStatus: duel.status,
            id: createId('evt'),
            sequence: duel.version + 1,
            toStatus: target,
            type: winnerWallet ? 'duel.pack_results_ready' : 'duel.pack_results_tied',
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
        return transaction.duel.findUniqueOrThrow({
          include: { packOutcomes: { orderBy: { side: 'asc' } } },
          where: { id: duel.id },
        });
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

export function resolvedPackTargetStatus(
  _winnerSide: ResolveOpenedPacksRecord['comparison']['winnerSide'],
): typeof DatabaseDuelStatus.AWAITING_ASSETS {
  return DatabaseDuelStatus.AWAITING_ASSETS;
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
  packOutcomes?: Array<{
    assetReference: string;
    displayName: string;
    insuredValueAmount: string;
    insuredValueCurrency: string;
    insuredValueDecimals: number;
    isMock: boolean;
    openedAt: Date;
    provider: string;
    providerReference: string;
    poolVersion: string | null;
    resultHash: string;
    side: DatabaseDuelSide;
    sourceTimestamp: Date | null;
    valuationPolicyHash: string;
  }>;
  packId: string;
  packName: string;
  packProvider: string;
  providerMode: ProviderMode;
  providerPackId: string | null;
  resultHash: string | null;
  resultReadyAt: Date | null;
  stakeAmount: string;
  stakeCurrency: string;
  stakeDecimals: number;
  status: DatabaseDuelStatus;
  updatedAt: Date;
  valuationPolicyHash: string | null;
  version: number;
  winnerWallet: string | null;
}): Duel {
  const stake = toMoney(row.stakeAmount, row.stakeCurrency, row.stakeDecimals);
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
      price: stake,
      provider: row.packProvider,
      ...(row.providerPackId ? { providerPackId: row.providerPackId } : {}),
      ...(row.valuationPolicyHash ? { valuationPolicyHash: row.valuationPolicyHash } : {}),
    },
    providerMode: row.providerMode === ProviderMode.MOCK ? 'mock' : 'collector-crypt-sandbox',
    result: toDuelResult(row),
    stake,
    status: toApiStatus(row.status),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    winnerWallet: row.winnerWallet,
  };
}

export function toDuelResult(row: {
  creatorWallet: string;
  opponentWallet: string | null;
  packOutcomes?: Array<{
    assetReference: string;
    displayName: string;
    insuredValueAmount: string;
    insuredValueCurrency: string;
    insuredValueDecimals: number;
    isMock: boolean;
    openedAt: Date;
    provider: string;
    providerReference: string;
    poolVersion: string | null;
    resultHash: string;
    side: DatabaseDuelSide;
    sourceTimestamp: Date | null;
    valuationPolicyHash: string;
  }>;
  resultHash: string | null;
  resultReadyAt: Date | null;
  valuationPolicyHash: string | null;
  winnerWallet: string | null;
}): NonNullable<Duel['result']> | null {
  if (!row.resultHash || !row.resultReadyAt || row.packOutcomes?.length !== 2) return null;
  const policyHashes = new Set(row.packOutcomes.map((outcome) => outcome.valuationPolicyHash));
  const poolVersions = new Set(row.packOutcomes.map((outcome) => outcome.poolVersion));
  if (
    row.valuationPolicyHash !== CANONICAL_VALUATION_POLICY_HASH ||
    row.packOutcomes.some((outcome) => !outcome.poolVersion || !outcome.sourceTimestamp)
  ) {
    return null;
  }
  if (
    !row.valuationPolicyHash ||
    policyHashes.size !== 1 ||
    !policyHashes.has(row.valuationPolicyHash) ||
    poolVersions.size !== 1
  ) {
    throw new Error('Persisted duel result violates canonical valuation proof invariants');
  }
  requireCanonicalValuationPolicyHash(row.valuationPolicyHash);
  const outcomes = row.packOutcomes.map((outcome) => {
    if (!outcome.poolVersion || !outcome.sourceTimestamp) {
      throw new Error('Canonical duel result lost required provider snapshot data');
    }
    return {
      assetReference: outcome.assetReference,
      displayName: outcome.displayName,
      insuredValue: toMoney(
        outcome.insuredValueAmount,
        outcome.insuredValueCurrency,
        outcome.insuredValueDecimals,
      ),
      isMock: outcome.isMock,
      openedAt: outcome.openedAt.toISOString(),
      provider: outcome.provider,
      providerReference: outcome.providerReference,
      poolVersion: outcome.poolVersion,
      resultHash: outcome.resultHash,
      side:
        outcome.side === DatabaseDuelSide.CREATOR ? ('creator' as const) : ('opponent' as const),
      sourceTimestamp: outcome.sourceTimestamp.toISOString(),
    };
  });
  const winnerSide =
    row.winnerWallet === row.creatorWallet
      ? ('creator' as const)
      : row.winnerWallet && row.winnerWallet === row.opponentWallet
        ? ('opponent' as const)
        : null;
  return {
    comparisonMetric: 'insured-value',
    outcomes,
    resultHash: row.resultHash,
    settlementReady: true,
    tieRule: 'return-original-assets-and-refund-platform-fees',
    valuationPolicyHash: row.valuationPolicyHash,
    winnerSide,
  };
}

function toPackOutcomeCreate(
  duelId: string,
  outcome: ResolveOpenedPacksRecord['creator'],
  provider: string,
  isMock: boolean,
) {
  return {
    assetReference: outcome.assetReference,
    displayName: outcome.displayName,
    duelId,
    id: createId('outcome'),
    insuredValueAmount: outcome.insuredValue.amount,
    insuredValueCurrency: outcome.insuredValue.currency,
    insuredValueDecimals: outcome.insuredValue.decimals,
    isMock,
    openedAt: new Date(outcome.openedAt),
    provider,
    providerReference: outcome.providerReference,
    poolVersion: outcome.poolVersion,
    resultHash: outcome.resultHash,
    side: outcome.side === 'creator' ? DatabaseDuelSide.CREATOR : DatabaseDuelSide.OPPONENT,
    sourceTimestamp: new Date(outcome.sourceTimestamp),
    valuationPolicyHash: outcome.valuationPolicyHash,
  };
}

function toMoney(amount: string, currency: string, decimals: number): Money {
  if (currency !== 'USDC' || decimals !== 6) {
    throw new Error(`Unsupported persisted money invariant: ${currency}/${decimals}`);
  }
  return { amount, currency, decimals };
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

function readStringMetadata(value: Prisma.JsonValue | null, key: string): string | null {
  const metadata = toJsonObject(value);
  return metadata && typeof metadata[key] === 'string' ? metadata[key] : null;
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
