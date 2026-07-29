import { describe, expect, test } from 'bun:test';
import {
  GAME_AVAILABILITY_SCHEMA_VERSION,
  type GameCatalog,
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivityPage,
} from '@dailydraft/contracts';
import {
  type DatabaseClient,
  DuelMode,
  DuelSide,
  DuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
  ProviderMode,
} from '@dailydraft/db';
import { BadRequestException } from '@nestjs/common';

import type { ProviderCardResult } from '../providers/pack-provider.js';
import { compareInsuredValues, normalizeProviderResult } from '../providers/provider-result.js';
import { CANONICAL_VALUATION_POLICY_HASH } from '../providers/valuation-policy.js';
import { createDuelRgsCommitment } from '../rgs/rgs-duel-contract.js';
import type { GamesCatalogService } from './games-catalog.service.js';
import {
  applyDuelPolicyGates,
  decodeActivityCursor,
  encodeActivityCursor,
  GamesLobbyService,
  type PublicDuelActivityCandidate,
  PublicGamesActivityCache,
  projectVerifiedDuelActivity,
} from './games-lobby.service.js';

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const SETTLED_AT = new Date('2026-07-28T11:59:00.000Z');

describe('public game availability', () => {
  test('publishes every public game identifier with one shared asOf', async () => {
    const service = lobbyWith({ catalog: catalog() });

    const availability = await service.getAvailability(
      new Date('2026-07-28T12:00:00.000Z'),
      fixtureEnvironment(),
    );

    expect(
      availability.modes
        .find((mode) => mode.id === 'duel')
        ?.availableActions.map((action) => action.id),
    ).toContain('direct-challenge');
    expect(availability).toMatchObject({
      asOf: '2026-07-28T12:00:00.000Z',
      modes: [
        expect.objectContaining({
          asOf: '2026-07-28T12:00:00.000Z',
          capabilitySource: {
            kind: 'runtime',
            name: 'duel-readiness',
            status: 'verified',
          },
          id: 'duel',
          state: 'playable',
        }),
        expect.objectContaining({
          asOf: '2026-07-28T12:00:00.000Z',
          id: 'gacha',
          state: 'playable',
        }),
        expect.objectContaining({
          asOf: '2026-07-28T12:00:00.000Z',
          id: 'flip',
          state: 'playable',
        }),
        expect.objectContaining({
          asOf: '2026-07-28T12:00:00.000Z',
          id: 'crash',
          state: 'playable',
        }),
      ],
      network: 'solana-devnet',
      schemaVersion: GAME_AVAILABILITY_SCHEMA_VERSION,
    });
  });

  test('preserves a degraded runtime probe without inventing an action', async () => {
    const fixture = catalog();
    const duel = fixture.modes[0];
    if (!duel) throw new Error('Catalog fixture requires Duel');
    fixture.modes[0] = {
      ...duel,
      availableActions: [],
      capabilitySource: { ...duel.capabilitySource, status: 'degraded' },
      reason: 'Duel readiness could not be verified.',
      state: 'degraded',
    };

    const availability = await lobbyWith({ catalog: fixture }).getAvailability(
      new Date('2026-07-28T12:00:00.000Z'),
      fixtureEnvironment(),
    );

    expect(availability.modes[0]).toMatchObject({
      availableActions: [],
      capabilitySource: { status: 'degraded' },
      reason: 'Duel readiness could not be verified.',
      state: 'degraded',
    });
  });

  test('fails policy-gated Duel actions closed while no-value demos remain playable', async () => {
    const availability = await lobbyWith({ catalog: catalog() }).getAvailability(
      new Date('2026-07-28T12:00:00.000Z'),
      {},
    );

    expect(availability.modes[0]).toMatchObject({
      availableActions: [],
      capabilitySource: { status: 'gated' },
      reason: 'Duel play is unavailable under the current real-value policy.',
      state: 'unavailable',
    });
    expect(availability.modes.slice(1).map((mode) => mode.state)).toEqual([
      'playable',
      'playable',
      'playable',
    ]);
  });

  test('requires create, funding, opening, join, matchmaking, and escrow prerequisites', () => {
    const duel = catalog().modes[0];
    if (!duel) throw new Error('Catalog fixture requires Duel');
    duel.availableActions.push({
      href: '/games/duel',
      id: 'future-unmapped-action',
      label: 'Future action',
    });
    const common = ['duel.funding.prepare', 'duel.pack.open', 'provider.escrow.prepare'];
    const all = [
      ...common,
      'duel.create.direct',
      'duel.create.house',
      'duel.create.open',
      'duel.join',
      'matchmaking.house-fallback',
      'matchmaking.search',
    ];

    const actionIds = (capabilities: string[]) =>
      applyDuelPolicyGates(duel, productionEnvironment(capabilities)).availableActions.map(
        (action) => action.id,
      );

    expect(actionIds(all)).toEqual(['direct-challenge', 'open-matchmaking', 'house-opponent']);
    expect(actionIds([...common, 'duel.create.direct', 'duel.join'])).toEqual(['direct-challenge']);
    expect(
      actionIds([
        ...common,
        'duel.create.house',
        'duel.create.open',
        'duel.join',
        'matchmaking.house-fallback',
        'matchmaking.search',
      ]),
    ).toEqual(['open-matchmaking', 'house-opponent']);
    expect(actionIds(all.filter((capability) => capability !== 'duel.join'))).toEqual([
      'house-opponent',
    ]);
    for (const prerequisite of common) {
      expect(actionIds(all.filter((capability) => capability !== prerequisite))).toEqual([]);
    }
  });
});

