import { createHash } from 'node:crypto';

import { stableStringify } from '../providers/valuation-policy.js';
import {
  FLIP_PROBABILITY_SCALE_PPM,
  FLIP_RULES_CALCULATOR_VERSION,
  FLIP_RULES_SCHEMA_VERSION,
  type FlipOutcomeBand,
} from './flip-rules.service.js';

export const FLIP_PROVIDER_HEALTH_SCHEMA_VERSION =
  'dailydraft.flip-provider-health-fixture.v1' as const;
export const FLIP_PROVIDER_HEALTH_ADAPTER = Symbol('FLIP_PROVIDER_HEALTH_ADAPTER');
export const FLIP_TIER_ADMISSION_POLICY_VERSION = 'dailydraft.flip-tier-admission.v1' as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const HEALTH_KEYS = ['observedAt', 'poolKey', 'provider', 'schemaVersion', 'status'] as const;

export type FlipTierSuspensionReason =
  | 'configuration_invalid'
  | 'inventory_degraded'
  | 'inventory_stale'
  | 'provider_health_missing'
  | 'provider_health_stale'
  | 'provider_outage';

export type FlipTierReenableBoundary =
  | 'configuration_change'
  | 'fresh_inventory_snapshot'
  | 'fresh_provider_health'
  | 'reviewed_pool_recovery';

export const FLIP_TIER_REENABLE_BOUNDARIES: Record<
  FlipTierSuspensionReason,
  FlipTierReenableBoundary
> = {
  configuration_invalid: 'configuration_change',
  inventory_degraded: 'reviewed_pool_recovery',
  inventory_stale: 'fresh_inventory_snapshot',
  provider_health_missing: 'fresh_provider_health',
  provider_health_stale: 'fresh_provider_health',
  provider_outage: 'fresh_provider_health',
};

export interface FlipProviderHealthFixture {
  observedAt: string;
  poolKey: string;
  provider: string;
  schemaVersion: typeof FLIP_PROVIDER_HEALTH_SCHEMA_VERSION;
  status: 'healthy' | 'outage';
}

export interface FlipTierAdmissionPool {
  eligibleOutcomeCount: number;
  id: string;
  outcomeSpace: unknown;
  poolCommitmentHash: string;
  poolKey: string;
  rulesHash: string;
  rulesVersion: number;
  ruleset: {
    activation: string;
    bands: unknown;
    calculatorVersion: string;
    currency: string;
    decimals: number;
    id: string;
    inventoryPolicyVersion: string;
    poolKey: string;
    probabilityScalePpm: number;
    rulesHash: string;
    schemaVersion: string;
    sealedAt: Date | null;
    stakeAmount: string;
    version: number;
  };
  sealedAt: Date | null;
  sessionReference: string;
  snapshot: {
    contentHash: string;
    eligibleCount: number;
    eligibleValueAmount: string;
    evaluatedAt: Date;
    id: string;
    maximumEligibleItems: number;
    maximumExposureAmount: string;
    maximumFutureSkewMs: number;
    maximumSourceAgeMs: number;
    minimumEligibleItems: number;
    policyHash: string;
    policyVersion: string;
    poolKey: string;
    provider: string;
    schemaVersion: string;
    sealedAt: Date | null;
    stakeAmount: string;
    stakeCurrency: string;
    stakeDecimals: number;
  };
  snapshotContentHash: string;
  snapshotId: string;
  snapshotRevision: number;
}

export interface FlipTierAdmissionDecision {
  allowed: boolean;
  evaluatedAt: Date;
  policyHash: string;
  providerHealth: FlipProviderHealthFixture | null;
  providerHealthHash: string | null;
  reason: FlipTierSuspensionReason | null;
  reenableBoundary: FlipTierReenableBoundary | null;
  tierKey: string;
}

export interface FlipProviderHealthAdapter {
  readFixtureHealth(): Promise<unknown>;
}

