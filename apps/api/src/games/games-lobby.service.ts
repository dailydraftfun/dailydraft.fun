import {
  GAME_AVAILABILITY_SCHEMA_VERSION,
  type GameCatalogMode,
  type PublicGameAvailability,
  type PublicGameAvailabilityMode,
  type PublicGameModeId,
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivity,
  type VerifiedGameActivityPage,
  verifyRgsProof,
} from '@dailydraft/contracts';
import {
  type DatabaseClient,
  DuelSide,
  DuelStatus,
  type Prisma,
  ProviderMode,
} from '@dailydraft/db';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import { toDuel, toDuelTransaction } from '../duels/prisma-duel.repository.js';
import { buildPublicDuelReceipt, pseudonymizeWallet } from '../duels/public-duel-proof.js';
import { evaluateRealValuePolicy, type RealValueCapability } from '../policy/real-value-policy.js';
import { buildDuelRgsProof } from '../rgs/rgs-proof.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GamesCatalogService } from './games-catalog.service.js';
import type { ListVerifiedGameActivityQuery } from './games-lobby.dto.js';

const PUBLIC_ACTIVITY_CACHE_TTL_MS = 30_000;
const PUBLIC_ACTIVITY_CACHE_ENTRY_LIMIT = 100;
const PUBLIC_ACTIVITY_SCAN_LIMIT = 500;
const PUBLIC_ACTIVITY_SCAN_BATCH = 100;

type ActivityCursor = {
  id: string;
  mode: PublicGameModeId;
  occurredAt: string;
};

export type PublicDuelActivityCandidate = Prisma.DuelGetPayload<{
  include: {
    packOutcomes: true;
    providerOperations: true;
    transactions: true;
  };
}>;

const ACTION_POLICY_CAPABILITIES = {
  'direct-challenge': [
    'duel.create.direct',
    'duel.funding.prepare',
    'duel.join',
    'duel.pack.open',
    'provider.escrow.prepare',
  ],
  'house-opponent': [
    'duel.create.house',
    'duel.funding.prepare',
    'duel.pack.open',
    'matchmaking.house-fallback',
    'provider.escrow.prepare',
  ],
  'open-matchmaking': [
    'duel.create.open',
    'duel.funding.prepare',
    'duel.join',
    'duel.pack.open',
    'matchmaking.search',
    'provider.escrow.prepare',
  ],
} as const satisfies Record<string, readonly RealValueCapability[]>;

@Injectable()
export class GamesLobbyService {
  readonly #activityCache = new PublicGamesActivityCache();

  constructor(
    private readonly catalog: GamesCatalogService,
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
  ) {}

  async getAvailability(
    asOf: Date = new Date(),
    environment: NodeJS.ProcessEnv = process.env,
  ): Promise<PublicGameAvailability> {
    const catalog = await this.catalog.getCatalog(asOf);
    const modes = catalog.modes.map((mode): PublicGameAvailabilityMode => {
      const resolved = mode.id === 'duel' ? applyDuelPolicyGates(mode, environment) : mode;
      return {
        asOf: catalog.asOf,
        availableActions: resolved.availableActions,
        capabilitySource: resolved.capabilitySource,
        id: mode.id,
        reason: resolved.reason,
        state: resolved.state,
      };
    });

    return {
      asOf: catalog.asOf,
      modes,
      network: catalog.network,
      schemaVersion: GAME_AVAILABILITY_SCHEMA_VERSION,
    };
  }

