import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDatabaseClient, type DatabaseClient } from '@dailydraft/db';

import {
  type FlipInventoryCandidate,
  type FlipInventorySnapshotPolicy,
  FlipInventorySnapshotService,
} from './flip-inventory-snapshot.service.js';
import { createFixtureFlipRuleSet, FlipRulesService } from './flip-rules.service.js';

const databaseUrl = process.env.DATABASE_URL;

if (process.env.REQUIRE_DB_INTEGRATION === '1' && !databaseUrl) {
  throw new Error('REQUIRE_DB_INTEGRATION=1 but DATABASE_URL is unset');
}

const describeDatabase =
  process.env.REQUIRE_DB_INTEGRATION === '1' && databaseUrl ? describe : describe.skip;

describeDatabase('Flip rules concurrency against two real Postgres connections', () => {
  let databaseA: DatabaseClient;
  let databaseB: DatabaseClient;
  const originalEnvironment = {
    fixture: process.env.DAILYDRAFT_FLIP_FIXTURE_MODE,
    node: process.env.NODE_ENV,
    vercel: process.env.VERCEL_ENV,
  };

  beforeAll(() => {
    databaseA = createDatabaseClient(databaseUrl ?? '');
    databaseB = createDatabaseClient(databaseUrl ?? '');
    process.env.NODE_ENV = 'test';
    process.env.DAILYDRAFT_FLIP_FIXTURE_MODE = 'true';
    delete process.env.VERCEL_ENV;
  });

  afterAll(async () => {
    await Promise.all([databaseA.$disconnect(), databaseB.$disconnect()]);
    restoreEnvironment('DAILYDRAFT_FLIP_FIXTURE_MODE', originalEnvironment.fixture);
    restoreEnvironment('NODE_ENV', originalEnvironment.node);
    restoreEnvironment('VERCEL_ENV', originalEnvironment.vercel);
  });

  test('serializes identical rules and session commitments into one sealed record', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const poolKey = `dbtest-flip-${suffix}`;
    const policyVersion = `dbtest-policy-${suffix}`;
    const rulesKey = `dbtest-rules-${suffix}`;
    const snapshot = await createSnapshot(databaseA, poolKey, policyVersion);
    const rules = createFixtureFlipRuleSet({
      inventoryPolicyVersion: policyVersion,
      poolKey,
      rulesKey,
    });
    const serviceA = new FlipRulesService(databaseA);
    const serviceB = new FlipRulesService(databaseB);

    const rulesResults = await Promise.all([
      serviceA.createFixtureRuleSet(rules),
      serviceB.createFixtureRuleSet(rules),
    ]);
    expect(rulesResults.filter(({ created }) => created)).toHaveLength(1);
    expect(new Set(rulesResults.map(({ id }) => id)).size).toBe(1);

    const input = {
      committedAt: new Date('2026-08-03T12:02:00.000Z'),
      rulesKey,
      rulesVersion: 1,
      sessionReference: `dbtest-session-${suffix}`,
      snapshotId: snapshot.id,
    };
    const commitmentResults = await Promise.all([
      serviceA.createFixtureSessionPoolCommitment(input),
      serviceB.createFixtureSessionPoolCommitment(input),
    ]);
    expect(commitmentResults.filter(({ created }) => created)).toHaveLength(1);
    expect(new Set(commitmentResults.map(({ id }) => id)).size).toBe(1);
    expect(
      await databaseA.flipSessionPoolCommitment.count({
        where: { sessionReference: input.sessionReference },
      }),
    ).toBe(1);
  });

  test('deterministically rejects conflicting rules and pool inputs under concurrency', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const poolKey = `dbtest-flip-conflict-${suffix}`;
    const policyVersion = `dbtest-policy-conflict-${suffix}`;
    const rulesKey = `dbtest-rules-conflict-${suffix}`;
    const firstSnapshot = await createSnapshot(databaseA, poolKey, policyVersion);
    const correctedSnapshot = await createSnapshot(databaseA, poolKey, policyVersion, '31000000');
    const serviceA = new FlipRulesService(databaseA);
    const serviceB = new FlipRulesService(databaseB);
    const firstRules = createFixtureFlipRuleSet({
      inventoryPolicyVersion: policyVersion,
      poolKey,
      rulesKey,
    });
    const conflictingRules = createFixtureFlipRuleSet({
      feeAmount: '1000000',
      inventoryPolicyVersion: policyVersion,
      poolKey,
      rulesKey,
    });

    const rulesResults = await Promise.allSettled([
      serviceA.createFixtureRuleSet(firstRules),
      serviceB.createFixtureRuleSet(conflictingRules),
    ]);
    expect(rulesResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(rulesResults.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    const storedRules = await databaseA.flipRuleSet.findUniqueOrThrow({
      where: { rulesKey_version: { rulesKey, version: 1 } },
    });
    const winningRules =
      storedRules.rulesHash === firstRules.rulesHash ? firstRules : conflictingRules;
    const sessionReference = `dbtest-session-conflict-${suffix}`;
    const commitmentResults = await Promise.allSettled([
      serviceA.createFixtureSessionPoolCommitment({
        committedAt: new Date('2026-08-03T12:02:00.000Z'),
        rulesKey: winningRules.rulesKey,
        rulesVersion: winningRules.version,
        sessionReference,
        snapshotId: firstSnapshot.id,
      }),
      serviceB.createFixtureSessionPoolCommitment({
        committedAt: new Date('2026-08-03T12:02:00.000Z'),
        rulesKey: winningRules.rulesKey,
        rulesVersion: winningRules.version,
        sessionReference,
        snapshotId: correctedSnapshot.id,
      }),
    ]);
    expect(commitmentResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(commitmentResults.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await databaseA.flipSessionPoolCommitment.count({ where: { sessionReference } })).toBe(
      1,
    );
  });
});

async function createSnapshot(
  database: DatabaseClient,
  poolKey: string,
  policyVersion: string,
  plusValue = '30000000',
) {
  const service = new FlipInventorySnapshotService(database);
  return service.createFixtureSnapshot({
    candidates: [
      candidate('base', '20000000'),
      candidate('plus', plusValue),
      candidate('chase', '60000000'),
    ],
    evaluatedAt: new Date('2026-08-03T12:00:00.000Z'),
    policy: policy(poolKey, policyVersion),
  });
}

function policy(poolKey: string, policyVersion: string): FlipInventorySnapshotPolicy {
  return {
    allowedCollections: ['pokemon-graded'],
    allowedGraders: ['psa'],
    excludedProviderAssetReferences: [],
    excludedProviderListingReferences: [],
    maximumEligibleItems: 10,
    maximumExposure: moneyPolicy('200000000'),
    maximumFutureSkewMs: 1_000,
    maximumListingValue: moneyPolicy('100000000'),
    maximumSourceAgeMs: 60_000,
    minimumEligibleItems: 3,
    minimumLiquidityBasisPoints: 5_000,
    minimumListingValue: moneyPolicy('10000000'),
    policyVersion,
    poolKey,
    provider: 'fixture-marketplace',
    stake: moneyPolicy('50000000'),
  };
}

function candidate(reference: string, amount: string): FlipInventoryCandidate {
  const sourceTimestamp = new Date('2026-08-03T11:59:30.000Z');
  return {
    buybackValue: null,
    displayedValue: null,
    insuredValue: null,
    inventorySourceTimestamp: sourceTimestamp,
    liquidityBasisPoints: 8_000,
    listingValue: {
      amount,
      currency: 'USDC',
      decimals: 6,
      providerReference: `value_${reference}`,
      sourceTimestamp,
    },
    normalizedCollection: 'pokemon-graded',
    normalizedGrader: 'psa',
    providerAssetReference: `asset_${reference}`,
    providerCollectionReference: 'collection_pokemon',
    providerGraderReference: 'grader_psa',
    providerListingReference: `listing_${reference}`,
  };
}

function moneyPolicy(amount: string) {
  return { amount, currency: 'USDC', decimals: 6 };
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