export class EnvironmentFlipProviderHealthAdapter implements FlipProviderHealthAdapter {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}

  async readFixtureHealth(): Promise<unknown> {
    const value = this.environment.DAILYDRAFT_FLIP_PROVIDER_HEALTH_FIXTURE;
    if (!value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return Symbol.for('invalid-flip-provider-health-fixture');
    }
  }
}

export function evaluateFlipTierAdmission(input: {
  evaluatedAt: Date;
  pool: FlipTierAdmissionPool | null;
  providerHealth: unknown;
  stakeAmount: string;
  stakeCurrency: string;
  stakeDecimals: number;
}): FlipTierAdmissionDecision {
  const evaluatedAt = validDate(input.evaluatedAt) ?? new Date(0);
  const tierKey = flipTierKey(input.stakeAmount, input.stakeCurrency, input.stakeDecimals);
  const configuration = validateConfiguration(input, evaluatedAt);
  if (!configuration.valid) {
    return denied(configuration.reason, evaluatedAt, tierKey, configuration.policyHash, null);
  }

  const { pool, policyHash } = configuration;
  const snapshotAge = evaluatedAt.getTime() - pool.snapshot.evaluatedAt.getTime();
  if (
    snapshotAge > pool.snapshot.maximumSourceAgeMs ||
    snapshotAge < -pool.snapshot.maximumFutureSkewMs
  ) {
    return denied('inventory_stale', evaluatedAt, tierKey, policyHash, null);
  }
  if (!poolQualityMeetsReviewedThresholds(pool)) {
    return denied('inventory_degraded', evaluatedAt, tierKey, policyHash, null);
  }

  const health = validateProviderHealth(input.providerHealth);
  if (health.kind === 'missing') {
    return denied('provider_health_missing', evaluatedAt, tierKey, policyHash, null);
  }
  if (health.kind === 'invalid') {
    return denied('configuration_invalid', evaluatedAt, tierKey, policyHash, null);
  }
  const providerHealthHash = sha256(health.value);
  if (health.value.provider !== pool.snapshot.provider || health.value.poolKey !== pool.poolKey) {
    return denied(
      'configuration_invalid',
      evaluatedAt,
      tierKey,
      policyHash,
      health.value,
      providerHealthHash,
    );
  }
  if (health.value.status === 'outage') {
    return denied(
      'provider_outage',
      evaluatedAt,
      tierKey,
      policyHash,
      health.value,
      providerHealthHash,
    );
  }
  const healthAt = new Date(health.value.observedAt);
  const healthAge = evaluatedAt.getTime() - healthAt.getTime();
  if (
    healthAge > pool.snapshot.maximumSourceAgeMs ||
    healthAge < -pool.snapshot.maximumFutureSkewMs
  ) {
    return denied(
      'provider_health_stale',
      evaluatedAt,
      tierKey,
      policyHash,
      health.value,
      providerHealthHash,
    );
  }

  return Object.freeze({
    allowed: true,
    evaluatedAt,
    policyHash,
    providerHealth: health.value,
    providerHealthHash,
    reason: null,
    reenableBoundary: null,
    tierKey,
  });
}

export function flipTierKey(amount: string, currency: string, decimals: number): string {
  return `${currency}:${decimals}:${amount}`;
}

