import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type DatabaseClient,
  DuelMode,
  DuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
  MatchmakingTicketRole,
  MatchmakingTicketStatus,
  type Prisma,
  ProductEventName,
  ProductEventSource,
  ProviderMode,
} from '@openpacksduel/db';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AdminService, readRiskLimits } from '../admin/admin.service.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import type { Pack } from '../domain.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { PacksService } from '../packs/packs.service.js';
import {
  reserveHouseExposure,
  shouldRetryTreasuryTransaction,
} from '../treasury/house-treasury.policy.js';
import type { MatchmakingRequest } from './matchmaking.dto.js';

const FAILURE_WINDOW_MS = 60 * 60 * 1_000;
const MATCHMAKING_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class MatchmakingService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly packs: PacksService,
    private readonly admin: AdminService,
  ) {}

  async search(input: MatchmakingRequest) {
    const now = new Date();
    await this.expireTimedOut(now);
    const existing = await this.findSession(input.wallet);
    if (existing) return existing;

    const pack = this.packs.findOne(input.packId);
    const tier = moneyToTier(pack.price.amount, pack.price.decimals);
    await this.admin.assertCreateAllowed({ mode: 'open', tier, wallet: input.wallet });
    await this.assertWalletAllowed(input.wallet, now);
    const segment = loadQueueSegment();
    const providerMode = resolveProviderMode();
    const queueKey = queueSegmentKey({ pack, providerMode, ...segment });

    for (let attempt = 1; attempt <= MATCHMAKING_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            const replay = await findTicket(transaction, input.wallet);
            if (replay) return toSession(replay);

            const candidate = await transaction.matchmakingTicket.findFirst({
              include: { duel: true },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              where: {
                duel: {
                  expiresAt: { gt: now },
                  mode: DuelMode.OPEN,
                  status: DuelStatus.WAITING,
                },
                queueKey,
                status: MatchmakingTicketStatus.SEARCHING,
                wallet: { not: input.wallet },
              },
            });
            if (candidate) {
              return this.assignCandidate(transaction, candidate, input.wallet, now);
            }
            return this.createSearch(
              transaction,
              input.wallet,
              pack,
              providerMode,
              segment,
              queueKey,
              now,
            );
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        const replay = await this.findSession(input.wallet);
        if (replay) return replay;
        if (!shouldRetryMatchmakingTransaction(error, attempt)) throw error;
      }
    }
    throw new ServiceUnavailableException('Matchmaking assignment could not be serialized');
  }

  async status(wallet: string) {
    await this.expireTimedOut(new Date());
    const session = await this.findSession(wallet);
    if (!session) throw new NotFoundException('Wallet has no active matchmaking session');
    return session;
  }

  async cancel(wallet: string) {
    const now = new Date();
    await this.expireTimedOut(now);
    const ticket = await this.database.matchmakingTicket.findUnique({
      include: { duel: true },
      where: { wallet },
    });
    if (!ticket) throw new NotFoundException('Wallet has no active matchmaking session');
    if (ticket.duel.status !== DuelStatus.WAITING && ticket.duel.status !== DuelStatus.MATCHED) {
      throw new ConflictException('Committed matches must use cancellation or refund recovery');
    }
    await this.database.$transaction(async (transaction) => {
      const changed = await transaction.duel.updateMany({
        data: {
          cancellationReason: 'matchmaking_cancelled',
          commitmentExpiresAt: null,
          status: DuelStatus.CANCELLED,
          version: { increment: 1 },
        },
        where: {
          id: ticket.duelId,
          status: ticket.duel.status,
          version: ticket.duel.version,
        },
      });
      if (changed.count !== 1) throw new ConflictException('Matchmaking state changed');
      if (ticket.duel.status === DuelStatus.MATCHED) {
        await recordFailedCommitment(transaction, wallet, now);
      }
      await transaction.matchmakingTicket.deleteMany({ where: { duelId: ticket.duelId } });
      await appendDuelEvent(transaction, {
        data: { reason: 'player_cancelled_search' },
        duelId: ticket.duelId,
        fromStatus: ticket.duel.status,
        sequence: ticket.duel.version + 1,
        toStatus: DuelStatus.CANCELLED,
        type: 'matchmaking.abandoned',
        wallet,
      });
      await appendMetric(transaction, {
        duelId: ticket.duelId,
        name: ProductEventName.MATCHMAKING_ABANDONED,
        status: DuelStatus.CANCELLED,
        tier: ticket.tier,
      });
    });
    return { cancelled: true, duelId: ticket.duelId, reason: 'player_cancelled_search' };
  }

  async houseFallback(wallet: string) {
    const now = new Date();
    await this.expireTimedOut(now);
    const ticket = await this.database.matchmakingTicket.findUnique({
      include: { duel: true },
      where: { wallet },
    });
    if (!ticket) throw new NotFoundException('Wallet has no active matchmaking session');
    if (
      ticket.status !== MatchmakingTicketStatus.SEARCHING ||
      ticket.duel.status !== DuelStatus.WAITING
    ) {
      throw new ConflictException('House fallback is available only while searching');
    }
    await this.admin.assertCreateAllowed({ mode: 'house', tier: ticket.tier, wallet });
    const houseWallet = process.env.OPENPACKSDUEL_HOUSE_DEVNET_WALLET?.trim();
    if (!houseWallet) throw new ServiceUnavailableException('House wallet is not configured');
    if (houseWallet === wallet) throw new ConflictException('House wallet cannot challenge itself');
    const commitmentExpiresAt = new Date(now.getTime() + commitmentWindowMs());
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const updated = await this.database.$transaction(
          async (transaction) => {
            await reserveHouseExposure(transaction, {
              amount: ticket.duel.stakeAmount,
              currency: ticket.duel.stakeCurrency,
              decimals: ticket.duel.stakeDecimals,
              duelId: ticket.duelId,
              playerWallet: wallet,
              tier: ticket.tier,
            });
            const changed = await transaction.duel.updateMany({
              data: {
                commitmentExpiresAt,
                houseOpponent: true,
                matchedAt: now,
                mode: DuelMode.HOUSE,
                opponentJoinedAt: now,
                opponentWallet: houseWallet,
                status: DuelStatus.MATCHED,
                version: { increment: 1 },
              },
              where: {
                id: ticket.duelId,
                status: DuelStatus.WAITING,
                version: ticket.duel.version,
              },
            });
            if (changed.count !== 1) throw new ConflictException('Matchmaking state changed');
            await transaction.matchmakingTicket.update({
              data: { commitmentExpiresAt, status: MatchmakingTicketStatus.MATCHED },
              where: { id: ticket.id },
            });
            await appendDuelEvent(transaction, {
              data: { explicitDisclosure: true, opponentType: 'house' },
              duelId: ticket.duelId,
              fromStatus: DuelStatus.WAITING,
              sequence: ticket.duel.version + 1,
              toStatus: DuelStatus.MATCHED,
              type: 'matchmaking.house_fallback_selected',
              wallet,
            });
            await appendMetric(transaction, {
              duelId: ticket.duelId,
              mode: DuelMode.HOUSE,
              name: ProductEventName.HOUSE_FALLBACK_SELECTED,
              status: DuelStatus.MATCHED,
              tier: ticket.tier,
            });
            return findTicketOrThrow(transaction, wallet);
          },
          { isolationLevel: 'Serializable' },
        );
        return toSession(updated);
      } catch (error) {
        if (shouldRetryTreasuryTransaction(error, attempt)) continue;
        throw error;
      }
    }
    throw new ServiceUnavailableException('House reservation could not be serialized');
  }

  async expireCommitments(now = new Date()): Promise<{ expired: number }> {
    const expired = await this.database.duel.findMany({
      include: { matchmakingTickets: true, transactions: true },
      orderBy: { commitmentExpiresAt: 'asc' },
      take: 100,
      where: {
        commitmentExpiresAt: { lte: now },
        mode: { in: [DuelMode.OPEN, DuelMode.HOUSE] },
        status: { in: [DuelStatus.MATCHED, DuelStatus.COMMITTING] },
      },
    });
    let count = 0;
    for (const duel of expired) {
      const changed = await this.database
        .$transaction(async (transaction) => {
          const creatorTicket = duel.matchmakingTickets.find(
            (ticket) => ticket.role === MatchmakingTicketRole.CREATOR,
          );
          if (!creatorTicket) return false;
          const opponentTicket = duel.matchmakingTickets.find(
            (ticket) => ticket.role === MatchmakingTicketRole.OPPONENT,
          );
          const creatorFunded = duel.transactions.some(
            (funding) =>
              funding.action === DuelTransactionAction.FUND &&
              funding.status === DuelTransactionStatus.FINALIZED &&
              funding.wallet === duel.creatorWallet,
          );
          const responsibility = commitmentTimeoutPolicy({
            creatorBlocked: false,
            creatorFunded,
            mode: duel.mode,
            status: duel.status,
          });
          const offender =
            responsibility.offenderRole === MatchmakingTicketRole.OPPONENT
              ? opponentTicket
              : responsibility.offenderRole === MatchmakingTicketRole.CREATOR
                ? creatorTicket
                : null;
          const failure = offender
            ? await recordFailedCommitment(transaction, offender.wallet, now)
            : null;
          const creatorBlocked = Boolean(
            offender?.role === MatchmakingTicketRole.CREATOR &&
              failure?.blockedUntil &&
              failure.blockedUntil > now,
          );
          const policy = commitmentTimeoutPolicy({
            creatorBlocked,
            creatorFunded,
            mode: duel.mode,
            status: duel.status,
          });
          const { canRequeueCreator, nextStatus } = policy;
          const update = await transaction.duel.updateMany({
            data: canRequeueCreator
              ? {
                  commitmentExpiresAt: null,
                  matchedAt: null,
                  opponentJoinedAt: null,
                  opponentWallet: null,
                  status: nextStatus,
                  version: { increment: 1 },
                }
              : {
                  cancellationReason: policy.cancellationReason,
                  commitmentExpiresAt: null,
                  status: nextStatus,
                  version: { increment: 1 },
                },
            where: { id: duel.id, status: duel.status, version: duel.version },
          });
          if (update.count !== 1) throw new ConflictException('Matchmaking state changed');
          await transaction.matchmakingTicket.deleteMany({
            where: { duelId: duel.id, role: MatchmakingTicketRole.OPPONENT },
          });
          if (canRequeueCreator) {
            await transaction.matchmakingTicket.update({
              data: { commitmentExpiresAt: null, status: MatchmakingTicketStatus.SEARCHING },
              where: { id: creatorTicket.id },
            });
          } else {
            await transaction.matchmakingTicket.deleteMany({ where: { duelId: duel.id } });
          }
          await appendDuelEvent(transaction, {
            data: {
              creatorRequeued: canRequeueCreator,
              offenderRole: offender?.role.toLowerCase() ?? null,
              reason: 'commitment_timeout',
            },
            duelId: duel.id,
            fromStatus: duel.status,
            sequence: duel.version + 1,
            toStatus: nextStatus,
            type: 'matchmaking.commitment_timed_out',
          });
          await appendMetric(transaction, {
            duelId: duel.id,
            name: ProductEventName.MATCHMAKING_COMMITMENT_FAILED,
            status: nextStatus,
            tier: creatorTicket.tier,
          });
          if (canRequeueCreator) {
            await appendMetric(transaction, {
              duelId: duel.id,
              name: ProductEventName.MATCHMAKING_WAIT_STARTED,
              status: DuelStatus.WAITING,
              tier: creatorTicket.tier,
            });
          }
          return true;
        })
        .catch((error: unknown) => {
          if (error instanceof ConflictException) return false;
          throw error;
        });
      if (changed) count += 1;
    }
    return { expired: count };
  }

  async expireTimedOut(now = new Date()): Promise<{ expired: number }> {
    const commitments = await this.expireCommitments(now);
    const stale = await this.database.duel.findMany({
      include: { matchmakingTickets: true },
      orderBy: { expiresAt: 'asc' },
      take: 100,
      where: {
        expiresAt: { lte: now },
        matchmakingTickets: { some: {} },
        mode: DuelMode.OPEN,
        status: DuelStatus.WAITING,
      },
    });
    let expired = commitments.expired;
    for (const duel of stale) {
      const changed = await this.database.$transaction(async (transaction) => {
        const update = await transaction.duel.updateMany({
          data: {
            cancellationReason: 'matchmaking_search_timeout',
            status: DuelStatus.CANCELLED,
            version: { increment: 1 },
          },
          where: { id: duel.id, status: DuelStatus.WAITING, version: duel.version },
        });
        if (update.count !== 1) return false;
        const creator = duel.matchmakingTickets.find(
          (ticket) => ticket.role === MatchmakingTicketRole.CREATOR,
        );
        await transaction.matchmakingTicket.deleteMany({ where: { duelId: duel.id } });
        await appendDuelEvent(transaction, {
          data: { reason: 'search_timeout' },
          duelId: duel.id,
          fromStatus: DuelStatus.WAITING,
          sequence: duel.version + 1,
          toStatus: DuelStatus.CANCELLED,
          type: 'matchmaking.search_timed_out',
        });
        if (creator) {
          await appendMetric(transaction, {
            duelId: duel.id,
            name: ProductEventName.MATCHMAKING_ABANDONED,
            status: DuelStatus.CANCELLED,
            tier: creator.tier,
          });
        }
        return true;
      });
      if (changed) expired += 1;
    }
    return { expired };
  }

  private async assignCandidate(
    transaction: Prisma.TransactionClient,
    candidate: TicketWithDuel,
    wallet: string,
    now: Date,
  ) {
    const commitmentExpiresAt = new Date(now.getTime() + commitmentWindowMs());
    const claimed = await transaction.matchmakingTicket.updateMany({
      data: { commitmentExpiresAt, status: MatchmakingTicketStatus.MATCHED },
      where: { id: candidate.id, status: MatchmakingTicketStatus.SEARCHING },
    });
    if (claimed.count !== 1) throw new ConflictException('Queue slot was already assigned');
    await transaction.matchmakingTicket.create({
      data: {
        commitmentExpiresAt,
        createdAt: now,
        duelId: candidate.duelId,
        id: createId('mtkt'),
        packId: candidate.packId,
        providerMode: candidate.providerMode,
        queueKey: candidate.queueKey,
        regionSegment: candidate.regionSegment,
        riskSegment: candidate.riskSegment,
        role: MatchmakingTicketRole.OPPONENT,
        status: MatchmakingTicketStatus.MATCHED,
        tier: candidate.tier,
        valuationPolicyHash: candidate.valuationPolicyHash,
        wallet,
      },
    });
    const duelChanged = await transaction.duel.updateMany({
      data: {
        commitmentExpiresAt,
        matchedAt: now,
        opponentJoinedAt: now,
        opponentWallet: wallet,
        status: DuelStatus.MATCHED,
        version: { increment: 1 },
      },
      where: { id: candidate.duelId, status: DuelStatus.WAITING, version: candidate.duel.version },
    });
    if (duelChanged.count !== 1) throw new ConflictException('Queue slot was already assigned');
    await appendDuelEvent(transaction, {
      data: {
        commitmentExpiresAt: commitmentExpiresAt.toISOString(),
        queueKey: candidate.queueKey,
      },
      duelId: candidate.duelId,
      fromStatus: DuelStatus.WAITING,
      sequence: candidate.duel.version + 1,
      toStatus: DuelStatus.MATCHED,
      type: 'matchmaking.matched',
      wallet,
    });
    await appendMetric(transaction, {
      duelId: candidate.duelId,
      name: ProductEventName.MATCHMAKING_MATCHED,
      status: DuelStatus.MATCHED,
      tier: candidate.tier,
    });
    return toSession(await findTicketOrThrow(transaction, wallet));
  }

  private async createSearch(
    transaction: Prisma.TransactionClient,
    wallet: string,
    pack: Pack,
    providerMode: ProviderMode,
    segment: QueueSegment,
    queueKey: string,
    now: Date,
  ) {
    const duelId = createId('duel');
    const expiresAt = new Date(now.getTime() + searchLifetimeMs());
    const tier = moneyToTier(pack.price.amount, pack.price.decimals);
    const valuationPolicyHash = requireValuationPolicy(pack);
    await transaction.duel.create({
      data: {
        creatorWallet: wallet,
        expiresAt,
        houseOpponent: false,
        id: duelId,
        mode: DuelMode.OPEN,
        packId: pack.id,
        packName: pack.name,
        packProvider: pack.provider,
        providerMode,
        ...(pack.providerPackId ? { providerPackId: pack.providerPackId } : {}),
        stakeAmount: pack.price.amount,
        stakeCurrency: pack.price.currency,
        stakeDecimals: pack.price.decimals,
        status: DuelStatus.WAITING,
        valuationPolicyHash,
      },
    });
    await transaction.matchmakingTicket.create({
      data: {
        createdAt: now,
        duelId,
        id: createId('mtkt'),
        packId: pack.id,
        providerMode,
        queueKey,
        regionSegment: segment.regionSegment,
        riskSegment: segment.riskSegment,
        role: MatchmakingTicketRole.CREATOR,
        status: MatchmakingTicketStatus.SEARCHING,
        tier,
        valuationPolicyHash,
        wallet,
      },
    });
    await appendDuelEvent(transaction, {
      data: {
        queueKey,
        regionSegment: segment.regionSegment,
        riskSegment: segment.riskSegment,
      },
      duelId,
      sequence: 1,
      toStatus: DuelStatus.WAITING,
      type: 'matchmaking.search_started',
      wallet,
    });
    await appendMetric(transaction, {
      duelId,
      name: ProductEventName.MATCHMAKING_WAIT_STARTED,
      status: DuelStatus.WAITING,
      tier,
    });
    return toSession(await findTicketOrThrow(transaction, wallet));
  }

  private async assertWalletAllowed(wallet: string, now: Date): Promise<void> {
    const behavior = await this.database.matchmakingBehavior.findUnique({ where: { wallet } });
    if (behavior?.blockedUntil && behavior.blockedUntil > now) {
      throw new HttpException(
        'Wallet is temporarily blocked after repeated failed commitments',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async findSession(wallet: string) {
    const ticket = await this.database.matchmakingTicket.findUnique({
      include: { duel: true },
      where: { wallet },
    });
    if (!ticket) return null;
    if (
      ticket.duel.status !== DuelStatus.WAITING &&
      ticket.duel.status !== DuelStatus.MATCHED &&
      ticket.duel.status !== DuelStatus.COMMITTING
    ) {
      await this.database.matchmakingTicket.deleteMany({ where: { duelId: ticket.duelId } });
      return null;
    }
    return toSession(ticket);
  }
}

export interface QueueSegment {
  regionSegment: string;
  riskSegment: string;
}

export function loadQueueSegment(environment: NodeJS.ProcessEnv = process.env): QueueSegment {
  const regionSegment = environment.OPENPACKSDUEL_MATCHMAKING_REGION_SEGMENT?.trim();
  const riskSegment = environment.OPENPACKSDUEL_MATCHMAKING_RISK_SEGMENT?.trim();
  if (!regionSegment || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(regionSegment)) {
    throw new ServiceUnavailableException('Verified matchmaking region segment is not configured');
  }
  if (!riskSegment || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(riskSegment)) {
    throw new ServiceUnavailableException('Matchmaking risk segment is not configured');
  }
  return { regionSegment, riskSegment };
}

export function queueSegmentKey(input: {
  pack: Pack;
  providerMode: ProviderMode;
  regionSegment: string;
  riskSegment: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.pack.id,
        input.pack.price.amount,
        input.pack.price.decimals,
        requireValuationPolicy(input.pack),
        input.providerMode,
        input.regionSegment,
        input.riskSegment,
      ].join('|'),
    )
    .digest('hex');
}

function toSession(ticket: TicketWithDuel) {
  const houseEnabled = readRiskLimits().houseEnabled;
  const searching = ticket.status === MatchmakingTicketStatus.SEARCHING;
  return {
    availableActions: [
      { action: 'continue_search', available: searching },
      {
        action: 'cancel_search',
        available:
          ticket.duel.status === DuelStatus.WAITING || ticket.duel.status === DuelStatus.MATCHED,
      },
      {
        action: 'house_fallback',
        available: searching && houseEnabled,
        disclosure: 'House fallback uses a disclosed house-funded opponent and is never automatic.',
      },
    ],
    cancellationRule:
      'Search or a matched slot may be cancelled before funding. After commitment, recovery rules apply.',
    commitmentExpiresAt: ticket.duel.commitmentExpiresAt?.toISOString() ?? null,
    duelId: ticket.duelId,
    houseOpponent: ticket.duel.houseOpponent,
    opponentWallet: ticket.duel.opponentWallet,
    searchExpiresAt: ticket.duel.expiresAt.toISOString(),
    queue: {
      packId: ticket.packId,
      providerMode: ticket.providerMode.toLowerCase().replaceAll('_', '-'),
      queueKey: ticket.queueKey,
      regionSegment: ticket.regionSegment,
      riskSegment: ticket.riskSegment,
      tier: ticket.tier,
      valuationPolicyHash: ticket.valuationPolicyHash,
    },
    role: ticket.role.toLowerCase(),
    state: ticket.status === MatchmakingTicketStatus.SEARCHING ? 'searching' : 'matched',
    wallet: ticket.wallet,
  };
}

async function findTicket(transaction: Prisma.TransactionClient, wallet: string) {
  return transaction.matchmakingTicket.findUnique({ include: { duel: true }, where: { wallet } });
}

async function findTicketOrThrow(transaction: Prisma.TransactionClient, wallet: string) {
  return transaction.matchmakingTicket.findUniqueOrThrow({
    include: { duel: true },
    where: { wallet },
  });
}

async function recordFailedCommitment(
  transaction: Prisma.TransactionClient,
  wallet: string,
  now: Date,
) {
  const current = await transaction.matchmakingBehavior.findUnique({ where: { wallet } });
  const next = nextBehaviorState(current, now, {
    blockMs: failedCommitmentBlockMs(),
    maxFailures: maxFailedCommitments(),
  });
  return transaction.matchmakingBehavior.upsert({
    create: {
      ...next,
      wallet,
    },
    update: next,
    where: { wallet },
  });
}

async function appendDuelEvent(
  transaction: Prisma.TransactionClient,
  input: {
    data?: Record<string, unknown>;
    duelId: string;
    fromStatus?: DuelStatus;
    sequence: number;
    toStatus: DuelStatus;
    type: string;
    wallet?: string;
  },
) {
  await transaction.duelEvent.create({
    data: {
      ...(input.wallet ? { actorWallet: input.wallet } : {}),
      ...(input.data ? { data: input.data as Prisma.InputJsonValue } : {}),
      duelId: input.duelId,
      ...(input.fromStatus ? { fromStatus: input.fromStatus } : {}),
      id: createId('evt'),
      sequence: input.sequence,
      toStatus: input.toStatus,
      type: input.type,
    },
  });
}

async function appendMetric(
  transaction: Prisma.TransactionClient,
  input: {
    duelId: string;
    mode?: DuelMode;
    name: ProductEventName;
    status: DuelStatus;
    tier: number;
  },
) {
  await transaction.productEvent.create({
    data: {
      duelId: input.duelId,
      id: createId('pevt'),
      mode: input.mode ?? DuelMode.OPEN,
      name: input.name,
      source: ProductEventSource.SERVER,
      status: input.status,
      tier: input.tier,
    },
  });
}

export function nextBehaviorState(
  current: {
    failedCommitments: number;
    failureWindowStartedAt: Date;
  } | null,
  now: Date,
  limits: { blockMs: number; maxFailures: number },
) {
  const sameWindow = Boolean(
    current && now.getTime() - current.failureWindowStartedAt.getTime() < FAILURE_WINDOW_MS,
  );
  const failedCommitments = sameWindow ? (current?.failedCommitments ?? 0) + 1 : 1;
  return {
    blockedUntil:
      failedCommitments >= limits.maxFailures ? new Date(now.getTime() + limits.blockMs) : null,
    failedCommitments,
    failureWindowStartedAt: sameWindow && current ? current.failureWindowStartedAt : now,
  };
}

export function commitmentTimeoutPolicy(input: {
  creatorBlocked: boolean;
  creatorFunded: boolean;
  mode: DuelMode;
  status: DuelStatus;
}) {
  const committing = input.status === DuelStatus.COMMITTING;
  const offenderRole = committing
    ? input.creatorFunded
      ? MatchmakingTicketRole.OPPONENT
      : null
    : MatchmakingTicketRole.CREATOR;
  const canRequeueCreator =
    input.status === DuelStatus.MATCHED && input.mode === DuelMode.OPEN && !input.creatorBlocked;
  return {
    cancellationReason: committing
      ? input.creatorFunded
        ? 'opponent_commitment_timeout'
        : 'funding_finality_timeout'
      : input.creatorBlocked
        ? 'repeated_failed_commitments'
        : input.mode === DuelMode.HOUSE
          ? 'house_commitment_timeout'
          : 'creator_commitment_timeout',
    canRequeueCreator,
    nextStatus: committing
      ? DuelStatus.REFUNDING
      : canRequeueCreator
        ? DuelStatus.WAITING
        : DuelStatus.CANCELLED,
    offenderRole,
  };
}

export function shouldRetryMatchmakingTransaction(error: unknown, attempt: number): boolean {
  return (
    attempt < MATCHMAKING_TRANSACTION_ATTEMPTS &&
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}

function resolveProviderMode(): ProviderMode {
  const value = process.env.OPENPACKSDUEL_PROVIDER_MODE ?? 'mock';
  if (value === 'mock') return ProviderMode.MOCK;
  if (value === 'collector-crypt-sandbox') return ProviderMode.COLLECTOR_CRYPT_SANDBOX;
  throw new ServiceUnavailableException('Configured provider mode is invalid');
}

function requireValuationPolicy(pack: Pack): string {
  if (!pack.valuationPolicyHash || !/^[a-f0-9]{64}$/.test(pack.valuationPolicyHash)) {
    throw new ServiceUnavailableException('Pack valuation policy is unavailable');
  }
  return pack.valuationPolicyHash;
}

function moneyToTier(amount: string, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

function commitmentWindowMs(): number {
  return boundedSeconds(process.env.OPENPACKSDUEL_MATCHMAKING_COMMITMENT_SECONDS, 120, 30, 600);
}

function searchLifetimeMs(): number {
  return boundedSeconds(process.env.OPENPACKSDUEL_MATCHMAKING_SEARCH_SECONDS, 900, 60, 3_600);
}

function maxFailedCommitments(): number {
  return boundedInteger(process.env.OPENPACKSDUEL_MATCHMAKING_MAX_FAILURES, 3, 1, 10);
}

function failedCommitmentBlockMs(): number {
  return boundedSeconds(process.env.OPENPACKSDUEL_MATCHMAKING_BLOCK_SECONDS, 1_800, 60, 86_400);
}

function boundedSeconds(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return boundedInteger(value, fallback, minimum, maximum) * 1_000;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

type TicketWithDuel = Prisma.MatchmakingTicketGetPayload<{ include: { duel: true } }>;