describe('verified public game activity', () => {
  test('queries only proof-eligible settled Duels in deterministic order', async () => {
    let query: Record<string, unknown> | null = null;
    const rows = [activityCandidate(), activityCandidate({ id: 'duel_activity000000' })];
    const database = {
      duel: {
        findMany: (input: Record<string, unknown>) => {
          query = input;
          return rows;
        },
      },
    } as unknown as DatabaseClient;
    const service = lobbyWith({ catalog: catalog(), database });

    const page = await service.getVerifiedActivity(
      { limit: 1 },
      new Date('2026-07-28T12:00:00.000Z'),
    );

    expect(query).toEqual(
      expect.objectContaining({
        orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
        take: 100,
        where: expect.objectContaining({
          providerMode: { not: ProviderMode.MOCK },
          resultHash: { not: null },
          settledAt: { not: null },
        }),
      }),
    );
    expect(page).toEqual({
      asOf: '2026-07-28T12:00:00.000Z',
      data: [
        {
          activityId: 'duel:duel_activity000001',
          mode: 'duel',
          occurredAt: SETTLED_AT.toISOString(),
          participants: [
            { label: '9xQe…9gJ1', role: 'player' },
            { label: 'Gk8Z…MQyW', role: 'player' },
          ],
          receiptHref: '/v1/duels/duel_activity000001/receipt',
          result: 'winner-verified',
          resultHref: '/v1/rgs/rounds/duel/duel_activity000001/proof',
          resultSummary: '9xQe…9gJ1 won a verified Sports Pack Duel.',
          tier: { amount: '50000000', currency: 'USDC', decimals: 6 },
          title: 'Sports Pack Duel settled',
          verification: 'settled-rgs-proof',
        },
      ],
      hasMore: true,
      nextCursor: expect.stringMatching(/^v1\./),
      schemaVersion: VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
    });
    expect(JSON.stringify(page)).not.toContain(CREATOR);
    expect(JSON.stringify(page)).not.toContain(OPPONENT);
  });

  test('binds the next page to timestamp then immutable round ID', async () => {
    let where: Record<string, unknown> | null = null;
    const database = {
      duel: {
        findMany: (input: { where: Record<string, unknown> }) => {
          where = input.where;
          return [];
        },
      },
    } as unknown as DatabaseClient;
    const cursor = encodeActivityCursor({
      id: 'duel_activity000001',
      mode: 'duel',
      occurredAt: SETTLED_AT.toISOString(),
    });

    await lobbyWith({ catalog: catalog(), database }).getVerifiedActivity({ cursor, limit: 20 });

    expect(where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          {
            OR: [
              { settledAt: { lt: SETTLED_AT } },
              {
                id: { lt: 'duel_activity000001' },
                settledAt: SETTLED_AT,
              },
            ],
          },
        ]),
      }),
    );
  });

  test('rejects malformed, non-canonical, and invalid-round cursors', () => {
    for (const cursor of [
      'not-a-cursor',
      'v1.bm90LWpzb24',
      `v1.${Buffer.from(
        JSON.stringify({ id: 'duel_short', occurredAt: SETTLED_AT.toISOString() }),
      ).toString('base64url')}`,
      `v1.${Buffer.from(
        JSON.stringify({
          id: 'duel_activity000001',
          mode: 'duel',
          occurredAt: '2026-07-28T11:59:00Z',
        }),
      ).toString('base64url')}`,
      `v1.${Buffer.from(
        JSON.stringify({
          id: 'duel_activity000001',
          mode: 'gacha',
          occurredAt: SETTLED_AT.toISOString(),
        }),
      ).toString('base64url')}`,
    ]) {
      expect(() => decodeActivityCursor(cursor)).toThrow(BadRequestException);
    }
  });

  test('emits only canonical receipts and RGS proofs that independently agree', () => {
    const valid = activityCandidate();
    expect(projectVerifiedDuelActivity(valid)).not.toBeNull();

    const invalidCandidates: PublicDuelActivityCandidate[] = [
      {
        ...valid,
        packOutcomes: valid.packOutcomes.map((outcome, index) =>
          index === 0 ? { ...outcome, isMock: true } : outcome,
        ),
      },
      {
        ...valid,
        packOutcomes: valid.packOutcomes.map((outcome, index) =>
          index === 0 ? { ...outcome, insuredValueAmount: '1' } : outcome,
        ),
      },
      {
        ...valid,
        packOutcomes: valid.packOutcomes.map((outcome, index) =>
          index === 0 ? { ...outcome, poolVersion: 'drifted-pool-v2' } : outcome,
        ),
      },
      {
        ...valid,
        packOutcomes: valid.packOutcomes.map((outcome, index) =>
          index === 0 ? { ...outcome, sourceTimestamp: null } : outcome,
        ),
      },
      {
        ...valid,
        packOutcomes: valid.packOutcomes.map((outcome, index) =>
          index === 0 ? { ...outcome, valuationPolicyHash: '0'.repeat(64) } : outcome,
        ),
      },
      {
        ...valid,
        providerOperations: valid.providerOperations.map((operation, index) =>
          index === 0 ? { ...operation, signature: null } : operation,
        ),
      },
      {
        ...valid,
        providerOperations: valid.providerOperations.map((operation, index) =>
          index === 0 ? { ...operation, resultHash: 'mismatch' } : operation,
        ),
      },
      { ...valid, resultHash: '0'.repeat(64) },
      { ...valid, rgsConfigHash: '0'.repeat(64) },
      { ...valid, stakeCurrency: 'USD' },
      { ...valid, winnerWallet: 'not-a-participant' },
      {
        ...valid,
        transactions: valid.transactions.filter(
          (transaction) => transaction.action !== DuelTransactionAction.SETTLE,
        ),
      },
      {
        ...valid,
        transactions: valid.transactions.filter(
          (transaction) => transaction.action !== DuelTransactionAction.COMMIT_RESULT,
        ),
      },
      {
        ...valid,
        transactions: valid.transactions.filter(
          (transaction, index) => transaction.action !== DuelTransactionAction.FUND || index === 0,
        ),
      },
    ];
    for (const candidate of invalidCandidates) {
      expect(projectVerifiedDuelActivity(candidate)).toBeNull();
    }
  });

  test('emits canonical public links that resolve to documented routes', async () => {
    const activity = projectVerifiedDuelActivity(activityCandidate());
    if (!activity) throw new Error('Activity fixture must be projectable');
    const document = Bun.YAML.parse(
      await Bun.file(new URL('../../../docs/public/openapi.yaml', import.meta.url)).text(),
    ) as { paths: Record<string, { get?: unknown }> };
    const routeTemplates = [
      activity.receiptHref.replace(/^\/v1\/duels\/[^/]+\/receipt$/, '/duels/{duelId}/receipt'),
      activity.resultHref.replace(
        /^\/v1\/rgs\/rounds\/[^/]+\/[^/]+\/proof$/,
        '/rgs/rounds/{mode}/{roundId}/proof',
      ),
    ];

    expect(routeTemplates).toEqual([
      '/duels/{duelId}/receipt',
      '/rgs/rounds/{mode}/{roundId}/proof',
    ]);
    for (const route of routeTemplates) expect(document.paths[route]?.get).toBeDefined();
  });

  test('paginates tied timestamps across rejected rows without gaps or duplicates', async () => {
    const tiedAt = new Date('2026-07-28T11:59:00.000Z');
    const rows = ['005', '004', '003', '002', '001'].map((suffix) =>
      activityCandidate({ id: `duel_tied000000${suffix}`, settledAt: tiedAt }),
    );
    const rejected = rows[1];
    if (!rejected) throw new Error('Pagination fixture requires a rejected row');
    rows[1] = {
      ...rejected,
      packOutcomes: rejected.packOutcomes.map((outcome, index) =>
        index === 0 ? { ...outcome, poolVersion: null } : outcome,
      ),
    };
    const database = {
      duel: {
        findMany: (input: {
          take: number;
          where: { AND: Array<{ OR?: Array<Record<string, unknown>> }> };
        }) => {
          const cursorClause = input.where.AND.find((clause) => clause.OR)?.OR;
          const cursorId =
            (cursorClause?.find((clause) => 'id' in clause) as { id?: { lt?: string } } | undefined)
              ?.id?.lt ?? null;
          return rows.filter((row) => !cursorId || row.id < cursorId).slice(0, input.take);
        },
      },
    } as unknown as DatabaseClient;
    const service = lobbyWith({ catalog: catalog(), database });

    const first = await service.getVerifiedActivity({ limit: 2 });
    if (!first.nextCursor) throw new Error('First activity page requires a cursor');
    const second = await service.getVerifiedActivity({ cursor: first.nextCursor, limit: 2 });
    const activityIds = [...first.data, ...second.data].map((activity) => activity.activityId);

    expect(first).toMatchObject({ hasMore: true });
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect(activityIds).toEqual([
      'duel:duel_tied000000005',
      'duel:duel_tied000000003',
      'duel:duel_tied000000002',
      'duel:duel_tied000000001',
    ]);
    expect(new Set(activityIds).size).toBe(activityIds.length);
  });

  test('coalesces bounded public cache keys and drops failed loads', async () => {
    let now = 1_000;
    let loads = 0;
    const cache = new PublicGamesActivityCache(() => now, 30_000, 2);
    const load = async () => {
      loads += 1;
      return emptyActivityPage();
    };

    const first = cache.get('20:', load);
    expect(cache.get('20:', load)).toBe(first);
    await first;
    expect(loads).toBe(1);
    now += 30_000;
    await cache.get('20:', load);
    expect(loads).toBe(2);

    await expect(
      cache.get('10:failure', async () => {
        throw new Error('database unavailable');
      }),
    ).rejects.toThrow('database unavailable');
    await cache.get('10:failure', load);
    expect(loads).toBe(3);

    await cache.get('1:a', load);
    await cache.get('1:b', load);
    await cache.get('1:a', load);
    expect(loads).toBe(5);
  });
});