  getVerifiedActivity(
    query: ListVerifiedGameActivityQuery,
    asOf: Date = new Date(),
  ): Promise<VerifiedGameActivityPage> {
    const cursor = query.cursor ? decodeActivityCursor(query.cursor) : null;
    const cacheKey = `${query.limit}:${query.cursor ?? ''}`;
    return this.#activityCache.get(cacheKey, () =>
      this.loadVerifiedActivity(query.limit, cursor, asOf),
    );
  }

  private async loadVerifiedActivity(
    limit: number,
    cursor: ActivityCursor | null,
    asOf: Date,
  ): Promise<VerifiedGameActivityPage> {
    const projected: Array<{ activity: VerifiedGameActivity; cursor: ActivityCursor }> = [];
    let scanCursor = cursor;
    let scanned = 0;
    let exhausted = false;

    while (projected.length < limit + 1 && scanned < PUBLIC_ACTIVITY_SCAN_LIMIT) {
      const take = Math.min(PUBLIC_ACTIVITY_SCAN_BATCH, PUBLIC_ACTIVITY_SCAN_LIMIT - scanned);
      const rows = (await this.database.duel.findMany({
        include: {
          packOutcomes: { orderBy: { side: 'asc' } },
          providerOperations: { orderBy: { side: 'asc' } },
          transactions: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
        take,
        where: verifiedDuelActivityWhere(scanCursor),
      })) as PublicDuelActivityCandidate[];
      if (rows.length === 0) {
        exhausted = true;
        break;
      }

      for (const row of rows) {
        scanned += 1;
        scanCursor = activityCursorForRow(row);
        const activity = projectVerifiedDuelActivity(row);
        if (activity) projected.push({ activity, cursor: scanCursor });
        if (projected.length === limit + 1 || scanned === PUBLIC_ACTIVITY_SCAN_LIMIT) break;
      }
      if (projected.length === limit + 1 || scanned === PUBLIC_ACTIVITY_SCAN_LIMIT) break;
      if (rows.length < take) {
        exhausted = true;
        break;
      }
    }

    const data = projected.slice(0, limit).map((entry) => entry.activity);
    const hasMore = projected.length > limit || !exhausted;
    const nextBoundary =
      projected.length > limit ? (projected[limit - 1]?.cursor ?? null) : scanCursor;
    const nextCursor = hasMore && nextBoundary ? encodeActivityCursor(nextBoundary) : null;

    return {
      asOf: asOf.toISOString(),
      data,
      hasMore,
      nextCursor,
      schemaVersion: VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
    };
  }
}

export class PublicGamesActivityCache {
  readonly #entries = new Map<
    string,
    { expiresAt: number | null; snapshot: Promise<VerifiedGameActivityPage> }
  >();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = PUBLIC_ACTIVITY_CACHE_TTL_MS,
    private readonly entryLimit = PUBLIC_ACTIVITY_CACHE_ENTRY_LIMIT,
  ) {}

  get(
    key: string,
    loader: () => Promise<VerifiedGameActivityPage>,
  ): Promise<VerifiedGameActivityPage> {
    const now = this.now();
    const current = this.#entries.get(key);
    if (current && (current.expiresAt === null || current.expiresAt > now)) {
      return current.snapshot;
    }
    if (current) this.#entries.delete(key);
    this.prune(now);

    const snapshot = Promise.resolve().then(loader);
    const entry = { expiresAt: null as number | null, snapshot };
    this.#entries.set(key, entry);
    void snapshot.then(
      () => {
        if (this.#entries.get(key) === entry) entry.expiresAt = this.now() + this.ttlMs;
      },
      () => {
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
      },
    );
    return snapshot;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.#entries.delete(key);
    }
    while (this.#entries.size >= this.entryLimit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }
}

export function applyDuelPolicyGates(
  mode: Extract<GameCatalogMode, { id: 'duel' }> | GameCatalogMode,
  environment: NodeJS.ProcessEnv,
): GameCatalogMode {
  if (mode.id !== 'duel' || mode.availableActions.length === 0) return mode;

  const availableActions = mode.availableActions.filter((action) => {
    const capabilities: readonly RealValueCapability[] | undefined =
      ACTION_POLICY_CAPABILITIES[action.id as keyof typeof ACTION_POLICY_CAPABILITIES];
    if (!capabilities) return false;
    return capabilities.every(
      (capability) => evaluateRealValuePolicy(capability, environment).allowed,
    );
  });
  if (availableActions.length === mode.availableActions.length) return mode;

  return {
    ...mode,
    availableActions,
    capabilitySource: { ...mode.capabilitySource, status: 'gated' },
    reason:
      availableActions.length > 0
        ? 'Only the listed Duel actions are admitted by the current real-value policy.'
        : 'Duel play is unavailable under the current real-value policy.',
    state: availableActions.length > 0 ? 'degraded' : 'unavailable',
  };
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  if (!isValidCursor(cursor)) throw new BadRequestException('activity cursor is invalid');
  return `v1.${Buffer.from(JSON.stringify(cursor)).toString('base64url')}`;
}

export function decodeActivityCursor(value: string): ActivityCursor {
  if (!/^v1\.[A-Za-z0-9_-]{1,480}$/.test(value)) {
    throw new BadRequestException('activity cursor is invalid');
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice(3), 'base64url').toString('utf8'),
    ) as unknown;
    if (!isValidCursor(decoded)) throw new Error('invalid cursor payload');
    return decoded;
  } catch {
    throw new BadRequestException('activity cursor is invalid');
  }
}

