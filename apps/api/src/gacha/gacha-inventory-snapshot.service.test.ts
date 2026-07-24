import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { DatabaseClient } from '@openpacksduel/db';
import { GachaInventoryExclusionReason } from '@openpacksduel/db';

import {
  fixtureSnapshotInput,
  type GachaInventorySnapshotPolicy,
  GachaInventorySnapshotService,
  prepareGachaInventorySnapshot,
} from './gacha-inventory-snapshot.service.js';
import type { SportsPackGachaCard, SportsPackGachaMachine } from './sports-pack-gacha.provider.js';

const EVALUATED_AT = new Date('2026-07-24T12:00:00.000Z');
const FRESH_AT = new Date('2026-07-24T11:59:30.000Z');
const MACHINE: SportsPackGachaMachine = {
  committedPoolSize: 4,
  displayName: 'Football $50 Devnet Fixture',
  machineKey: 'collector-crypt-football-50000000-devnet-fixture',
  sport: 'football',
  tierPriceMinor: '50000000',
};
const ORIGINAL_ENV = {
  fixture: process.env.OPENPACKSDUEL_GACHA_FIXTURE_MODE,
  node: process.env.NODE_ENV,
  vercel: process.env.VERCEL_ENV,
};

afterEach(() => {
  restoreEnvironment('OPENPACKSDUEL_GACHA_FIXTURE_MODE', ORIGINAL_ENV.fixture);
  restoreEnvironment('NODE_ENV', ORIGINAL_ENV.node);
  restoreEnvironment('VERCEL_ENV', ORIGINAL_ENV.vercel);
});

