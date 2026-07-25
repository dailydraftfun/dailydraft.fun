import { afterEach, describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '@dailydraft/db';

import {
  type FantasyKickoffHolding,
  type FantasyKickoffPolicy,
  FantasyKickoffSnapshotService,
  fantasyKickoffFixtureModeEnabled,
  type PrepareFantasyKickoffSnapshotInput,
  prepareFantasyKickoffSnapshot,
} from './fantasy-kickoff-snapshot.service.js';

const EVALUATED_AT = new Date('2026-07-24T11:55:00.000Z');
const KICKOFF_AT = new Date('2026-07-24T12:00:00.000Z');
const WALLET_A = '11111111111111111111111111111111';
const WALLET_B = '22222222222222222222222222222222';
const ORIGINAL_ENV = {
  fixture: process.env.DAILYDRAFT_FANTASY_FIXTURE_MODE,
  node: process.env.NODE_ENV,
  vercel: process.env.VERCEL_ENV,
};

afterEach(() => {
  restoreEnvironment('DAILYDRAFT_FANTASY_FIXTURE_MODE', ORIGINAL_ENV.fixture);
  restoreEnvironment('NODE_ENV', ORIGINAL_ENV.node);
  restoreEnvironment('VERCEL_ENV', ORIGINAL_ENV.vercel);
});

describe('prepareFantasyKickoffSnapshot', () => {
  test('canonicalizes holdings and produces stable hashes independent of input order', () => {
    const first = holding('custody_a', {
      eligibleShares: 3,
      playerId: 'player_shared',
      walletAddress: WALLET_A,
    });
    const second = holding('custody_b', {
      eligibleShares: 7,
      playerId: 'player_shared',
      position: 'FORWARD',
      walletAddress: WALLET_B,
    });
    const left = prepareFantasyKickoffSnapshot(input({ holdings: [second, first] }));
    const right = prepareFantasyKickoffSnapshot(input({ holdings: [first, second] }));
    const repeated = prepareFantasyKickoffSnapshot(input({ holdings: [second, first] }));

    expect(left.entries.map((entry) => entry.custodyReference)).toEqual(['custody_a', 'custody_b']);
    expect(left.entries.map((entry) => entry.ordinal)).toEqual([0, 1]);
    expect(left.entries.every((entry) => entry.lockedAt.getTime() === KICKOFF_AT.getTime())).toBe(
      true,
    );
    expect(left.entryCount).toBe(2);
    expect(left.playerCount).toBe(1);
    expect(left.eligibleShareTotal).toBe('10');
    expect(left.policyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(left.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(left.policyHash).toBe(right.policyHash);
    expect(left.contentHash).toBe(right.contentHash);
    expect(left.entries).toEqual(right.entries);
    expect(repeated.contentHash).toBe(left.contentHash);
    expect(left.evaluatedAt).not.toBe(EVALUATED_AT);
    expect(left.kickoffAt).not.toBe(KICKOFF_AT);
  });

  test('rejects malformed references and dates', () => {
    const cases: Array<{ input: PrepareFantasyKickoffSnapshotInput; message: string }> = [
      {
        input: input({ tournamentId: 42 as unknown as string }),
        message: 'tournamentId is invalid',
      },
      { input: input({ tournamentId: '' }), message: 'tournamentId is invalid' },
      { input: input({ tournamentId: 'x'.repeat(241) }), message: 'tournamentId is invalid' },
      { input: input({ tournamentId: ' tournament' }), message: 'tournamentId is invalid' },
      { input: input({ tournamentId: 'tournament\u0000' }), message: 'tournamentId is invalid' },
      {
        input: input({ kickoffAt: '2026-07-24' as unknown as Date }),
        message: 'kickoffAt is invalid',
      },
      {
        input: input({ evaluatedAt: new Date('invalid') }),
        message: 'evaluatedAt is invalid',
      },
    ];

    for (const invalid of cases) {
      expect(() => prepareFantasyKickoffSnapshot(invalid.input)).toThrow(invalid.message);
    }
  });

  test('rejects malformed policy fields and integer bounds', () => {
    const cases: Array<{ policy: FantasyKickoffPolicy; message: string }> = [
      {
        policy: null as unknown as FantasyKickoffPolicy,
        message: 'Fantasy kickoff policy is required',
      },
      {
        policy: policy({ policyVersion: 42 as unknown as string }),
        message: 'policyVersion is invalid',
      },
      {
        policy: policy({ policyVersion: 'Invalid Version' }),
        message: 'policyVersion is invalid',
      },
      {
        policy: policy({ sport: 'HOCKEY' as FantasyKickoffPolicy['sport'] }),
        message: 'policy sport is invalid',
      },
      {
        policy: policy({ minimumEligibleShares: 1.5 }),
        message: 'minimumEligibleShares is invalid',
      },
      {
        policy: policy({ minimumEligibleShares: 0 }),
        message: 'minimumEligibleShares is invalid',
      },
      {
        policy: policy({ minimumEligibleShares: 1_000_000_001 }),
        message: 'minimumEligibleShares is invalid',
      },
      {
        policy: policy({ tournamentReference: ' tournament-provider' }),
        message: 'tournamentReference is invalid',
      },
    ];

    for (const invalid of cases) {
      expect(() => prepareFantasyKickoffSnapshot(input({ policy: invalid.policy }))).toThrow(
        invalid.message,
      );
    }
  });

  test('rejects missing, oversized, malformed, and duplicate holdings', () => {
    const valid = holding('custody_valid');
    const cases: Array<{ holdings: readonly FantasyKickoffHolding[]; message: string }> = [
      {
        holdings: 'not-an-array' as unknown as FantasyKickoffHolding[],
        message: 'requires locked holdings',
      },
      { holdings: [], message: 'requires locked holdings' },
      {
        holdings: Array.from({ length: 5_001 }, () => valid),
        message: 'exceeds 5000 holdings',
      },
      {
        holdings: [null as unknown as FantasyKickoffHolding],
        message: 'holding is invalid',
      },
      {
        holdings: [
          holding('custody_invalid_wallet_type', { walletAddress: 42 as unknown as string }),
        ],
        message: 'wallet address is invalid',
      },
      {
        holdings: [holding('custody_invalid_wallet', { walletAddress: 'not-base58' })],
        message: 'wallet address is invalid',
      },
      {
        holdings: [
          holding('custody_invalid_position', {
            position: 'CENTER' as FantasyKickoffHolding['position'],
          }),
        ],
        message: 'position is invalid',
      },
      {
        holdings: [holding('custody_fractional', { eligibleShares: 1.5 })],
        message: 'eligibleShares is invalid',
      },
      {
        holdings: [holding('custody_below_minimum', { eligibleShares: 0 })],
        message: 'eligibleShares is invalid',
      },
      {
        holdings: [holding('custody_above_maximum', { eligibleShares: 1_000_000_001 })],
        message: 'eligibleShares is invalid',
      },
      {
        holdings: [holding('')],
        message: 'custodyReference is invalid',
      },
      {
        holdings: [holding('custody_invalid_player', { playerId: 'player\ninvalid' })],
        message: 'playerId is invalid',
      },
      {
        holdings: [holding('custody_duplicate'), holding('custody_duplicate')],
        message: 'duplicate custody reference',
      },
    ];

    for (const invalid of cases) {
      expect(() => prepareFantasyKickoffSnapshot(input({ holdings: invalid.holdings }))).toThrow(
        invalid.message,
      );
    }
  });
});

describe('fantasyKickoffFixtureModeEnabled', () => {
  test('requires the explicit flag and a permitted non-production runtime', () => {
    expect(fantasyKickoffFixtureModeEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(
      fantasyKickoffFixtureModeEnabled({
        NODE_ENV: 'test',
        DAILYDRAFT_FANTASY_FIXTURE_MODE: 'true',
        VERCEL_ENV: 'production',
      }),
    ).toBe(false);
    expect(
      fantasyKickoffFixtureModeEnabled({
        NODE_ENV: 'test',
        DAILYDRAFT_FANTASY_FIXTURE_MODE: 'true',
      }),
    ).toBe(true);
    expect(
      fantasyKickoffFixtureModeEnabled({
        NODE_ENV: 'development',
        DAILYDRAFT_FANTASY_FIXTURE_MODE: 'true',
      }),
    ).toBe(true);
    expect(
      fantasyKickoffFixtureModeEnabled({
        NODE_ENV: 'production',
        DAILYDRAFT_FANTASY_FIXTURE_MODE: 'true',
        VERCEL_ENV: 'preview',
      }),
    ).toBe(true);
    expect(
      fantasyKickoffFixtureModeEnabled({
        NODE_ENV: 'production',
        DAILYDRAFT_FANTASY_FIXTURE_MODE: 'true',
        VERCEL_ENV: 'staging',
      }),
    ).toBe(false);
  });
});

describe('FantasyKickoffSnapshotService', () => {
  test('fails closed before database access when fixture mode is disabled', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DAILYDRAFT_FANTASY_FIXTURE_MODE;
    const database = new FixtureDatabase();
    const service = new FantasyKickoffSnapshotService(database as unknown as DatabaseClient);

    await expect(service.createFixtureSnapshot(input())).rejects.toThrow(
      'disabled outside explicit fixture or preview mode',
    );
    expect(database.transactions).toBe(0);
    expect(database.advisoryLocks).toBe(0);
  });

  test('seals new revisions and replays an existing content hash', async () => {
    enableFixtureMode();
    const database = new FixtureDatabase();
    const service = new FantasyKickoffSnapshotService(database as unknown as DatabaseClient);
    const original = input();

    const first = await service.createFixtureSnapshot(original);
    const replay = await service.createFixtureSnapshot(original);
    const correction = await service.createFixtureSnapshot(
      input({ holdings: [holding('custody_a', { eligibleShares: 2 })] }),
    );

    expect(first).toMatchObject({
      created: true,
      revision: 1,
      tournamentId: original.tournamentId,
    });
    expect(first.id).toMatch(/^fankick_[a-f0-9]{32}$/);
    expect(replay).toEqual({ ...first, created: false });
    expect(correction).toMatchObject({ created: true, revision: 2 });
    expect(correction.contentHash).not.toBe(first.contentHash);
    expect(database.snapshots).toHaveLength(2);
    expect(database.entries).toHaveLength(2);
    expect(database.advisoryLocks).toBe(3);
    expect(database.transactions).toBe(3);
  });

  test('rejects an unsealed replay and an unavailable seal', async () => {
    enableFixtureMode();
    const unsealedDatabase = new FixtureDatabase();
    const unsealedService = new FantasyKickoffSnapshotService(
      unsealedDatabase as unknown as DatabaseClient,
    );
    await unsealedService.createFixtureSnapshot(input());
    const stored = unsealedDatabase.snapshots[0];
    if (!stored) throw new Error('Expected a stored fantasy kickoff snapshot');
    stored.sealedAt = null;

    await expect(unsealedService.createFixtureSnapshot(input())).rejects.toThrow(
      'snapshot is not sealed',
    );

    const failedSealDatabase = new FixtureDatabase();
    failedSealDatabase.failSeal = true;
    const failedSealService = new FantasyKickoffSnapshotService(
      failedSealDatabase as unknown as DatabaseClient,
    );
    await expect(failedSealService.createFixtureSnapshot(input())).rejects.toThrow(
      'could not be sealed',
    );
  });
});

function input(
  overrides: Partial<PrepareFantasyKickoffSnapshotInput> = {},
): PrepareFantasyKickoffSnapshotInput {
  return {
    evaluatedAt: EVALUATED_AT,
    holdings: [holding('custody_a')],
    kickoffAt: KICKOFF_AT,
    policy: policy(),
    tournamentId: 'fantnmt_fixture123456',
    ...overrides,
  };
}

function policy(overrides: Partial<FantasyKickoffPolicy> = {}): FantasyKickoffPolicy {
  return {
    minimumEligibleShares: 1,
    policyVersion: 'fantasy-fixture-policy-v1',
    sport: 'SOCCER',
    tournamentReference: 'provider-tournament-2026',
    ...overrides,
  };
}

function holding(
  custodyReference: string,
  overrides: Partial<FantasyKickoffHolding> = {},
): FantasyKickoffHolding {
  return {
    custodyReference,
    eligibleShares: 1,
    playerId: `player_${custodyReference || 'invalid'}`,
    position: 'DEFENDER',
    walletAddress: WALLET_A,
    ...overrides,
  };
}

function enableFixtureMode(): void {
  process.env.NODE_ENV = 'test';
  process.env.DAILYDRAFT_FANTASY_FIXTURE_MODE = 'true';
  delete process.env.VERCEL_ENV;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

interface StoredSnapshot {
  contentHash: string;
  id: string;
  revision: number;
  sealedAt: Date | null;
  tournamentId: string;
}

class FixtureDatabase {
  advisoryLocks = 0;
  entries: unknown[] = [];
  failSeal = false;
  snapshots: StoredSnapshot[] = [];
  transactions = 0;

  readonly fantasyKickoffSnapshotEntry = {
    createMany: async ({ data }: { data: unknown[] }) => {
      this.entries.push(...data);
      return { count: data.length };
    },
  };

  readonly fantasyKickoffSnapshot = {
    create: async ({ data }: { data: Omit<StoredSnapshot, 'sealedAt'> }) => {
      this.snapshots.push({ ...data, sealedAt: null });
      return data;
    },
    findFirst: async ({ where }: { where: { tournamentId: string } }) => {
      const revisions = this.snapshots
        .filter((snapshot) => snapshot.tournamentId === where.tournamentId)
        .map(({ revision }) => revision);
      const revision = revisions.length > 0 ? Math.max(...revisions) : undefined;
      return revision ? { revision } : null;
    },
    findUnique: async ({
      where,
    }: {
      where: {
        tournamentId_contentHash: {
          contentHash: string;
          tournamentId: string;
        };
      };
    }) => {
      return (
        this.snapshots.find(
          (snapshot) =>
            snapshot.tournamentId === where.tournamentId_contentHash.tournamentId &&
            snapshot.contentHash === where.tournamentId_contentHash.contentHash,
        ) ?? null
      );
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: { sealedAt: Date };
      where: { id: string; sealedAt: null };
    }) => {
      if (this.failSeal) return { count: 0 };
      const snapshot = this.snapshots.find(
        (candidate) => candidate.id === where.id && candidate.sealedAt === null,
      );
      if (!snapshot) return { count: 0 };
      snapshot.sealedAt = data.sealedAt;
      return { count: 1 };
    },
  };

  readonly $queryRaw = async () => {
    this.advisoryLocks += 1;
    return [{ pg_advisory_xact_lock: '' }];
  };

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return operation(this);
  }
}