export function projectVerifiedDuelActivity(
  row: PublicDuelActivityCandidate,
): VerifiedGameActivity | null {
  try {
    const duel = toDuel(row);
    const receipt = buildPublicDuelReceipt(duel, row.transactions.map(toDuelTransaction));
    const proof = buildDuelRgsProof(row);
    const verification = verifyRgsProof(proof);
    const proofResult = jsonObject(proof.result);

    if (
      duel.status !== 'settled' ||
      proof.phase !== 'settled' ||
      proof.mode !== 'duel' ||
      proof.roundId !== duel.id ||
      !verification.valid ||
      !receipt.availability.complete ||
      receipt.duel.id !== duel.id ||
      receipt.duel.status !== 'settled' ||
      !receipt.result ||
      !receipt.result.settlementReady ||
      !proofResult ||
      proofResult.comparisonHash !== receipt.result.resultHash ||
      proofResult.winnerSide !== receipt.result.winnerSide ||
      receipt.pack.tier.amount !== duel.stake.amount ||
      receipt.pack.tier.currency !== duel.stake.currency ||
      receipt.pack.tier.decimals !== duel.stake.decimals
    ) {
      return null;
    }

    const creatorLabel = pseudonymizeWallet(duel.creatorWallet);
    const opponentLabel = duel.houseOpponent
      ? 'DailyDraft House'
      : pseudonymizeWallet(duel.opponentWallet ?? '');
    const winnerLabel =
      duel.winnerWallet === duel.creatorWallet
        ? creatorLabel
        : duel.winnerWallet === duel.opponentWallet
          ? opponentLabel
          : null;

    return {
      activityId: `duel:${duel.id}`,
      mode: 'duel',
      occurredAt: duel.settledAt as string,
      participants: [
        { label: creatorLabel, role: 'player' },
        { label: opponentLabel, role: duel.houseOpponent ? 'house' : 'player' },
      ],
      receiptHref: `/v1/duels/${duel.id}/receipt`,
      result: duel.winnerWallet === null ? 'tie' : 'winner-verified',
      resultHref: `/v1/rgs/rounds/duel/${duel.id}/proof`,
      resultSummary: winnerLabel
        ? `${winnerLabel} won a verified ${duel.pack.name} Duel.`
        : `${creatorLabel} and ${opponentLabel} tied in a verified ${duel.pack.name} Duel.`,
      tier: duel.stake,
      title: `${duel.pack.name} Duel settled`,
      verification: 'settled-rgs-proof',
    };
  } catch {
    return null;
  }
}

function verifiedDuelActivityWhere(cursor: ActivityCursor | null): Prisma.DuelWhereInput {
  if (cursor && cursor.mode !== 'duel') {
    throw new BadRequestException('activity cursor mode is not available');
  }
  return {
    AND: [
      { packOutcomes: { some: { isMock: false, side: DuelSide.CREATOR } } },
      { packOutcomes: { some: { isMock: false, side: DuelSide.OPPONENT } } },
      {
        providerOperations: {
          some: {
            payloadHash: { not: null },
            providerReference: { not: null },
            resultHash: { not: null },
            side: DuelSide.CREATOR,
            signature: { not: null },
            signatureAlgorithm: { not: null },
            signingKeyReference: { not: null },
          },
        },
      },
      {
        providerOperations: {
          some: {
            payloadHash: { not: null },
            providerReference: { not: null },
            resultHash: { not: null },
            side: DuelSide.OPPONENT,
            signature: { not: null },
            signatureAlgorithm: { not: null },
            signingKeyReference: { not: null },
          },
        },
      },
      ...(cursor
        ? [
            {
              OR: [
                { settledAt: { lt: new Date(cursor.occurredAt) } },
                {
                  id: { lt: cursor.id },
                  settledAt: new Date(cursor.occurredAt),
                },
              ],
            },
          ]
        : []),
    ],
    providerMode: { not: ProviderMode.MOCK },
    escrowAddress: { not: null },
    resultHash: { not: null },
    resultReadyAt: { not: null },
    rgsCommitmentHash: { not: null },
    rgsConfigHash: { not: null },
    rgsRulesHash: { not: null },
    settledAt: { not: null },
    status: DuelStatus.SETTLED,
    valuationPolicyHash: { not: null },
  };
}

function activityCursorForRow(
  row: Pick<PublicDuelActivityCandidate, 'id' | 'settledAt'>,
): ActivityCursor {
  if (!row.settledAt) throw new BadRequestException('activity cursor is invalid');
  return { id: row.id, mode: 'duel', occurredAt: row.settledAt.toISOString() };
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isValidCursor(value: unknown): value is ActivityCursor {
  if (!value || typeof value !== 'object') return false;
  const cursor = value as Partial<ActivityCursor>;
  if (
    typeof cursor.id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(cursor.id) ||
    !['duel', 'flip', 'crash'].includes(cursor.mode ?? '') ||
    typeof cursor.occurredAt !== 'string'
  ) {
    return false;
  }
  const timestamp = new Date(cursor.occurredAt);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === cursor.occurredAt;
}