describe('prepareGachaInventorySnapshot', () => {
  test('produces deterministic content hashes independent of provider order', () => {
    const first = card('fixture-card-a', 'asset-a', '35000000');
    const second = card('fixture-card-b', 'asset-b', '75000000');
    const left = prepareGachaInventorySnapshot({
      candidates: [second, first],
      evaluatedAt: EVALUATED_AT,
      policy: policy(),
    });
    const right = prepareGachaInventorySnapshot({
      candidates: [first, second],
      evaluatedAt: EVALUATED_AT,
      policy: policy(),
    });

    expect(left.contentHash).toBe(right.contentHash);
    expect(left.policyHash).toBe(right.policyHash);
    expect(left.entries).toEqual(right.entries);
    expect(left.eligibleValueMinor).toBe('110000000');
  });

  test('records deterministic exclusion reasons without admitting duplicate assets', () => {
    const staleAt = new Date(EVALUATED_AT.getTime() - 600_000);
    const prepared = prepareGachaInventorySnapshot({
      candidates: [
        card('fixture-card-eligible', 'asset-eligible', '75000000'),
        card('fixture-card-duplicate-a', 'asset-duplicate', '35000000'),
        card('fixture-card-duplicate-b', 'asset-duplicate', '35000000'),
        deniedCard(staleAt),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy({ minimumEligibleItems: 1 }),
    });

    expect(prepared.entries[1]?.exclusionReasons).toEqual([
      GachaInventoryExclusionReason.DUPLICATE_ASSET,
    ]);
    expect(prepared.entries[2]?.exclusionReasons).toEqual([
      GachaInventoryExclusionReason.DUPLICATE_ASSET,
    ]);
    expect(prepared.entries[0]?.exclusionReasons).toEqual([
      GachaInventoryExclusionReason.MISSING_ASSET_REFERENCE,
      GachaInventoryExclusionReason.MISSING_VALUATION_SOURCE,
      GachaInventoryExclusionReason.STALE_VALUATION,
      GachaInventoryExclusionReason.POOL_CLOSED,
      GachaInventoryExclusionReason.TIER_DISABLED,
      GachaInventoryExclusionReason.NOT_VAULTED,
      GachaInventoryExclusionReason.UNGRADED,
      GachaInventoryExclusionReason.SPORT_MISMATCH,
    ]);
    expect(prepared.eligibleCount).toBe(1);
    expect(prepared.excludedCount).toBe(3);
  });

  test('enforces future evidence, committed pool bounds, and minimum eligibility', () => {
    const futureAt = new Date(EVALUATED_AT.getTime() + 1_001);
    const prepared = prepareGachaInventorySnapshot({
      candidates: [
        card('fixture-card-a', 'asset-a', '35000000'),
        card('fixture-card-b', 'asset-b', '75000000'),
        {
          ...card('fixture-card-c', 'asset-c', '150000000'),
          insuredValue: {
            amount: '150000000',
            currency: 'USDC',
            decimals: 6,
            providerReference: 'fixture-value-c-future',
            sourceTimestamp: futureAt,
          },
        },
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy({
        maximumEligibleItems: 1,
        maximumFutureSkewMs: 1_000,
        minimumEligibleItems: 1,
      }),
    });

    expect(prepared.entries[1]?.exclusionReasons).toEqual([
      GachaInventoryExclusionReason.MAXIMUM_ITEM_COUNT,
    ]);
    expect(prepared.entries[2]?.exclusionReasons).toEqual([
      GachaInventoryExclusionReason.FUTURE_VALUATION,
    ]);
    expect(() =>
      prepareGachaInventorySnapshot({
        candidates: [deniedCard(FRESH_AT)],
        evaluatedAt: EVALUATED_AT,
        policy: policy({ minimumEligibleItems: 1 }),
      }),
    ).toThrow('0 eligible items; 1 required');
  });

  test('rejects empty pools, duplicate provider evidence, and invalid money semantics', () => {
    expect(() =>
      prepareGachaInventorySnapshot({
        candidates: [],
        evaluatedAt: EVALUATED_AT,
        policy: policy(),
      }),
    ).toThrow('requires provider candidates');

    const duplicate = card('fixture-card-a', 'asset-a', '35000000');
    expect(() =>
      prepareGachaInventorySnapshot({
        candidates: [duplicate, { ...duplicate, assetReference: 'asset-b' }],
        evaluatedAt: EVALUATED_AT,
        policy: policy(),
      }),
    ).toThrow('duplicate provider card reference');

    expect(() =>
      prepareGachaInventorySnapshot({
        candidates: [
          {
            ...duplicate,
            insuredValue: {
              ...duplicate.insuredValue,
              amount: '-1',
            } as NonNullable<SportsPackGachaCard['insuredValue']>,
          },
        ],
        evaluatedAt: EVALUATED_AT,
        policy: policy({ minimumEligibleItems: 1 }),
      }),
    ).toThrow('must be an unsigned integer');
  });

  test('derives fixture evaluation time from insured and inventory evidence', () => {
    const latestInventoryTimestamp = new Date('2026-07-24T12:00:03.000Z');
    const input = fixtureSnapshotInput(MACHINE, [
      {
        ...card('fixture-card-a', 'asset-a', '35000000'),
        insuredValue: {
          ...card('fixture-card-a', 'asset-a', '35000000').insuredValue!,
          sourceTimestamp: new Date('2026-07-24T12:00:02.000Z'),
        },
        inventorySourceTimestamp: new Date('2026-07-24T12:00:01.000Z'),
      },
      {
        ...card('fixture-card-b', 'asset-b', '75000000'),
        insuredValue: {
          ...card('fixture-card-b', 'asset-b', '75000000').insuredValue!,
          sourceTimestamp: new Date('2026-07-24T12:00:00.000Z'),
        },
        inventorySourceTimestamp: new Date('2026-07-24T12:00:01.000Z'),
      },
      {
        ...card('fixture-card-c', 'asset-c', undefined),
        inventorySourceTimestamp: latestInventoryTimestamp,
      },
    ]);

    expect(input.evaluatedAt).toEqual(latestInventoryTimestamp);
    expect(input.policy.minimumEligibleItems).toBe(MACHINE.committedPoolSize);
  });

  test('rejects oversized pools and malformed policy or provider evidence', () => {
    const validCard = card('fixture-card-a', 'asset-a', '35000000');
    const cases: Array<{
      input: Parameters<typeof prepareGachaInventorySnapshot>[0];
      message: string;
    }> = [
      {
        input: {
          candidates: Array.from({ length: 501 }, () => validCard),
          evaluatedAt: EVALUATED_AT,
          policy: policy(),
        },
        message: 'exceeds 500 candidates',
      },
      {
        input: {
          candidates: [validCard],
          evaluatedAt: new Date('invalid'),
          policy: policy({ minimumEligibleItems: 1 }),
        },
        message: 'evaluatedAt is invalid',
      },
      {
        input: {
          candidates: [validCard],
          evaluatedAt: EVALUATED_AT,
          policy: policy({
            machine: { ...MACHINE, sport: 'hockey' as SportsPackGachaMachine['sport'] },
            minimumEligibleItems: 1,
          }),
        },
        message: 'sport is invalid',
      },
      {
        input: {
          candidates: [validCard],
          evaluatedAt: EVALUATED_AT,
          policy: policy({
            machine: { ...MACHINE, machineKey: 123 as unknown as string },
            minimumEligibleItems: 1,
          }),
        },
        message: 'machine.machineKey is invalid',
      },
      {
        input: {
          candidates: [validCard],
          evaluatedAt: EVALUATED_AT,
          policy: policy({
            machine: { ...MACHINE, machineKey: 'invalid machine key' },
            minimumEligibleItems: 1,
          }),
        },
        message: 'machine.machineKey is invalid',
      },
      {
        input: {
          candidates: [validCard],
          evaluatedAt: EVALUATED_AT,
          policy: policy({ minimumEligibleItems: 0 }),
        },
        message: 'minimumEligibleItems is invalid',
      },
      {
        input: {
          candidates: [{ ...validCard, graded: 'yes' as unknown as boolean }],
          evaluatedAt: EVALUATED_AT,
          policy: policy({ minimumEligibleItems: 1 }),
        },
        message: 'graded is invalid',
      },
      {
        input: {
          candidates: [{ ...validCard, providerCardReference: '' }],
          evaluatedAt: EVALUATED_AT,
          policy: policy({ minimumEligibleItems: 1 }),
        },
        message: 'providerCardReference is invalid',
      },
      {
        input: {
          candidates: [{ ...validCard, displayName: 'Fixture\u0000card' }],
          evaluatedAt: EVALUATED_AT,
          policy: policy({ minimumEligibleItems: 1 }),
        },
        message: 'displayName is invalid',
      },
      {
        input: {
          candidates: [
            {
              ...validCard,
              insuredValue: {
                ...validCard.insuredValue!,
                currency: 'EUR' as 'USDC',
              },
            },
          ],
          evaluatedAt: EVALUATED_AT,
          policy: policy({ minimumEligibleItems: 1 }),
        },
        message: 'insuredValue must use micro-USDC',
      },
    ];

    for (const { input, message } of cases) {
      expect(() => prepareGachaInventorySnapshot(input)).toThrow(message);
    }
  });
});

describe('GachaInventorySnapshotService', () => {
  test('seals snapshots, replays identical content, and increments corrected revisions', async () => {
    enableFixtureMode();
    const database = new FixtureDatabase();
    const service = new GachaInventorySnapshotService(database as unknown as DatabaseClient);
    const input = {
      candidates: [
        card('fixture-card-a', 'asset-a', '35000000'),
        card('fixture-card-b', 'asset-b', '75000000'),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy(),
    };

    const first = await service.createFixtureSnapshot(input);
    const replay = await service.createFixtureSnapshot(input);
    const correction = await service.createFixtureSnapshot({
      ...input,
      candidates: [
        input.candidates[0] as SportsPackGachaCard,
        card('fixture-card-b', 'asset-b', '76000000'),
      ],
    });

    expect(first).toMatchObject({ created: true, revision: 1 });
    expect(first.sealedAt).toBeInstanceOf(Date);
    expect(replay).toEqual({ ...first, created: false });
    expect(correction).toMatchObject({ created: true, revision: 2 });
    expect(correction.contentHash).not.toBe(first.contentHash);
    expect(database.snapshots).toHaveLength(2);
    expect(database.entries).toHaveLength(4);
    expect(database.advisoryLocks).toBe(3);
  });

  test('fails closed before database access when fixture mode is disabled', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.OPENPACKSDUEL_GACHA_FIXTURE_MODE;
    const database = new FixtureDatabase();
    const service = new GachaInventorySnapshotService(database as unknown as DatabaseClient);

    await expect(
      service.createFixtureSnapshot({
        candidates: [
          card('fixture-card-a', 'asset-a', '35000000'),
          card('fixture-card-b', 'asset-b', '75000000'),
        ],
        evaluatedAt: EVALUATED_AT,
        policy: policy(),
      }),
    ).rejects.toThrow('disabled outside explicit fixture or preview mode');
    expect(database.advisoryLocks).toBe(0);
  });

  test('rejects an unavailable seal and a missing sealed snapshot', async () => {
    enableFixtureMode();
    const database = new FixtureDatabase();
    database.failSeal = true;
    const service = new GachaInventorySnapshotService(database as unknown as DatabaseClient);

    await expect(
      service.createFixtureSnapshot({
        candidates: [
          card('fixture-card-a', 'asset-a', '35000000'),
          card('fixture-card-b', 'asset-b', '75000000'),
        ],
        evaluatedAt: EVALUATED_AT,
        policy: policy(),
      }),
    ).rejects.toThrow('could not be sealed');

    const emptyDatabase = {
      gachaInventorySnapshot: {
        findFirst: async () => null,
      },
    } as unknown as DatabaseClient;
    const emptyService = new GachaInventorySnapshotService(emptyDatabase);
    await expect(emptyService.findLatestSealed(MACHINE.machineKey)).rejects.toThrow(
      'No sealed Gacha inventory snapshot is available',
    );
  });

  test('persists nullable valuation evidence and rejects an unsealed replay', async () => {
    enableFixtureMode();
    const database = new FixtureDatabase();
    const service = new GachaInventorySnapshotService(database as unknown as DatabaseClient);
    const input = {
      candidates: [
        card('fixture-card-a', 'asset-a', '35000000'),
        card('fixture-card-without-value', 'asset-without-value', undefined),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy({ minimumEligibleItems: 1 }),
    };

    await expect(service.createFixtureSnapshot(input)).resolves.toMatchObject({ created: true });
    expect(database.entries).toHaveLength(2);

    const stored = database.snapshots[0];
    expect(stored).toBeDefined();
    if (!stored) throw new Error('Expected a stored fixture snapshot');
    stored.sealedAt = null;

    await expect(service.createFixtureSnapshot(input)).rejects.toThrow(
      'Gacha inventory snapshot is not sealed',
    );
  });
});

describe('Gacha inventory migration contract', () => {
  test('enforces typed exclusions, immutable seals, odds totals, and lifecycle evidence', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/prisma/migrations/20260724120000_gacha_rip_flow/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('CREATE TYPE "GachaInventoryExclusionReason"');
    expect(migration).toContain('"GachaInventorySnapshot_poolKey_revision_key"');
    expect(migration).toContain('Gacha inventory snapshot contents do not match metadata');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('"probabilityScalePpm" = 1000000');
    expect(migration).toContain('"status" = \'REVEALED\'');
    expect(migration).toContain('"status" = \'ACQUIRED\'');
    expect(migration).toContain('"status" = \'SETTLED\'');
  });
});

function policy(
  overrides: Partial<GachaInventorySnapshotPolicy> = {},
): GachaInventorySnapshotPolicy {
  return {
    machine: MACHINE,
    maximumEligibleItems: 4,
    maximumFutureSkewMs: 1_000,
    maximumSourceAgeMs: 60_000,
    minimumEligibleItems: 2,
    policyVersion: 'gacha-fixture-policy-v1',
    poolKey: `${MACHINE.machineKey}:pool`,
    provider: 'collector-crypt-devnet-fixture',
    ...overrides,
  };
}

function card(
  providerCardReference: string,
  assetReference: string | undefined,
  insuredValueMinor: string | undefined,
): SportsPackGachaCard {
  return {
    ...(assetReference ? { assetReference } : {}),
    displayName: `Fixture ${providerCardReference}`,
    graded: true,
    graderReference: 'fixture-grader:psa',
    ...(insuredValueMinor
      ? {
          insuredValue: {
            amount: insuredValueMinor,
            currency: 'USDC' as const,
            decimals: 6 as const,
            providerReference: `fixture-value:${providerCardReference}`,
            sourceTimestamp: FRESH_AT,
          },
        }
      : {}),
    inventorySourceTimestamp: FRESH_AT,
    poolOpen: true,
    providerCardReference,
    sport: 'football',
    tierEnabled: true,
    valuationSourceReference: `fixture-valuation:${providerCardReference}`,
    vaulted: true,
  };
}

function deniedCard(sourceTimestamp: Date): SportsPackGachaCard {
  return {
    displayName: 'Fixture denied card',
    graded: false,
    insuredValue: {
      amount: '35000000',
      currency: 'USDC',
      decimals: 6,
      providerReference: 'fixture-value-denied',
      sourceTimestamp,
    },
    inventorySourceTimestamp: FRESH_AT,
    poolOpen: false,
    providerCardReference: 'fixture-card-denied',
    sport: 'soccer',
    tierEnabled: false,
    vaulted: false,
  };
}

function enableFixtureMode(): void {
  process.env.NODE_ENV = 'test';
  process.env.OPENPACKSDUEL_GACHA_FIXTURE_MODE = 'true';
  delete process.env.VERCEL_ENV;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

interface StoredSnapshot {
  contentHash: string;
  id: string;
  machineKey: string;
  poolKey: string;
  revision: number;
  sealedAt: Date | null;
}

class FixtureDatabase {
  advisoryLocks = 0;
  entries: unknown[] = [];
  failSeal = false;
  snapshots: StoredSnapshot[] = [];

  readonly gachaMachine = {
    upsert: async () => ({ id: 'gachamachine_fixture' }),
  };

  readonly gachaInventorySnapshotEntry = {
    createMany: async ({ data }: { data: unknown[] }) => {
      this.entries.push(...data);
      return { count: data.length };
    },
  };

  readonly gachaInventorySnapshot = {
    create: async ({ data }: { data: Omit<StoredSnapshot, 'sealedAt'> }) => {
      this.snapshots.push({ ...data, sealedAt: null });
      return data;
    },
    findFirst: async ({ where }: { where: { poolKey: string } }) => {
      const revisions = this.snapshots
        .filter((snapshot) => snapshot.poolKey === where.poolKey)
        .map(({ revision }) => revision);
      const revision = revisions.length > 0 ? Math.max(...revisions) : undefined;
      return revision ? { revision } : null;
    },
    findUnique: async ({
      where,
    }: {
      where: { poolKey_contentHash: { contentHash: string; poolKey: string } };
    }) => {
      return (
        this.snapshots.find(
          (snapshot) =>
            snapshot.poolKey === where.poolKey_contentHash.poolKey &&
            snapshot.contentHash === where.poolKey_contentHash.contentHash,
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
    return operation(this);
  }
}
