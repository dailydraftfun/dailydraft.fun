import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type DatabaseClient,
  ProductEventName as DatabaseEventName,
  DuelMode,
  DuelStatus,
  ProductEventSource,
} from '@openpacksduel/db';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import type {
  AnalyticsFunnelQuery,
  IngestProductEventsRequest,
  ProductEventName,
  ProductEventRequest,
} from './analytics.dto.js';

const CLIENT_EVENT_LIMIT = 120;
const CLIENT_EVENT_WINDOW_MS = 5 * 60 * 1_000;
const REPORT_EVENT_LIMIT = 10_000;
const ABANDONMENT_AFTER_MS = 15 * 60 * 1_000;

export type NormalizedEvent = {
  createdAt: Date;
  duelId: string | null;
  id: string;
  mode: 'direct' | 'house' | 'open' | null;
  name: ProductEventName;
  sessionId: string | null;
  source: 'client' | 'server';
  status: string | null;
  tier: number | null;
};

type ServerEvent = ProductEventRequest & { sessionId?: string };

@Injectable()
export class AnalyticsService {
  readonly #logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  async ingest(input: IngestProductEventsRequest): Promise<{ accepted: number }> {
    const now = new Date();
    const since = new Date(now.getTime() - CLIENT_EVENT_WINDOW_MS);
    await this.database.$transaction(async (transaction) => {
      const recent = await transaction.productEvent.count({
        where: {
          createdAt: { gte: since },
          sessionId: input.sessionId,
          source: ProductEventSource.CLIENT,
        },
      });
      if (recent + input.events.length > CLIENT_EVENT_LIMIT) {
        throw new HttpException(
          'Anonymous analytics session rate limit exceeded',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await transaction.productEvent.createMany({
        data: input.events.map((event) =>
          toDatabaseEvent(event, input.sessionId, ProductEventSource.CLIENT, now),
        ),
      });
    });
    return { accepted: input.events.length };
  }

  async recordServer(event: ServerEvent): Promise<void> {
    try {
      await this.database.productEvent.create({
        data: toDatabaseEvent(
          event,
          event.sessionId ?? null,
          ProductEventSource.SERVER,
          new Date(),
        ),
      });
      this.#logger.log(toStructuredLog('product_event', event));
    } catch {
      this.#logger.warn(toStructuredLog('analytics_write_failed', event));
    }
  }

  async getFunnel(query: AnalyticsFunnelQuery) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - query.windowHours * 60 * 60 * 1_000);
    const stuckThresholdMinutes = resolveStuckThresholdMinutes();
    const stuckBefore = new Date(now.getTime() - stuckThresholdMinutes * 60 * 1_000);
    const [rows, stuckCount, oldestStuck, statuses] = await Promise.all([
      this.database.productEvent.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          duelId: true,
          id: true,
          mode: true,
          name: true,
          sessionId: true,
          source: true,
          status: true,
          tier: true,
        },
        take: REPORT_EVENT_LIMIT + 1,
        where: { createdAt: { gte: windowStart } },
      }),
      this.database.duel.count({
        where: { fundedAt: { lt: stuckBefore }, status: DuelStatus.FUNDED },
      }),
      this.database.duel.findFirst({
        orderBy: { fundedAt: 'asc' },
        select: { fundedAt: true, id: true },
        where: { fundedAt: { lt: stuckBefore }, status: DuelStatus.FUNDED },
      }),
      this.database.duel.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const truncated = rows.length > REPORT_EVENT_LIMIT;
    const events = rows.slice(0, REPORT_EVENT_LIMIT).reverse().map(toNormalizedEvent);
    return buildFunnelReport({
      events,
      generatedAt: now,
      oldestStuck,
      statuses: Object.fromEntries(
        statuses.map((row) => [toApiStatus(row.status), row._count._all]),
      ),
      stuckCount,
      stuckThresholdMinutes,
      truncated,
      windowHours: query.windowHours,
      windowStart,
    });
  }
}

