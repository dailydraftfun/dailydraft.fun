import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { DatabaseClient } from '@openpacksduel/db';
import { FlipInventoryExclusionReason } from '@openpacksduel/db';

import {
  type FlipInventoryCandidate,
  type FlipInventorySnapshotPolicy,
  FlipInventorySnapshotService,
  flipInventoryFixtureModeEnabled,
  prepareFlipInventorySnapshot,
} from './flip-inventory-snapshot.service.js';

const EVALUATED_AT = new Date('2026-08-03T12:00:00.000Z');
const FRESH_AT = new Date('2026-08-03T11:59:30.000Z');
const ORIGINAL_ENV = {
  fixture: process.env.OPENPACKSDUEL_FLIP_FIXTURE_MODE,
  node: process.env.NODE_ENV,
  vercel: process.env.VERCEL_ENV,
};

afterEach(() => {
  restoreEnvironment('OPENPACKSDUEL_FLIP_FIXTURE_MODE', ORIGINAL_ENV.fixture);
  restoreEnvironment('NODE_ENV', ORIGINAL_ENV.node);
  restoreEnvironment('VERCEL_ENV', ORIGINAL_ENV.vercel);
});

describe('prepareFlipInventorySnapshot', () => {
  test('preserves distinct value evidence and uses listing value only for eligibility', () => {
    const prepared = prepareFlipInventorySnapshot({
      candidates: [
        candidate('listing_b', {
          buybackValue: money('39000000', 'buyback_b'),
          displayedValue: money('47000000', 'displayed_b'),
          insuredValue: money('51000000', 'insured_b'),
          listingValue: money('4500', 'listing_value_b', 2),
        }),
        candidate('listing_a', {
          listingValue: money('50000000', 'listing_value_a'),
        }),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy(),
    });

    expect(prepared.entries.map((entry) => entry.providerListingReference)).toEqual([
      'listing_a',
      'listing_b',
    ]);
    const second = prepared.entries[1];
    expect(second).toMatchObject({
      eligibilityListingValueAmount: '45000000',
      eligibilityListingValueCurrency: 'USDC',
      eligibilityListingValueDecimals: 6,
      eligible: true,
    });
    expect(second?.listingValue?.amount).toBe('4500');
    expect(second?.listingValue?.decimals).toBe(2);
    expect(second?.insuredValue?.amount).toBe('51000000');
    expect(second?.buybackValue?.amount).toBe('39000000');
    expect(second?.displayedValue?.amount).toBe('47000000');
    expect(prepared.eligibleValueAmount).toBe('95000000');
  });

  test('records every deterministic exclusion reason without substituting values', () => {
    const stale = new Date(EVALUATED_AT.getTime() - 120_000);
    const prepared = prepareFlipInventorySnapshot({
      candidates: [
        candidate('listing_allowed', { listingValue: money('40000000', 'allowed_value') }),
        candidate('listing_denied', {
          inventorySourceTimestamp: stale,
          liquidityBasisPoints: 4999,
          listingValue: money('9000000', 'denied_value', 6, stale),
          normalizedCollection: 'blocked-collection',
          normalizedGrader: 'blocked-grader',
        }),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy({
        excludedProviderListingReferences: ['listing_denied'],
        minimumEligibleItems: 1,
      }),
    });

    expect(prepared.entries[1]).toMatchObject({
      eligibilityListingValueAmount: '9000000',
      eligible: false,
      exclusionReasons: [
        FlipInventoryExclusionReason.EXPLICIT_EXCLUSION,
        FlipInventoryExclusionReason.COLLECTION_NOT_ALLOWED,
        FlipInventoryExclusionReason.GRADER_NOT_ALLOWED,
        FlipInventoryExclusionReason.INVENTORY_STALE,
        FlipInventoryExclusionReason.LIQUIDITY_BELOW_MINIMUM,
        FlipInventoryExclusionReason.VALUE_STALE,
        FlipInventoryExclusionReason.VALUE_BELOW_MINIMUM,
      ],
    });
    expect(prepared.excludedCount).toBe(1);
  });

  test('applies maximum exposure and item count after locale-independent ordering', () => {
    const prepared = prepareFlipInventorySnapshot({
      candidates: [
        candidate('listing_c', { listingValue: money('20000000', 'value_c') }),
        candidate('listing_b', { listingValue: money('70000000', 'value_b') }),
        candidate('listing_a', { listingValue: money('40000000', 'value_a') }),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy({
        maximumEligibleItems: 2,
        maximumExposure: policyMoney('100000000'),
        minimumEligibleItems: 1,
      }),
    });

    expect(
      prepared.entries.map(({ eligible, exclusionReasons, providerListingReference }) => ({
        eligible,
        exclusionReasons,
        providerListingReference,
      })),
    ).toEqual([
      { eligible: true, exclusionReasons: [], providerListingReference: 'listing_a' },
      {
        eligible: false,
        exclusionReasons: [FlipInventoryExclusionReason.MAXIMUM_EXPOSURE],
        providerListingReference: 'listing_b',
      },
      { eligible: true, exclusionReasons: [], providerListingReference: 'listing_c' },
    ]);

    const itemBounded = prepareFlipInventorySnapshot({
      candidates: [
        candidate('listing_b', { listingValue: money('20000000', 'value_b') }),
        candidate('listing_a', { listingValue: money('20000000', 'value_a') }),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy({ maximumEligibleItems: 1, minimumEligibleItems: 1 }),
    });
    expect(itemBounded.entries[1]?.exclusionReasons).toEqual([
      FlipInventoryExclusionReason.MAXIMUM_ITEM_COUNT,
    ]);
  });

  test('handles freshness boundaries and rejects unsupported future evidence', () => {
    const atStaleBoundary = new Date(EVALUATED_AT.getTime() - 60_000);
    const atFutureBoundary = new Date(EVALUATED_AT.getTime() + 1_000);
    const tooFarFuture = new Date(EVALUATED_AT.getTime() + 1_001);
    const prepared = prepareFlipInventorySnapshot({
      candidates: [
        candidate('listing_a', {
          inventorySourceTimestamp: atStaleBoundary,
          listingValue: money('20000000', 'value_a', 6, atFutureBoundary),
        }),
        candidate('listing_b', {
          inventorySourceTimestamp: tooFarFuture,
          listingValue: money('20000000', 'value_b', 6, tooFarFuture),
        }),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy({ maximumFutureSkewMs: 1_000, minimumEligibleItems: 1 }),
    });

    expect(prepared.entries[0]?.eligible).toBe(true);
    expect(prepared.entries[1]?.exclusionReasons).toEqual([
      FlipInventoryExclusionReason.INVENTORY_FROM_FUTURE,
      FlipInventoryExclusionReason.VALUE_FROM_FUTURE,
    ]);
  });

  test('keeps inclusive price and liquidity boundaries eligible', () => {
    const prepared = prepareFlipInventorySnapshot({
      candidates: [
        candidate('listing_minimum', {
          liquidityBasisPoints: 5_000,
          listingValue: money('10000000', 'value_minimum'),
        }),
        candidate('listing_maximum', {
          liquidityBasisPoints: 5_000,
          listingValue: money('100000000', 'value_maximum'),
        }),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy(),
    });

    expect(prepared.entries.every((entry) => entry.eligible)).toBe(true);
    expect(prepared.entries.every((entry) => entry.exclusionReasons.length === 0)).toBe(true);
  });

  test('does not fall back when listing value is missing or outside the price band', () => {
    const prepared = prepareFlipInventorySnapshot({
      candidates: [
        candidate('listing_allowed', { listingValue: money('20000000', 'value_allowed') }),
        candidate('listing_below', {
          insuredValue: money('50000000', 'insured_below'),
          listingValue: money('9999999', 'value_below'),
        }),
        candidate('listing_missing', {
          buybackValue: money('50000000', 'buyback_missing'),
          listingValue: null,
        }),
        candidate('listing_above', {
          displayedValue: money('50000000', 'displayed_above'),
          listingValue: money('100000001', 'value_above'),
        }),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy({ minimumEligibleItems: 1 }),
    });

    expect(prepared.entries[0]?.exclusionReasons).toEqual([
      FlipInventoryExclusionReason.VALUE_ABOVE_MAXIMUM,
    ]);
    expect(prepared.entries[2]?.exclusionReasons).toEqual([
      FlipInventoryExclusionReason.VALUE_BELOW_MINIMUM,
    ]);
    expect(prepared.entries[3]?.exclusionReasons).toEqual([
      FlipInventoryExclusionReason.VALUE_UNAVAILABLE,
    ]);
  });

  test('produces the same canonical hash regardless of provider input order', () => {
    const first = candidate('listing_a', { listingValue: money('20000000', 'value_a') });
    const second = candidate('listing_b', { listingValue: money('30000000', 'value_b') });
    const left = prepareFlipInventorySnapshot({
      candidates: [second, first],
      evaluatedAt: EVALUATED_AT,
      policy: policy(),
    });
    const right = prepareFlipInventorySnapshot({
      candidates: [first, second],
      evaluatedAt: EVALUATED_AT,
      policy: policy(),
    });

    expect(left.policyHash).toBe(right.policyHash);
    expect(left.contentHash).toBe(right.contentHash);
    expect(left.entries).toEqual(right.entries);
  });

  test('fails atomically on duplicate or imprecise provider evidence and insufficient pools', () => {
    const duplicate = candidate('listing_a', { listingValue: money('20000000', 'value_a') });
    expect(() =>
      prepareFlipInventorySnapshot({
        candidates: [duplicate, { ...duplicate, providerListingReference: 'listing_b' }],
        evaluatedAt: EVALUATED_AT,
        policy: policy(),
      }),
    ).toThrow('duplicate provider asset reference');
    expect(() =>
      prepareFlipInventorySnapshot({
        candidates: [
          candidate('listing_a', {
            listingValue: money('10000001', 'value_a', 7),
          }),
        ],
        evaluatedAt: EVALUATED_AT,
        policy: policy({ minimumEligibleItems: 1 }),
      }),
    ).toThrow('cannot be normalized exactly');
    expect(() =>
      prepareFlipInventorySnapshot({
        candidates: [candidate('listing_a', { listingValue: null })],
        evaluatedAt: EVALUATED_AT,
        policy: policy({ minimumEligibleItems: 1 }),
      }),
    ).toThrow('0 eligible items; 1 required');
    expect(() =>
      prepareFlipInventorySnapshot({
        candidates: [
          candidate('listing_a', {
            providerListingReference: 'listing_\ninvalid',
          }),
        ],
        evaluatedAt: EVALUATED_AT,
        policy: policy({ minimumEligibleItems: 1 }),
      }),
    ).toThrow('providerListingReference is invalid');
  });
});

describe('FlipInventorySnapshotService', () => {
  test('replays identical content and creates a new immutable revision for corrections', async () => {
    enableFixtureMode();
    const database = new FixtureDatabase();
    const service = new FlipInventorySnapshotService(database as unknown as DatabaseClient);
    const input = {
      candidates: [
        candidate('listing_a', { listingValue: money('20000000', 'value_a') }),
        candidate('listing_b', { listingValue: money('30000000', 'value_b') }),
      ],
      evaluatedAt: EVALUATED_AT,
      policy: policy(),
    };

    const [first, replay] = await Promise.all([
      service.createFixtureSnapshot(input),
      service.createFixtureSnapshot(input),
    ]);
    const correction = await service.createFixtureSnapshot({
      ...input,
      candidates: [
        input.candidates[0] as FlipInventoryCandidate,
        candidate('listing_b', { listingValue: money('31000000', 'value_b_corrected') }),
      ],
    });

    expect(first).toMatchObject({ created: true, revision: 1 });
    expect(replay).toEqual({ ...first, created: false });
    expect(correction).toMatchObject({ created: true, revision: 2 });
    expect(correction.contentHash).not.toBe(first.contentHash);
    expect(database.snapshots).toHaveLength(2);
    expect(database.entries).toHaveLength(4);
    expect(database.advisoryLocks).toBe(3);
  });

  test('stays disabled without an explicit non-production fixture flag', async () => {
    const database = new FixtureDatabase();
    const service = new FlipInventorySnapshotService(database as unknown as DatabaseClient);
    process.env.NODE_ENV = 'test';
    delete process.env.OPENPACKSDUEL_FLIP_FIXTURE_MODE;

    await expect(
      service.createFixtureSnapshot({
        candidates: [
          candidate('listing_a', { listingValue: money('20000000', 'value_a') }),
          candidate('listing_b', { listingValue: money('30000000', 'value_b') }),
        ],
        evaluatedAt: EVALUATED_AT,
        policy: policy(),
      }),
    ).rejects.toThrow('disabled outside explicit fixture or preview mode');
    expect(database.advisoryLocks).toBe(0);
    expect(
      flipInventoryFixtureModeEnabled({
        NODE_ENV: 'production',
        OPENPACKSDUEL_FLIP_FIXTURE_MODE: 'true',
        VERCEL_ENV: 'production',
      }),
    ).toBe(false);
    expect(
      flipInventoryFixtureModeEnabled({
        NODE_ENV: 'production',
        OPENPACKSDUEL_FLIP_FIXTURE_MODE: 'true',
        VERCEL_ENV: 'preview',
      }),
    ).toBe(true);
  });
});

describe('Flip inventory migration contract', () => {
  test('enforces typed exclusions, tuple integrity, unique listings, and append-only evidence', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/prisma/migrations/20260723050000_flip_inventory_snapshots/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('CREATE TYPE "FlipInventoryExclusionReason"');
    expect(migration).toContain(
      '"FlipInventorySnapshotEntry_snapshotId_providerListingReference_key"',
    );
    expect(migration).toContain('"FlipInventorySnapshotEntry_listing_value_check"');
    expect(migration).toContain('"FlipInventorySnapshotEntry_buyback_value_check"');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "FlipInventorySnapshot"');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('Flip inventory snapshot contents do not match metadata');
    expect(migration).toContain('BEFORE INSERT ON "FlipInventorySnapshotEntry"');
    expect(migration).toContain('Flip inventory snapshot entries are sealed');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "FlipInventorySnapshotEntry"');
  });
});

function policy(overrides: Partial<FlipInventorySnapshotPolicy> = {}): FlipInventorySnapshotPolicy {
  return {
    allowedCollections: ['pokemon-graded'],
    allowedGraders: ['psa'],
    excludedProviderAssetReferences: [],
    excludedProviderListingReferences: [],
    maximumEligibleItems: 10,
    maximumExposure: policyMoney('200000000'),
    maximumFutureSkewMs: 1_000,
    maximumListingValue: policyMoney('100000000'),
    maximumSourceAgeMs: 60_000,
    minimumEligibleItems: 2,
    minimumLiquidityBasisPoints: 5_000,
    minimumListingValue: policyMoney('10000000'),
    policyVersion: 'flip-fixture-policy-v1',
    poolKey: 'flip-pokemon-50',
    provider: 'fixture-marketplace',
    stake: policyMoney('50000000'),
    ...overrides,
  };
}

function policyMoney(amount: string, decimals = 6) {
  return { amount, currency: 'USDC', decimals };
}

function candidate(
  providerListingReference: string,
  overrides: Partial<FlipInventoryCandidate> = {},
): FlipInventoryCandidate {
  return {
    buybackValue: null,
    displayedValue: null,
    insuredValue: null,
    inventorySourceTimestamp: FRESH_AT,
    liquidityBasisPoints: 8_000,
    listingValue: money('25000000', `${providerListingReference}_listing_value`),
    normalizedCollection: 'pokemon-graded',
    normalizedGrader: 'psa',
    providerAssetReference: `${providerListingReference}_asset`,
    providerCollectionReference: 'provider_collection_pokemon',
    providerGraderReference: 'provider_grader_psa',
    providerListingReference,
    ...overrides,
  };
}

function money(
  amount: string,
  providerReference: string,
  decimals = 6,
  sourceTimestamp = FRESH_AT,
) {
  return {
    amount,
    currency: 'USDC',
    decimals,
    providerReference,
    sourceTimestamp,
  };
}

function enableFixtureMode(): void {
  process.env.NODE_ENV = 'test';
  process.env.OPENPACKSDUEL_FLIP_FIXTURE_MODE = 'true';
  delete process.env.VERCEL_ENV;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

interface StoredSnapshot {
  contentHash: string;
  id: string;
  poolKey: string;
  revision: number;
  sealedAt: Date | null;
}

class FixtureDatabase {
  #transactionTail = Promise.resolve();
  advisoryLocks = 0;
  entries: unknown[] = [];
  snapshots: StoredSnapshot[] = [];

  readonly flipInventorySnapshotEntry = {
    createMany: async ({ data }: { data: unknown[] }) => {
      this.entries.push(...data);
      return { count: data.length };
    },
  };

  readonly flipInventorySnapshot = {
    create: async ({ data }: { data: StoredSnapshot }) => {
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
      const existing = this.snapshots.find(
        (snapshot) =>
          snapshot.poolKey === where.poolKey_contentHash.poolKey &&
          snapshot.contentHash === where.poolKey_contentHash.contentHash,
      );
      return existing
        ? {
            contentHash: existing.contentHash,
            id: existing.id,
            poolKey: existing.poolKey,
            revision: existing.revision,
            sealedAt: existing.sealedAt,
          }
        : null;
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: { sealedAt: Date };
      where: { id: string; sealedAt: null };
    }) => {
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
    const previous = this.#transactionTail;
    let release = () => {};
    this.#transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation(this);
    } finally {
      release();
    }
  }
}