function lobbyWith({
  catalog: catalogFixture,
  database = { duel: { findMany: () => [] } } as unknown as DatabaseClient,
}: {
  catalog: GameCatalog;
  database?: DatabaseClient;
}): GamesLobbyService {
  return new GamesLobbyService(
    {
      getCatalog: (asOf: Date) =>
        Promise.resolve({
          ...catalogFixture,
          asOf: asOf.toISOString(),
        }),
    } as GamesCatalogService,
    database,
  );
}

function catalog(): GameCatalog {
  return {
    asOf: '2026-07-28T12:00:00.000Z',
    modes: [
      {
        availableActions: [
          { href: '/games/duel', id: 'direct-challenge', label: 'Challenge a wallet' },
          { href: '/games/duel', id: 'open-matchmaking', label: 'Find a rival' },
          { href: '/games/duel', id: 'house-opponent', label: 'Play the house' },
        ],
        capabilitySource: { kind: 'runtime', name: 'duel-readiness', status: 'verified' },
        description: 'Open matching sports packs.',
        id: 'duel',
        name: 'Card Duel',
        reason: 'Duel is ready.',
        state: 'playable',
      },
      {
        availableActions: [{ href: '/games/gacha', id: 'rip-pack', label: 'Rip a sports pack' }],
        capabilitySource: { kind: 'runtime', name: 'gacha-capability', status: 'verified' },
        description: 'Rip a sealed pack.',
        id: 'gacha',
        name: 'Gacha',
        reason: 'Gacha is ready.',
        state: 'playable',
      },
      {
        availableActions: [
          {
            href: '/games/marketplace-flip',
            id: 'play-demo',
            label: 'Play free demo',
          },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Play a marketplace run.',
        id: 'flip',
        name: 'Marketplace Flip',
        reason: 'Playable no-value devnet demo.',
        state: 'playable',
      },
      {
        availableActions: [{ href: '/games/crash', id: 'play-demo', label: 'Play free demo' }],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Play a card streak.',
        id: 'crash',
        name: 'Card Streak',
        reason: 'Playable no-value devnet demo.',
        state: 'playable',
      },
    ],
    network: 'solana-devnet',
    schemaVersion: 'dailydraft.game-catalog.v1',
  };
}

function fixtureEnvironment(): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test' };
}