export function buildFunnelReport(input: {
  events: NormalizedEvent[];
  generatedAt: Date;
  oldestStuck: { fundedAt: Date | null; id: string } | null;
  statuses: Record<string, number>;
  stuckCount: number;
  stuckThresholdMinutes: number;
  truncated: boolean;
  windowHours: number;
  windowStart: Date;
}) {
  const counts = eventCounts(input.events);
  const serverEvents = input.events.filter((event) => event.source === 'server');
  const matchLatencyMs = latencySamples(serverEvents, 'duel_created', 'duel_matched');
  const matchmakingWaitMs = latencySamples(
    serverEvents,
    'matchmaking_wait_started',
    'matchmaking_matched',
  );
  const providerLatencyMs = latencySamples(serverEvents, 'pack_reveal_started', 'pack_revealed');
  const abandoned = abandonedDuels(serverEvents, input.generatedAt);
  const eligibleForAbandonment = serverEvents.filter(
    (event) =>
      event.name === 'duel_created' &&
      event.duelId &&
      event.createdAt.getTime() <= input.generatedAt.getTime() - ABANDONMENT_AFTER_MS,
  );

  return {
    alerts: {
      stuckFunded: {
        active: input.stuckCount > 0,
        count: input.stuckCount,
        oldestDuelId: input.oldestStuck?.id ?? null,
        oldestFundedAt: input.oldestStuck?.fundedAt?.toISOString() ?? null,
        thresholdMinutes: input.stuckThresholdMinutes,
      },
    },
    errors: {
      provider: counts.provider_error,
      settlement: counts.settlement_failed,
      solanaRpc: counts.solana_rpc_error,
    },
    experience: {
      revealAnimations: uniqueCount(input.events, 'pack_reveal_started', 'client'),
      uiErrors: counts.ui_error,
    },
    funnel: {
      counts,
      rates: {
        authenticatedFromConnected: ratio(counts.wallet_authenticated, counts.wallet_connected),
        createdFromAuthenticated: ratio(counts.duel_created, counts.wallet_authenticated),
        fundedFromMatched: ratio(counts.duel_funded, counts.duel_matched),
        matchedFromCreated: ratio(counts.duel_matched, counts.duel_created),
        revealedFromFunded: ratio(counts.pack_revealed, counts.duel_funded),
        settledFromRevealed: ratio(counts.duel_settled, counts.pack_revealed),
        walletConnectedFromLobby: ratio(counts.wallet_connected, counts.lobby_viewed),
      },
    },
    generatedAt: input.generatedAt.toISOString(),
    latencyMs: {
      match: distribution(matchLatencyMs),
      matchmakingWait: distribution(matchmakingWaitMs),
      provider: distribution(providerLatencyMs),
    },
    matchmaking: {
      abandoned: counts.matchmaking_abandoned,
      commitmentFailed: counts.matchmaking_commitment_failed,
      fallbackSelected: counts.house_fallback_selected,
      matched: counts.matchmaking_matched,
      rates: {
        abandonment: ratio(counts.matchmaking_abandoned, counts.matchmaking_wait_started),
        fallback: ratio(counts.house_fallback_selected, counts.matchmaking_wait_started),
        matched: ratio(counts.matchmaking_matched, counts.matchmaking_wait_started),
      },
      waitStarted: counts.matchmaking_wait_started,
    },
    rates: {
      abandonment: ratio(
        abandoned,
        new Set(eligibleForAbandonment.map((event) => event.duelId)).size,
      ),
      refund: ratio(counts.duel_refunded, counts.duel_funded),
      settlementFailure: ratio(counts.settlement_failed, counts.pack_revealed),
    },
    sampled: input.truncated,
    statusCounts: input.statuses,
    window: { from: input.windowStart.toISOString(), hours: input.windowHours },
  };
}

function toDatabaseEvent(
  event: ProductEventRequest,
  sessionId: string | null,
  source: ProductEventSource,
  createdAt: Date,
) {
  return {
    createdAt,
    ...(event.duelId ? { duelId: event.duelId } : {}),
    id: `pevt_${crypto.randomUUID().replaceAll('-', '')}`,
    ...(event.mode ? { mode: toDatabaseMode(event.mode) } : {}),
    name: eventNameToDatabase[event.name],
    ...(sessionId ? { sessionId } : {}),
    source,
    ...(event.status ? { status: statusToDatabase[event.status] } : {}),
    ...(event.tier ? { tier: event.tier } : {}),
  };
}

function toNormalizedEvent(row: {
  createdAt: Date;
  duelId: string | null;
  id: string;
  mode: DuelMode | null;
  name: DatabaseEventName;
  sessionId: string | null;
  source: ProductEventSource;
  status: DuelStatus | null;
  tier: number | null;
}): NormalizedEvent {
  return {
    ...row,
    mode: row.mode ? toApiMode(row.mode) : null,
    name: eventNameToApi[row.name],
    source: row.source === ProductEventSource.SERVER ? 'server' : 'client',
    status: row.status ? toApiStatus(row.status) : null,
  };
}

function uniqueCount(
  events: NormalizedEvent[],
  name: ProductEventName,
  source: NormalizedEvent['source'] = eventCountSource[name],
): number {
  return uniqueKeys(
    events.filter((event) => event.name === name && event.source === source),
    source,
  ).size;
}