function validateConfiguration(
  input: Parameters<typeof evaluateFlipTierAdmission>[0],
  evaluatedAt: Date,
):
  | { policyHash: string; reason: 'configuration_invalid'; valid: false }
  | { policyHash: string; pool: FlipTierAdmissionPool; valid: true } {
  const pool = input.pool;
  const fallbackHash = sha256({
    policyVersion: FLIP_TIER_ADMISSION_POLICY_VERSION,
    tierKey: flipTierKey(input.stakeAmount, input.stakeCurrency, input.stakeDecimals),
  });
  if (
    !pool?.sealedAt ||
    !pool.ruleset.sealedAt ||
    !pool.snapshot.sealedAt ||
    !validDate(pool.snapshot.evaluatedAt) ||
    !KEY_PATTERN.test(pool.poolKey) ||
    !KEY_PATTERN.test(pool.snapshot.provider) ||
    !HASH_PATTERN.test(pool.poolCommitmentHash) ||
    !HASH_PATTERN.test(pool.rulesHash) ||
    !HASH_PATTERN.test(pool.snapshotContentHash) ||
    !HASH_PATTERN.test(pool.snapshot.policyHash) ||
    pool.ruleset.activation !== 'fixture-only' ||
    pool.ruleset.schemaVersion !== FLIP_RULES_SCHEMA_VERSION ||
    pool.ruleset.calculatorVersion !== FLIP_RULES_CALCULATOR_VERSION ||
    pool.ruleset.probabilityScalePpm !== FLIP_PROBABILITY_SCALE_PPM ||
    pool.ruleset.currency !== 'USDC' ||
    pool.ruleset.decimals !== 6 ||
    pool.snapshot.schemaVersion !== 'dailydraft.flip-inventory.v1' ||
    pool.snapshot.stakeCurrency !== 'USDC' ||
    pool.snapshot.stakeDecimals !== 6 ||
    pool.sessionReference.length === 0 ||
    pool.poolKey !== pool.ruleset.poolKey ||
    pool.poolKey !== pool.snapshot.poolKey ||
    pool.rulesHash !== pool.ruleset.rulesHash ||
    pool.rulesVersion !== pool.ruleset.version ||
    pool.snapshotContentHash !== pool.snapshot.contentHash ||
    pool.snapshotId !== pool.snapshot.id ||
    pool.ruleset.inventoryPolicyVersion !== pool.snapshot.policyVersion ||
    input.stakeAmount !== pool.ruleset.stakeAmount ||
    input.stakeAmount !== pool.snapshot.stakeAmount ||
    input.stakeCurrency !== pool.ruleset.currency ||
    input.stakeDecimals !== pool.ruleset.decimals ||
    !validUnsigned(input.stakeAmount) ||
    BigInt(input.stakeAmount) === 0n ||
    !validThreshold(pool.snapshot.minimumEligibleItems, 1, 500) ||
    !validThreshold(pool.snapshot.maximumEligibleItems, pool.snapshot.minimumEligibleItems, 500) ||
    !validThreshold(pool.snapshot.maximumSourceAgeMs, 1, 30 * 24 * 60 * 60 * 1_000) ||
    !validThreshold(pool.snapshot.maximumFutureSkewMs, 0, 60_000) ||
    !validThreshold(pool.snapshotRevision, 1, 2_147_483_647) ||
    !validThreshold(pool.snapshot.eligibleCount, 1, 500) ||
    !validUnsigned(pool.snapshot.maximumExposureAmount) ||
    !validUnsigned(pool.snapshot.eligibleValueAmount) ||
    !validBands(pool.ruleset.bands) ||
    !Array.isArray(pool.outcomeSpace)
  ) {
    return { policyHash: fallbackHash, reason: 'configuration_invalid', valid: false };
  }
  const policyHash = sha256({
    inventoryPolicyHash: pool.snapshot.policyHash,
    maximumEligibleItems: pool.snapshot.maximumEligibleItems,
    maximumExposureAmount: pool.snapshot.maximumExposureAmount,
    maximumFutureSkewMs: pool.snapshot.maximumFutureSkewMs,
    maximumSourceAgeMs: pool.snapshot.maximumSourceAgeMs,
    minimumEligibleItems: pool.snapshot.minimumEligibleItems,
    policyVersion: FLIP_TIER_ADMISSION_POLICY_VERSION,
    poolCommitmentHash: pool.poolCommitmentHash,
    rulesHash: pool.rulesHash,
    snapshotContentHash: pool.snapshotContentHash,
    tierKey: flipTierKey(input.stakeAmount, input.stakeCurrency, input.stakeDecimals),
  });
  if (evaluatedAt.getTime() === 0) {
    return { policyHash, reason: 'configuration_invalid', valid: false };
  }
  return { policyHash, pool, valid: true };
}

