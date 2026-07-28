import {
  GAME_AVAILABILITY_SCHEMA_VERSION,
  type GameCatalogMode,
  type PublicGameAvailability,
  type PublicGameAvailabilityMode,
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivity,
  type VerifiedGameActivityPage,
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
import { pseudonymizeWallet } from '../duels/public-duel-proof.js';
import { evaluateRealValuePolicy, type RealValueCapability } from '../policy/real-value-policy.js';
import { createDuelRgsCommitment } from '../rgs/rgs-duel-contract.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GamesCatalogService } from './games-catalog.service.js';
import type { ListVerifiedGameActivityQuery } from './games-lobby.dto.js';

const PUBLIC_ACTIVITY_CACHE_TTL_MS = 30_000;
const PUBLIC_ACTIVITY_CACHE_ENTRY_LIMIT = 100;

type ActivityCursor = {
  id: string;
  occurredAt: string;
};

export type PublicDuelActivityCandidate = {
  creatorWallet: string;
  escrowAddress: string;
  houseOpponent: boolean;
  id: string;
  opponentWallet: string | null;
  packId: string;
  packName: string;
  packOutcomes: Array<{
    isMock: boolean;
    resultHash: string;
    side: DuelSide;
  }>;
  providerMode: ProviderMode;
  providerOperations: Array<{
    generateIdempotencyKey: string;
    openIdempotencyKey: string;
    payloadHash: string | null;
    provider: string;
    providerPackId: string;
    providerReference: string | null;
    recipientWallet: string;
    resultHash: string | null;
    side: DuelSide;
    signature: string | null;
    signatureAlgorithm: string | null;
    signingKeyReference: string | null;
  }>;
  rgsCommitmentHash: string;
  rgsConfigHash: string;
  rgsRulesHash: string;
  settledAt: Date;
  stakeAmount: string;
  stakeCurrency: string;
  stakeDecimals: number;
  valuationPolicyHash: string;
  winnerWallet: string | null;
};

const ACTION_POLICY_CAPABILITIES = {
  'direct-challenge': ['duel.create.direct'],
  'house-opponent': ['duel.create.house', 'matchmaking.house-fallback'],
  'open-matchmaking': ['duel.create.open', 'matchmaking.search'],
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
    const modes = catalog.modes.flatMap((mode): PublicGameAvailabilityMode[] => {
      if (mode.id === 'gacha') return [];
      const resolved = mode.id === 'duel' ? applyDuelPolicyGates(mode, environment) : mode;
      return [
        {
          asOf: catalog.asOf,
          availableActions: resolved.availableActions,
          capabilitySource: resolved.capabilitySource,
          id: mode.id,
          reason: resolved.reason,
          state: resolved.state,
        },
      ];
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
    const rows = (await this.database.duel.findMany({
      orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
      select: {
        creatorWallet: true,
        escrowAddress: true,
        houseOpponent: true,
        id: true,
        opponentWallet: true,
        packId: true,
        packName: true,
        packOutcomes: {
          orderBy: { side: 'asc' },
          select: { isMock: true, resultHash: true, side: true },
        },
        providerMode: true,
        providerOperations: {
          orderBy: { side: 'asc' },
          select: {
            generateIdempotencyKey: true,
            openIdempotencyKey: true,
            payloadHash: true,
            provider: true,
            providerPackId: true,
            providerReference: true,
            recipientWallet: true,
            resultHash: true,
            side: true,
            signature: true,
            signatureAlgorithm: true,
            signingKeyReference: true,
          },
        },
        rgsCommitmentHash: true,
        rgsConfigHash: true,
        rgsRulesHash: true,
        settledAt: true,
        stakeAmount: true,
        stakeCurrency: true,
        stakeDecimals: true,
        valuationPolicyHash: true,
        winnerWallet: true,
      },
      take: limit + 1,
      where: verifiedDuelActivityWhere(cursor),
    })) as PublicDuelActivityCandidate[];

    const projected = rows.flatMap((row) => {
      const activity = projectVerifiedDuelActivity(row);
      return activity ? [activity] : [];
    });
    const data = projected.slice(0, limit);
    const hasMore = rows.length > limit || projected.length > limit;
    const nextCursor = hasMore
      ? encodeActivityCursor(
          data.length > 0
            ? {
                id: requireDuelId(data.at(-1)?.activityId),
                occurredAt: data.at(-1)?.occurredAt ?? '',
              }
            : {
                id: rows.at(-1)?.id ?? '',
                occurredAt: rows.at(-1)?.settledAt.toISOString() ?? '',
              },
        )
      : null;

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
  if (
    row.packOutcomes.length !== 2 ||
    row.providerOperations.length !== 2 ||
    !row.escrowAddress ||
    !row.opponentWallet ||
    row.stakeCurrency !== 'USDC' ||
    row.stakeDecimals !== 6 ||
    !/^[0-9]+$/.test(row.stakeAmount) ||
    row.packOutcomes.some((outcome) => outcome.isMock) ||
    !hasBothSides(row.packOutcomes) ||
    !hasBothSides(row.providerOperations) ||
    row.providerOperations.some(
      (operation) =>
        !operation.payloadHash ||
        !operation.providerReference ||
        !operation.resultHash ||
        !operation.signature ||
        !operation.signatureAlgorithm ||
        !operation.signingKeyReference,
    ) ||
    !providerEvidenceMatchesOutcomes(row) ||
    (row.winnerWallet !== null &&
      row.winnerWallet !== row.creatorWallet &&
      row.winnerWallet !== row.opponentWallet)
  ) {
    return null;
  }

  const commitment = createDuelRgsCommitment({
    duelId: row.id,
    operations: row.providerOperations,
    packId: row.packId,
    providerMode: row.providerMode,
    rulesHash: row.valuationPolicyHash,
  });
  if (
    commitment.commitmentHash !== row.rgsCommitmentHash ||
    commitment.configHash !== row.rgsConfigHash ||
    commitment.rulesHash !== row.rgsRulesHash
  ) {
    return null;
  }

  const creatorLabel = pseudonymizeWallet(row.creatorWallet);
  const opponentLabel = row.houseOpponent
    ? 'DailyDraft House'
    : pseudonymizeWallet(row.opponentWallet ?? '');
  const winnerLabel =
    row.winnerWallet === row.creatorWallet
      ? creatorLabel
      : row.winnerWallet === row.opponentWallet
        ? opponentLabel
        : null;

  return {
    activityId: `duel:${row.id}`,
    mode: 'duel',
    occurredAt: row.settledAt.toISOString(),
    participants: [
      { label: creatorLabel, side: 'creator' },
      { label: opponentLabel, side: 'opponent' },
    ],
    receiptHref: `/duels/${row.id}/receipt`,
    result: row.winnerWallet === null ? 'tie' : 'winner-verified',
    resultHref: `/rgs/rounds/duel/${row.id}/proof`,
    resultSummary: winnerLabel
      ? `${winnerLabel} won a verified ${row.packName} Duel.`
      : `${creatorLabel} and ${opponentLabel} tied in a verified ${row.packName} Duel.`,
    tier: {
      amount: row.stakeAmount,
      currency: 'USDC',
      decimals: 6,
    },
    title: `${row.packName} Duel settled`,
    verification: 'settled-rgs-proof',
  };
}

function verifiedDuelActivityWhere(cursor: ActivityCursor | null): Prisma.DuelWhereInput {
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

function hasBothSides(rows: Array<{ side: DuelSide }>): boolean {
  const sides = new Set(rows.map((row) => row.side));
  return sides.has(DuelSide.CREATOR) && sides.has(DuelSide.OPPONENT);
}

function providerEvidenceMatchesOutcomes(row: PublicDuelActivityCandidate): boolean {
  return row.providerOperations.every((operation) =>
    row.packOutcomes.some(
      (outcome) => outcome.side === operation.side && outcome.resultHash === operation.resultHash,
    ),
  );
}

function isValidCursor(value: unknown): value is ActivityCursor {
  if (!value || typeof value !== 'object') return false;
  const cursor = value as Partial<ActivityCursor>;
  if (
    typeof cursor.id !== 'string' ||
    !/^duel_[A-Za-z0-9]{12,64}$/.test(cursor.id) ||
    typeof cursor.occurredAt !== 'string'
  ) {
    return false;
  }
  const timestamp = new Date(cursor.occurredAt);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === cursor.occurredAt;
}

function requireDuelId(activityId: string | undefined): string {
  const id = activityId?.replace(/^duel:/, '');
  if (!id || !/^duel_[A-Za-z0-9]{12,64}$/.test(id)) {
    throw new BadRequestException('activity cursor is invalid');
  }
  return id;
}