function eventCounts(events: NormalizedEvent[]): Record<ProductEventName, number> {
  return {
    duel_cancelled: uniqueCount(events, 'duel_cancelled'),
    duel_created: uniqueCount(events, 'duel_created'),
    duel_funded: uniqueCount(events, 'duel_funded'),
    duel_matched: uniqueCount(events, 'duel_matched'),
    duel_refunded: uniqueCount(events, 'duel_refunded'),
    duel_rematched: uniqueCount(events, 'duel_rematched'),
    duel_settled: uniqueCount(events, 'duel_settled'),
    duel_shared: uniqueCount(events, 'duel_shared'),
    lobby_viewed: uniqueCount(events, 'lobby_viewed'),
    pack_reveal_started: uniqueCount(events, 'pack_reveal_started'),
    pack_revealed: uniqueCount(events, 'pack_revealed'),
    provider_error: uniqueCount(events, 'provider_error'),
    settlement_failed: uniqueCount(events, 'settlement_failed'),
    solana_rpc_error: uniqueCount(events, 'solana_rpc_error'),
    tier_selected: uniqueCount(events, 'tier_selected'),
    ui_error: uniqueCount(events, 'ui_error'),
    wallet_authenticated: uniqueCount(events, 'wallet_authenticated'),
    wallet_connected: uniqueCount(events, 'wallet_connected'),
    matchmaking_wait_started: uniqueCount(events, 'matchmaking_wait_started'),
    matchmaking_matched: uniqueCount(events, 'matchmaking_matched'),
    matchmaking_abandoned: uniqueCount(events, 'matchmaking_abandoned'),
    matchmaking_commitment_failed: uniqueCount(events, 'matchmaking_commitment_failed'),
    house_fallback_selected: uniqueCount(events, 'house_fallback_selected'),
  };
}

function uniqueKeys(events: NormalizedEvent[], source: NormalizedEvent['source']): Set<string> {
  return new Set(
    events.map((event) =>
      source === 'server'
        ? (event.duelId ?? event.sessionId ?? event.id)
        : (event.sessionId ?? event.duelId ?? event.id),
    ),
  );
}

function latencySamples(
  events: NormalizedEvent[],
  startName: ProductEventName,
  endName: ProductEventName,
): number[] {
  const starts = new Map<string, number>();
  const completed = new Set<string>();
  const samples: number[] = [];
  for (const event of events) {
    if (!event.duelId) continue;
    if (event.name === startName && !starts.has(event.duelId))
      starts.set(event.duelId, event.createdAt.getTime());
    if (event.name === endName && !completed.has(event.duelId)) {
      const start = starts.get(event.duelId);
      if (start !== undefined && event.createdAt.getTime() >= start) {
        samples.push(event.createdAt.getTime() - start);
        completed.add(event.duelId);
      }
    }
  }
  return samples;
}

function abandonedDuels(events: NormalizedEvent[], now: Date): number {
  const funded = new Set(
    events.filter((event) => event.name === 'duel_funded').map((event) => event.duelId),
  );
  const abandoned = events.filter(
    (event) =>
      event.name === 'duel_created' &&
      event.duelId &&
      event.createdAt.getTime() <= now.getTime() - ABANDONMENT_AFTER_MS &&
      !funded.has(event.duelId),
  );
  return new Set(abandoned.map((event) => event.duelId)).size;
}