function poolQualityMeetsReviewedThresholds(pool: FlipTierAdmissionPool): boolean {
  if (!Array.isArray(pool.outcomeSpace)) return false;
  if (
    !Number.isInteger(pool.eligibleOutcomeCount) ||
    pool.eligibleOutcomeCount !== pool.snapshot.eligibleCount ||
    pool.eligibleOutcomeCount < pool.snapshot.minimumEligibleItems ||
    pool.eligibleOutcomeCount > pool.snapshot.maximumEligibleItems ||
    BigInt(pool.snapshot.eligibleValueAmount) > BigInt(pool.snapshot.maximumExposureAmount)
  ) {
    return false;
  }
  const bands = pool.ruleset.bands as FlipOutcomeBand[];
  const represented = new Set<string>();
  for (const value of pool.outcomeSpace) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof (value as { bandLabel?: unknown }).bandLabel !== 'string'
    ) {
      return false;
    }
    represented.add((value as { bandLabel: string }).bandLabel);
  }
  return bands.every(
    (band) =>
      band &&
      typeof band.label === 'string' &&
      Number.isInteger(band.probabilityPpm) &&
      band.probabilityPpm > 0 &&
      represented.has(band.label),
  );
}

function validBands(value: unknown): value is FlipOutcomeBand[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const labels = new Set<string>();
  let previousMinimum = -1n;
  let probabilityTotal = 0;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const band = candidate as Partial<FlipOutcomeBand>;
    if (
      typeof band.label !== 'string' ||
      !KEY_PATTERN.test(band.label) ||
      labels.has(band.label) ||
      typeof band.minimumValueAmount !== 'string' ||
      !validUnsigned(band.minimumValueAmount) ||
      !Number.isInteger(band.probabilityPpm) ||
      (band.probabilityPpm ?? 0) < 1
    ) {
      return false;
    }
    const minimum = BigInt(band.minimumValueAmount);
    if (minimum <= previousMinimum) return false;
    labels.add(band.label);
    previousMinimum = minimum;
    probabilityTotal += band.probabilityPpm ?? 0;
  }
  return (
    (value[0] as FlipOutcomeBand).minimumValueAmount === '0' &&
    probabilityTotal === FLIP_PROBABILITY_SCALE_PPM
  );
}

function validateProviderHealth(
  value: unknown,
): { kind: 'invalid' } | { kind: 'missing' } | { kind: 'valid'; value: FlipProviderHealthFixture } {
  if (value === null || value === undefined) return { kind: 'missing' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  if (!hasExactKeys(value, HEALTH_KEYS)) return { kind: 'invalid' };
  const health = value as Partial<FlipProviderHealthFixture>;
  if (
    health.schemaVersion !== FLIP_PROVIDER_HEALTH_SCHEMA_VERSION ||
    (health.status !== 'healthy' && health.status !== 'outage') ||
    typeof health.poolKey !== 'string' ||
    !KEY_PATTERN.test(health.poolKey) ||
    typeof health.provider !== 'string' ||
    !KEY_PATTERN.test(health.provider) ||
    typeof health.observedAt !== 'string' ||
    !validDate(new Date(health.observedAt))
  ) {
    return { kind: 'invalid' };
  }
  return {
    kind: 'valid',
    value: Object.freeze({
      observedAt: new Date(health.observedAt).toISOString(),
      poolKey: health.poolKey,
      provider: health.provider,
      schemaVersion: FLIP_PROVIDER_HEALTH_SCHEMA_VERSION,
      status: health.status,
    }),
  };
}

function denied(
  reason: FlipTierSuspensionReason,
  evaluatedAt: Date,
  tierKey: string,
  policyHash: string,
  providerHealth: FlipProviderHealthFixture | null,
  providerHealthHash: string | null = providerHealth ? sha256(providerHealth) : null,
): FlipTierAdmissionDecision {
  return Object.freeze({
    allowed: false,
    evaluatedAt,
    policyHash,
    providerHealth,
    providerHealthHash,
    reason,
    reenableBoundary: FLIP_TIER_REENABLE_BOUNDARIES[reason],
    tierKey,
  });
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validDate(value: Date): Date | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

function validThreshold(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validUnsigned(value: string): boolean {
  return UNSIGNED_INTEGER_PATTERN.test(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