function productionEnvironment(capabilities: string[]): NodeJS.ProcessEnv {
  return {
    DAILYDRAFT_NETWORK: 'solana-mainnet',
    DAILYDRAFT_REAL_VALUE_MODE: 'true',
    DAILYDRAFT_REAL_VALUE_POLICY_JSON: JSON.stringify({
      approvals: {
        age: 'approval:age',
        disclosure: 'approval:disclosure',
        jurisdiction: 'approval:jurisdiction',
        legal: 'approval:legal',
        limits: 'approval:limits',
        production: 'approval:production',
        sanctions: 'approval:sanctions',
      },
      capabilities,
      policyVersion: 'policy:test-v1',
      schemaVersion: 'dailydraft.real-value-policy.v1',
    }),
    DAILYDRAFT_REAL_VALUE_PRODUCTION_ENABLED: 'true',
  };
}

function activityCandidate({
  id = 'duel_activity000001',
  settledAt = SETTLED_AT,
  winnerWallet = CREATOR,
}: {
  id?: string;
  settledAt?: Date;
  winnerWallet?: string | null;
} = {}): PublicDuelActivityCandidate {
  const openedAt = new Date(settledAt.getTime() - 30_000);
  const sourceTimestamp = new Date(settledAt.getTime() - 60_000).toISOString();
  const creatorOutcome = normalizeProviderResult(
    'creator',
    providerResult('creator-card', 'Umbreon VMAX', '100000000', sourceTimestamp),
    CANONICAL_VALUATION_POLICY_HASH,
    `${id}:creator:open`,
    openedAt,
  );
  const opponentOutcome = normalizeProviderResult(
    'opponent',
    providerResult('opponent-card', 'Blastoise', '15000000', sourceTimestamp),
    CANONICAL_VALUATION_POLICY_HASH,
    `${id}:opponent:open`,
    openedAt,
  );
  const comparison = compareInsuredValues(creatorOutcome, opponentOutcome, {
    creatorWallet: CREATOR,
    duelId: id,
    escrowAddress: '7YttLkHDoNj9wyDur5rWnFwyCRLQ8vWUvqGL9cM23Zgy',
    network: 'solana-devnet',
    opponentWallet: OPPONENT,
    providerMode: 'dailydraft-devnet',
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  });
  const providerOperations = [
    operation(id, DuelSide.CREATOR, creatorOutcome.resultHash),
    operation(id, DuelSide.OPPONENT, opponentOutcome.resultHash),
  ];
  const commitment = createDuelRgsCommitment({
    duelId: id,
    operations: providerOperations,
    packId: 'sports_pack_50',
    providerMode: ProviderMode.DAILYDRAFT_DEVNET,
    rulesHash: CANONICAL_VALUATION_POLICY_HASH,
  });
  const row = {
    cancellationReason: null,
    commitmentExpiresAt: null,
    createdAt: new Date(settledAt.getTime() - 5 * 60_000),
    creatorWallet: CREATOR,
    escrowAddress: '7YttLkHDoNj9wyDur5rWnFwyCRLQ8vWUvqGL9cM23Zgy',
    expiresAt: new Date(settledAt.getTime() + 55 * 60_000),
    fundedAt: new Date(settledAt.getTime() - 3 * 60_000),
    houseOpponent: false,
    id,
    matchedAt: new Date(settledAt.getTime() - 4 * 60_000),
    mode: DuelMode.DIRECT,
    network: 'DEVNET',
    opponentJoinedAt: new Date(settledAt.getTime() - 4 * 60_000),
    opponentWallet: OPPONENT,
    packId: 'sports_pack_50',
    packName: 'Sports Pack',
    packProvider: 'dailydraft-devnet',
    packOutcomes: [
      persistedOutcome(id, DuelSide.CREATOR, creatorOutcome),
      persistedOutcome(id, DuelSide.OPPONENT, opponentOutcome),
    ],
    providerMode: ProviderMode.DAILYDRAFT_DEVNET,
    providerPackId: 'sports-pack-50',
    providerOperations,
    resultHash: comparison.resultHash,
    resultReadyAt: new Date(settledAt.getTime() - 15_000),
    rgsCommitmentHash: commitment.commitmentHash,
    rgsConfigHash: commitment.configHash,
    rgsRulesHash: commitment.rulesHash,
    settledAt,
    stakeAmount: '50000000',
    stakeCurrency: 'USDC',
    stakeDecimals: 6,
    status: DuelStatus.SETTLED,
    transactions: [
      transaction(id, DuelTransactionAction.FUND, CREATOR, 1),
      transaction(id, DuelTransactionAction.FUND, OPPONENT, 2),
      transaction(id, DuelTransactionAction.COMMIT_RESULT, CREATOR, 3),
      transaction(id, DuelTransactionAction.SETTLE, CREATOR, 4),
    ],
    updatedAt: settledAt,
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    version: 8,
    winnerWallet,
  };
  return row as unknown as PublicDuelActivityCandidate;
}

