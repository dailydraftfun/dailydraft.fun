import { describe, expect, test } from 'bun:test';
import {
  GAME_AVAILABILITY_SCHEMA_VERSION,
  type GameCatalog,
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivityPage,
} from '@dailydraft/contracts';
import { type DatabaseClient, DuelSide, ProviderMode } from '@dailydraft/db';
import { BadRequestException } from '@nestjs/common';

import { createDuelRgsCommitment } from '../rgs/rgs-duel-contract.js';
import type { GamesCatalogService } from './games-catalog.service.js';
import {
  applyDuelPolicyGates,
  decodeActivityCursor,
  encodeActivityCursor,
  GamesLobbyService,
  PublicGamesActivityCache,
  projectVerifiedDuelActivity,
} from './games-lobby.service.js';

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const SETTLED_AT = new Date('2026-07-28T11:59:00.000Z');

describe('public game availability', () => {
  test('publishes stable Duel, Flip, and Crash identifiers with one shared asOf', async () => {
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
          id: 'flip',
          state: 'preview',
        }),
        expect.objectContaining({
          asOf: '2026-07-28T12:00:00.000Z',
          id: 'crash',
          state: 'preview',
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

  test('fails policy-gated Duel actions closed while fixtures remain previews', async () => {
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
    expect(availability.modes.slice(1).map((mode) => mode.state)).toEqual(['preview', 'preview']);
  });

  test('keeps admitted actions as degraded when policy permits only part of Duel', () => {
    const duel = catalog().modes[0];
    if (!duel) throw new Error('Catalog fixture requires Duel');
    duel.availableActions.push({
      href: '/games/duel',
      id: 'future-unmapped-action',
      label: 'Future action',
    });
    const environment = productionEnvironment(['duel.create.direct']);

    expect(applyDuelPolicyGates(duel, environment)).toMatchObject({
      availableActions: [
        { href: '/games/duel', id: 'direct-challenge', label: 'Challenge a wallet' },
      ],
      capabilitySource: { status: 'gated' },
      state: 'degraded',
    });
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
        take: 2,
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
            { label: '9xQe…9gJ1', side: 'creator' },
            { label: 'Gk8Z…MQyW', side: 'opponent' },
          ],
          receiptHref: '/duels/duel_activity000001/receipt',
          result: 'winner-verified',
          resultHref: '/rgs/rounds/duel/duel_activity000001/proof',
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
          occurredAt: '2026-07-28T11:59:00Z',
        }),
      ).toString('base64url')}`,
    ]) {
      expect(() => decodeActivityCursor(cursor)).toThrow(BadRequestException);
    }
  });

  test('emits only complete, matching, non-mock proof evidence', () => {
    const valid = activityCandidate();
    expect(projectVerifiedDuelActivity(valid)).not.toBeNull();
    expect(
      projectVerifiedDuelActivity({
        ...valid,
        packOutcomes: valid.packOutcomes.map((outcome, index) =>
          index === 0 ? { ...outcome, isMock: true } : outcome,
        ),
      }),
    ).toBeNull();
    expect(
      projectVerifiedDuelActivity({
        ...valid,
        providerOperations: valid.providerOperations.map((operation, index) =>
          index === 0 ? { ...operation, signature: null } : operation,
        ),
      }),
    ).toBeNull();
    expect(
      projectVerifiedDuelActivity({
        ...valid,
        providerOperations: valid.providerOperations.map((operation, index) =>
          index === 0 ? { ...operation, resultHash: 'mismatch' } : operation,
        ),
      }),
    ).toBeNull();
    expect(projectVerifiedDuelActivity({ ...valid, rgsConfigHash: '0'.repeat(64) })).toBeNull();
    expect(projectVerifiedDuelActivity({ ...valid, winnerWallet: 'not-a-participant' })).toBeNull();
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
            id: 'view-preview',
            label: 'View fixture preview',
          },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Preview marketplace pricing.',
        id: 'flip',
        name: 'Marketplace Flip',
        reason: 'Fixture preview only.',
        state: 'preview',
      },
      {
        availableActions: [
          { href: '/games/crash', id: 'view-preview', label: 'View fixture preview' },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Preview a card streak.',
        id: 'crash',
        name: 'Card Streak',
        reason: 'Fixture preview only.',
        state: 'preview',
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
  winnerWallet = CREATOR,
}: {
  id?: string;
  winnerWallet?: string | null;
} = {}) {
  const providerOperations = [
    operation(DuelSide.CREATOR, 'creator-result'),
    operation(DuelSide.OPPONENT, 'opponent-result'),
  ];
  const commitment = createDuelRgsCommitment({
    duelId: id,
    operations: providerOperations,
    packId: 'sports_pack_50',
    providerMode: ProviderMode.DAILYDRAFT_DEVNET,
    rulesHash: 'a'.repeat(64),
  });
  return {
    creatorWallet: CREATOR,
    escrowAddress: '7YttLkHDoNj9wyDur5rWnFwyCRLQ8vWUvqGL9cM23Zgy',
    houseOpponent: false,
    id,
    opponentWallet: OPPONENT,
    packId: 'sports_pack_50',
    packName: 'Sports Pack',
    packOutcomes: [
      { isMock: false, resultHash: 'creator-result', side: DuelSide.CREATOR },
      { isMock: false, resultHash: 'opponent-result', side: DuelSide.OPPONENT },
    ],
    providerMode: ProviderMode.DAILYDRAFT_DEVNET,
    providerOperations,
    rgsCommitmentHash: commitment.commitmentHash,
    rgsConfigHash: commitment.configHash,
    rgsRulesHash: commitment.rulesHash,
    settledAt: SETTLED_AT,
    stakeAmount: '50000000',
    stakeCurrency: 'USDC',
    stakeDecimals: 6,
    valuationPolicyHash: 'a'.repeat(64),
    winnerWallet,
  };
}

function operation(side: DuelSide, resultHash: string) {
  return {
    generateIdempotencyKey: `generate-${side.toLowerCase()}`,
    openIdempotencyKey: `open-${side.toLowerCase()}`,
    payloadHash: `${side.toLowerCase()}-payload`,
    provider: 'dailydraft-devnet',
    providerPackId: 'sports-pack-50',
    providerReference: `${side.toLowerCase()}-reference`,
    recipientWallet: side === DuelSide.CREATOR ? CREATOR : OPPONENT,
    resultHash,
    side,
    signature: `${side.toLowerCase()}-signature`,
    signatureAlgorithm: 'ed25519',
    signingKeyReference: 'provider-key-v1',
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