function distribution(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return { count: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

function percentile(sorted: number[], value: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function resolveStuckThresholdMinutes(): number {
  const parsed = Number.parseInt(process.env.OPENPACKSDUEL_STUCK_FUNDED_MINUTES ?? '5', 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1_440 ? parsed : 5;
}

function toStructuredLog(event: string, value: ServerEvent): string {
  return JSON.stringify({
    duelId: value.duelId ?? null,
    event,
    mode: value.mode ?? null,
    name: value.name,
    status: value.status ?? null,
    tier: value.tier ?? null,
  });
}

const eventNameToDatabase: Record<ProductEventName, DatabaseEventName> = {
  duel_cancelled: DatabaseEventName.DUEL_CANCELLED,
  duel_created: DatabaseEventName.DUEL_CREATED,
  duel_funded: DatabaseEventName.DUEL_FUNDED,
  duel_matched: DatabaseEventName.DUEL_MATCHED,
  duel_refunded: DatabaseEventName.DUEL_REFUNDED,
  duel_rematched: DatabaseEventName.DUEL_REMATCHED,
  duel_settled: DatabaseEventName.DUEL_SETTLED,
  duel_shared: DatabaseEventName.DUEL_SHARED,
  lobby_viewed: DatabaseEventName.LOBBY_VIEWED,
  pack_reveal_started: DatabaseEventName.PACK_REVEAL_STARTED,
  pack_revealed: DatabaseEventName.PACK_REVEALED,
  provider_error: DatabaseEventName.PROVIDER_ERROR,
  settlement_failed: DatabaseEventName.SETTLEMENT_FAILED,
  solana_rpc_error: DatabaseEventName.SOLANA_RPC_ERROR,
  tier_selected: DatabaseEventName.TIER_SELECTED,
  ui_error: DatabaseEventName.UI_ERROR,
  wallet_authenticated: DatabaseEventName.WALLET_AUTHENTICATED,
  wallet_connected: DatabaseEventName.WALLET_CONNECTED,
  matchmaking_wait_started: DatabaseEventName.MATCHMAKING_WAIT_STARTED,
  matchmaking_matched: DatabaseEventName.MATCHMAKING_MATCHED,
  matchmaking_abandoned: DatabaseEventName.MATCHMAKING_ABANDONED,
  matchmaking_commitment_failed: DatabaseEventName.MATCHMAKING_COMMITMENT_FAILED,
  house_fallback_selected: DatabaseEventName.HOUSE_FALLBACK_SELECTED,
};

const eventNameToApi: Record<DatabaseEventName, ProductEventName> = {
  DUEL_CANCELLED: 'duel_cancelled',
  DUEL_CREATED: 'duel_created',
  DUEL_FUNDED: 'duel_funded',
  DUEL_MATCHED: 'duel_matched',
  DUEL_REFUNDED: 'duel_refunded',
  DUEL_REMATCHED: 'duel_rematched',
  DUEL_SETTLED: 'duel_settled',
  DUEL_SHARED: 'duel_shared',
  LOBBY_VIEWED: 'lobby_viewed',
  PACK_REVEALED: 'pack_revealed',
  PACK_REVEAL_STARTED: 'pack_reveal_started',
  PROVIDER_ERROR: 'provider_error',
  SETTLEMENT_FAILED: 'settlement_failed',
  SOLANA_RPC_ERROR: 'solana_rpc_error',
  TIER_SELECTED: 'tier_selected',
  UI_ERROR: 'ui_error',
  WALLET_AUTHENTICATED: 'wallet_authenticated',
  WALLET_CONNECTED: 'wallet_connected',
  MATCHMAKING_WAIT_STARTED: 'matchmaking_wait_started',
  MATCHMAKING_MATCHED: 'matchmaking_matched',
  MATCHMAKING_ABANDONED: 'matchmaking_abandoned',
  MATCHMAKING_COMMITMENT_FAILED: 'matchmaking_commitment_failed',
  HOUSE_FALLBACK_SELECTED: 'house_fallback_selected',
};

const eventCountSource: Record<ProductEventName, NormalizedEvent['source']> = {
  duel_cancelled: 'server',
  duel_created: 'server',
  duel_funded: 'server',
  duel_matched: 'server',
  duel_refunded: 'server',
  duel_rematched: 'client',
  duel_settled: 'server',
  duel_shared: 'client',
  lobby_viewed: 'client',
  pack_reveal_started: 'server',
  pack_revealed: 'server',
  provider_error: 'server',
  settlement_failed: 'server',
  solana_rpc_error: 'server',
  tier_selected: 'client',
  ui_error: 'client',
  wallet_authenticated: 'client',
  wallet_connected: 'client',
  matchmaking_wait_started: 'server',
  matchmaking_matched: 'server',
  matchmaking_abandoned: 'server',
  matchmaking_commitment_failed: 'server',
  house_fallback_selected: 'server',
};

const statusToDatabase: Record<NonNullable<ProductEventRequest['status']>, DuelStatus> = {
  awaiting_assets: DuelStatus.AWAITING_ASSETS,
  cancelled: DuelStatus.CANCELLED,
  cancelling: DuelStatus.CANCELLING,
  committing: DuelStatus.COMMITTING,
  failed: DuelStatus.FAILED,
  funded: DuelStatus.FUNDED,
  matched: DuelStatus.MATCHED,
  opening: DuelStatus.OPENING,
  refunded: DuelStatus.REFUNDED,
  refunding: DuelStatus.REFUNDING,
  settled: DuelStatus.SETTLED,
  settling: DuelStatus.SETTLING,
  waiting: DuelStatus.WAITING,
};

function toDatabaseMode(mode: NonNullable<ProductEventRequest['mode']>): DuelMode {
  if (mode === 'direct') return DuelMode.DIRECT;
  if (mode === 'house') return DuelMode.HOUSE;
  return DuelMode.OPEN;
}

function toApiMode(mode: DuelMode): 'direct' | 'house' | 'open' {
  if (mode === DuelMode.DIRECT) return 'direct';
  if (mode === DuelMode.HOUSE) return 'house';
  return 'open';
}

function toApiStatus(status: DuelStatus): string {
  return status.toLowerCase();
}