function providerResult(
  assetReference: string,
  displayName: string,
  amount: string,
  sourceTimestamp: string,
): ProviderCardResult {
  return {
    assetReference,
    displayName,
    imageUrl: `https://images.example.test/${assetReference}.png`,
    insuredValue: { amount, currency: 'USDC', decimals: 6 },
    poolVersion: 'sports-pool-v1',
    sourceTimestamp,
    valuationSourceReference: `sports-pool:${assetReference}:insured-value`,
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  };
}

function persistedOutcome(
  duelId: string,
  side: DuelSide,
  outcome: ReturnType<typeof normalizeProviderResult>,
) {
  return {
    assetReference: outcome.assetReference,
    createdAt: new Date(outcome.openedAt),
    displayName: outcome.displayName,
    duelId,
    id: `${duelId}:${side.toLowerCase()}:outcome`,
    imageUrl: outcome.imageUrl ?? null,
    insuredValueAmount: outcome.insuredValue.amount,
    insuredValueCurrency: outcome.insuredValue.currency,
    insuredValueDecimals: outcome.insuredValue.decimals,
    isMock: false,
    openedAt: new Date(outcome.openedAt),
    poolVersion: outcome.poolVersion,
    provider: 'dailydraft-devnet',
    providerReference: outcome.providerReference,
    resultHash: outcome.resultHash,
    side,
    sourceTimestamp: new Date(outcome.sourceTimestamp),
    valuationPolicyHash: outcome.valuationPolicyHash,
    valuationSourceReference: outcome.valuationSourceReference ?? null,
  };
}

