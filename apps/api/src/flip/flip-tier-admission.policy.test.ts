import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FLIP_PROBABILITY_SCALE_PPM,
  FLIP_RULES_CALCULATOR_VERSION,
  FLIP_RULES_SCHEMA_VERSION,
} from './flip-rules.service.js';
import {
  EnvironmentFlipProviderHealthAdapter,
  evaluateFlipTierAdmission,
  FLIP_PROVIDER_HEALTH_SCHEMA_VERSION,
  FLIP_TIER_ADMISSION_POLICY_VERSION,
  type FlipProviderHealthFixture,
  type FlipTierAdmissionPool,
} from './flip-tier-admission.policy.js';
import { readFlipProviderHealth } from './flip-tier-admission.service.js';

const NOW = new Date('2026-07-28T16:00:00.000Z');
const CONTRACT = JSON.parse(
  readFileSync(
    new URL('../providers/fixtures/flip-provider-health-contract.v1.json', import.meta.url),
    'utf8',
  ),
) as {
  healthy: FlipProviderHealthFixture;
  outage: FlipProviderHealthFixture;
  schemaVersion: string;
};

describe('Flip tier admission policy', () => {
  test('accepts a stake only when the reviewed pool and provider fixture are healthy', () => {
    const decision = decide();

    expect(decision).toMatchObject({
      allowed: true,
      policyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      providerHealthHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      reason: null,
      reenableBoundary: null,
      tierKey: 'USDC:6:50000000',
    });
    expect(FLIP_TIER_ADMISSION_POLICY_VERSION).toBe('dailydraft.flip-tier-admission.v1');
  });

  test.each([
    {
      label: 'degraded inventory',
      mutate: (pool: FlipTierAdmissionPool) => {
        pool.eligibleOutcomeCount = 2;
      },
      reason: 'inventory_degraded',
      reenableBoundary: 'reviewed_pool_recovery',
    },
    {
      label: 'stale inventory',
      mutate: (pool: FlipTierAdmissionPool) => {
        pool.snapshot.evaluatedAt = new Date(NOW.getTime() - 60_001);
      },
      reason: 'inventory_stale',
      reenableBoundary: 'fresh_inventory_snapshot',
    },
    {
      label: 'future inventory',
      mutate: (pool: FlipTierAdmissionPool) => {
        pool.snapshot.evaluatedAt = new Date(NOW.getTime() + 1_001);
      },
      reason: 'inventory_stale',
      reenableBoundary: 'fresh_inventory_snapshot',
    },
    {
      label: 'inventory exposure above the reviewed maximum',
      mutate: (pool: FlipTierAdmissionPool) => {
        pool.snapshot.eligibleValueAmount = '1000000001';
      },
      reason: 'inventory_degraded',
      reenableBoundary: 'reviewed_pool_recovery',
    },
    {
      health: CONTRACT.outage,
      label: 'provider outage',
      reason: 'provider_outage',
      reenableBoundary: 'fresh_provider_health',
    },
    {
      health: null,
      label: 'missing provider health',
      reason: 'provider_health_missing',
      reenableBoundary: 'fresh_provider_health',
    },
    {
      health: { ...CONTRACT.healthy, observedAt: '2026-07-28T15:58:59.999Z' },
      label: 'stale provider health',
      reason: 'provider_health_stale',
      reenableBoundary: 'fresh_provider_health',
    },
    {
      health: { ...CONTRACT.healthy, observedAt: '2026-07-28T16:00:01.001Z' },
      label: 'future provider health',
      reason: 'provider_health_stale',
      reenableBoundary: 'fresh_provider_health',
    },
    {
      health: { ...CONTRACT.healthy, unexpected: true },
      label: 'invalid provider health config',
      reason: 'configuration_invalid',
      reenableBoundary: 'configuration_change',
    },
  ])('fails closed with a stable reason for $label', ({
    health = CONTRACT.healthy,
    mutate,
    reason,
    reenableBoundary,
  }) => {
    const pool = fixturePool();
    mutate?.(pool);
    expect(decide({ health, pool })).toMatchObject({
      allowed: false,
      reason,
      reenableBoundary,
    });
  });

  test('deterministically re-enables after fresh reviewed inputs replace a denied reading', () => {
    expect(decide({ health: CONTRACT.outage })).toMatchObject({
      allowed: false,
      reason: 'provider_outage',
    });
    expect(decide({ health: CONTRACT.healthy })).toMatchObject({
      allowed: true,
      reason: null,
    });
  });

  test.each([
    (pool: FlipTierAdmissionPool) => {
      pool.rulesHash = '0'.repeat(64);
    },
    (pool: FlipTierAdmissionPool) => {
      pool.ruleset.bands = [];
    },
    (pool: FlipTierAdmissionPool) => {
      pool.snapshot.maximumSourceAgeMs = 0;
    },
    (pool: FlipTierAdmissionPool) => {
      pool.snapshot.provider = 'different-provider';
    },
    (pool: FlipTierAdmissionPool) => {
      pool.snapshot.maximumFutureSkewMs = 60_001;
    },
  ])('fails closed on invalid reviewed configuration %#', (mutate) => {
    const pool = fixturePool();
    mutate(pool);
    expect(decide({ pool })).toMatchObject({
      allowed: false,
      reason: 'configuration_invalid',
    });
  });

  test('fails closed when the reviewed pool is unavailable', () => {
    expect(decide({ pool: null })).toMatchObject({
      allowed: false,
      reason: 'configuration_invalid',
    });
  });
});