function operation(duelId: string, side: DuelSide, resultHash: string) {
  return {
    assetReference: `${side.toLowerCase()}-card`,
    createdAt: new Date('2026-07-28T11:58:00.000Z'),
    duelId,
    errorCode: null,
    generateIdempotencyKey: `generate-${side.toLowerCase()}`,
    id: `${duelId}:${side.toLowerCase()}:operation`,
    normalizedOutcome: null,
    openIdempotencyKey: `open-${side.toLowerCase()}`,
    payloadHash: `${side.toLowerCase()}-payload`,
    provider: 'dailydraft-devnet',
    providerPackId: 'sports-pack-50',
    providerReference: `${side.toLowerCase()}-reference`,
    rawPayload: null,
    recipientWallet: side === DuelSide.CREATOR ? CREATOR : OPPONENT,
    resultHash,
    side,
    signature: `${side.toLowerCase()}-signature`,
    signatureAlgorithm: 'ed25519',
    signingKeyReference: 'provider-key-v1',
    status: 'OPENED',
    updatedAt: new Date('2026-07-28T11:58:30.000Z'),
  };
}

function transaction(duelId: string, action: DuelTransactionAction, wallet: string, index: number) {
  const timestamp = new Date(`2026-07-28T11:58:${String(index).padStart(2, '0')}.000Z`);
  return {
    action,
    checkAttempts: 1,
    confirmationStatus: 'finalized',
    confirmedAt: timestamp,
    createdAt: timestamp,
    duelId,
    errorCode: null,
    errorMessage: null,
    expiresAt: null,
    finalizedAt: timestamp,
    id: `${duelId}:transaction:${index}`,
    lastCheckedAt: timestamp,
    lastValidBlockHeight: null,
    metadata: action === DuelTransactionAction.FUND ? { feeAmountLamports: '5000' } : null,
    providerReference: null,
    recentBlockhash: null,
    recoveredAt: null,
    recoveryAlertCode: null,
    recoveryCandidateAt: null,
    recoveryCandidateSignature: null,
    signature: String(index).repeat(88),
    status: DuelTransactionStatus.FINALIZED,
    stuckAt: null,
    submittedAt: timestamp,
    updatedAt: timestamp,
    wallet,
  };
}

function emptyActivityPage(): VerifiedGameActivityPage {
  return {
    asOf: '2026-07-28T12:00:00.000Z',
    data: [],
    hasMore: false,
    nextCursor: null,
    schemaVersion: VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  };
}