describe('Flip provider health fixture adapter contract', () => {
  test('loads the reviewed healthy and outage provider fixture shapes', async () => {
    expect(CONTRACT.schemaVersion).toBe('dailydraft.flip-provider-health-contract-fixture.v1');
    expect(CONTRACT.healthy.schemaVersion).toBe(FLIP_PROVIDER_HEALTH_SCHEMA_VERSION);
    expect(CONTRACT.healthy.status).toBe('healthy');
    expect(CONTRACT.outage.status).toBe('outage');

    const adapter = new EnvironmentFlipProviderHealthAdapter({
      DAILYDRAFT_FLIP_PROVIDER_HEALTH_FIXTURE: JSON.stringify(CONTRACT.healthy),
    });
    await expect(adapter.readFixtureHealth()).resolves.toEqual(CONTRACT.healthy);
  });

  test('surfaces missing and malformed fixture configuration for fail-closed evaluation', async () => {
    await expect(
      new EnvironmentFlipProviderHealthAdapter({}).readFixtureHealth(),
    ).resolves.toBeNull();
    await expect(
      new EnvironmentFlipProviderHealthAdapter({
        DAILYDRAFT_FLIP_PROVIDER_HEALTH_FIXTURE: '{',
      }).readFixtureHealth(),
    ).resolves.toBe(Symbol.for('invalid-flip-provider-health-fixture'));
    await expect(
      readFlipProviderHealth({
        readFixtureHealth: () => Promise.reject(new Error('provider adapter unavailable')),
      }),
    ).resolves.toBe(Symbol.for('invalid-flip-provider-health-fixture'));
  });
});

function decide(overrides: { health?: unknown; pool?: FlipTierAdmissionPool | null } = {}) {
  return evaluateFlipTierAdmission({
    evaluatedAt: NOW,
    pool: overrides.pool === undefined ? fixturePool() : overrides.pool,
    providerHealth: overrides.health === undefined ? CONTRACT.healthy : overrides.health,
    stakeAmount: '50000000',
    stakeCurrency: 'USDC',
    stakeDecimals: 6,
  });
}

function fixturePool(): FlipTierAdmissionPool {
  return structuredClone({
    eligibleOutcomeCount: 3,
    id: 'flipcommit_fixture',
    outcomeSpace: [{ bandLabel: 'base' }, { bandLabel: 'plus' }, { bandLabel: 'chase' }],
    poolCommitmentHash: '1'.repeat(64),
    poolKey: 'flip-pokemon-50',
    rulesHash: '2'.repeat(64),
    rulesVersion: 1,
    ruleset: {
      activation: 'fixture-only',
      bands: [
        { label: 'base', minimumValueAmount: '0', probabilityPpm: 700_000 },
        { label: 'plus', minimumValueAmount: '25000000', probabilityPpm: 250_000 },
        { label: 'chase', minimumValueAmount: '50000000', probabilityPpm: 50_000 },
      ],
      calculatorVersion: FLIP_RULES_CALCULATOR_VERSION,
      currency: 'USDC',
      decimals: 6,
      id: 'fliprules_fixture',
      inventoryPolicyVersion: 'flip-fixture-policy-v1',
      poolKey: 'flip-pokemon-50',
      probabilityScalePpm: FLIP_PROBABILITY_SCALE_PPM,
      rulesHash: '2'.repeat(64),
      schemaVersion: FLIP_RULES_SCHEMA_VERSION,
      sealedAt: new Date('2026-07-28T15:58:00.000Z'),
      stakeAmount: '50000000',
      version: 1,
    },
    sealedAt: new Date('2026-07-28T15:59:00.000Z'),
    sessionReference: 'flip-session',
    snapshot: {
      contentHash: '3'.repeat(64),
      eligibleCount: 3,
      eligibleValueAmount: '110000000',
      evaluatedAt: new Date('2026-07-28T15:59:30.000Z'),
      id: 'flipsnap_fixture',
      maximumEligibleItems: 20,
      maximumExposureAmount: '1000000000',
      maximumFutureSkewMs: 1_000,
      maximumSourceAgeMs: 60_000,
      minimumEligibleItems: 3,
      policyHash: '4'.repeat(64),
      policyVersion: 'flip-fixture-policy-v1',
      poolKey: 'flip-pokemon-50',
      provider: 'fixture-marketplace',
      schemaVersion: 'dailydraft.flip-inventory.v1',
      sealedAt: new Date('2026-07-28T15:59:00.000Z'),
      stakeAmount: '50000000',
      stakeCurrency: 'USDC',
      stakeDecimals: 6,
    },
    snapshotContentHash: '3'.repeat(64),
    snapshotId: 'flipsnap_fixture',
    snapshotRevision: 1,
  } satisfies FlipTierAdmissionPool);
}
