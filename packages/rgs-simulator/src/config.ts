import { hashRgsValue, type RgsJsonValue } from '@dailydraft/contracts/rgs';

import {
  RGS_SIMULATION_CONFIG_SCHEMA_VERSION,
  RGS_SIMULATION_PROBABILITY_SCALE_PPM,
  RGS_SIMULATOR_VERSION,
  type RgsSimulationConfig,
  type RgsSimulationPayout,
  type RgsSimulationTier,
  type RgsSimulationTolerances,
  type UnsignedRgsSimulationConfig,
} from './types.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const CURRENCY_PATTERN = /^[A-Z0-9]{2,12}$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const MAX_U64 = 18_446_744_073_709_551_615n;

export function createRgsSimulationConfig(input: UnsignedRgsSimulationConfig): RgsSimulationConfig {
  const unsigned = normalizeUnsignedConfig(input);
  return deepFreeze({
    ...unsigned,
    mathConfigHash: hashRgsValue(unsigned as unknown as RgsJsonValue),
  });
}

export function validateRgsSimulationConfig(value: unknown): RgsSimulationConfig {
  if (!isRecord(value)) throw new Error('RGS simulation config is required');
  const candidate = value as unknown as RgsSimulationConfig;
  if (
    typeof candidate.mathConfigHash !== 'string' ||
    !HASH_PATTERN.test(candidate.mathConfigHash)
  ) {
    throw new Error('mathConfigHash must be a lowercase SHA-256 hash');
  }
  const canonical = createRgsSimulationConfig(candidate);
  if (canonical.mathConfigHash !== candidate.mathConfigHash) {
    throw new Error('RGS simulation config does not match mathConfigHash');
  }
  return canonical;
}

function normalizeUnsignedConfig(input: UnsignedRgsSimulationConfig): UnsignedRgsSimulationConfig {
  if (!isRecord(input)) throw new Error('RGS simulation config is required');
  if (input.schemaVersion !== RGS_SIMULATION_CONFIG_SCHEMA_VERSION) {
    throw new Error('RGS simulation config schemaVersion is unsupported');
  }
  if (input.simulatorVersion !== RGS_SIMULATOR_VERSION) {
    throw new Error('RGS simulation simulatorVersion is unsupported');
  }
  if (!['crash', 'duel', 'flip', 'gacha'].includes(input.mode)) {
    throw new Error('RGS simulation mode is unsupported');
  }
  if (!['devnet', 'disabled', 'fixture-only'].includes(input.activation)) {
    throw new Error('RGS simulation activation is unsupported');
  }
  if (input.realValueGate !== 'hitl-required') {
    throw new Error('RGS simulation must preserve the hitl-required real-value gate');
  }
  assertHash(input.configHash, 'configHash');
  assertHash(input.rulesHash, 'rulesHash');
  assertIdentifier(input.simulationKey, 'simulationKey');
  if (!CURRENCY_PATTERN.test(input.currency)) {
    throw new Error('currency must be a canonical uppercase asset code');
  }
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 18) {
    throw new Error('decimals must be an integer between 0 and 18');
  }
  if (input.probabilityScalePpm !== RGS_SIMULATION_PROBABILITY_SCALE_PPM) {
    throw new Error(`probabilityScalePpm must be ${RGS_SIMULATION_PROBABILITY_SCALE_PPM}`);
  }
  const stakeMinor = parseMinorUnits(input.stakeMinor, 'stakeMinor');
  if (stakeMinor === 0n) throw new Error('stakeMinor must be positive');

  if (!Array.isArray(input.tiers) || input.tiers.length === 0 || input.tiers.length > 128) {
    throw new Error('RGS simulation requires between 1 and 128 tiers');
  }
  const tierKeys = new Set<string>();
  const payoutIds = new Set<string>();
  let probabilityTotal = 0;
  const tiers = input.tiers.map((tier) => {
    const normalized = normalizeTier(tier, tierKeys, payoutIds);
    probabilityTotal += normalized.probabilityPpm;
    return normalized;
  });
  if (probabilityTotal !== RGS_SIMULATION_PROBABILITY_SCALE_PPM) {
    throw new Error(
      `RGS simulation tier probabilities must total ${RGS_SIMULATION_PROBABILITY_SCALE_PPM} PPM`,
    );
  }

  return deepFreeze({
    activation: input.activation,
    configHash: input.configHash,
    currency: input.currency,
    decimals: input.decimals,
    mode: input.mode,
    probabilityScalePpm: RGS_SIMULATION_PROBABILITY_SCALE_PPM,
    realValueGate: 'hitl-required',
    rulesHash: input.rulesHash,
    schemaVersion: RGS_SIMULATION_CONFIG_SCHEMA_VERSION,
    simulationKey: input.simulationKey,
    simulatorVersion: RGS_SIMULATOR_VERSION,
    stakeMinor: stakeMinor.toString(),
    tiers,
    tolerances: normalizeTolerances(input.tolerances),
  });
}

function normalizeTier(
  tier: RgsSimulationTier,
  tierKeys: Set<string>,
  payoutIds: Set<string>,
): RgsSimulationTier {
  if (!isRecord(tier)) throw new Error('RGS simulation tier is invalid');
  assertIdentifier(tier.key, 'tier.key');
  if (tierKeys.has(tier.key)) throw new Error(`RGS simulation tier key is duplicated: ${tier.key}`);
  tierKeys.add(tier.key);
  if (
    !Number.isInteger(tier.probabilityPpm) ||
    tier.probabilityPpm <= 0 ||
    tier.probabilityPpm > RGS_SIMULATION_PROBABILITY_SCALE_PPM
  ) {
    throw new Error('tier.probabilityPpm must be a positive integer within the PPM scale');
  }
  if (!Array.isArray(tier.payouts) || tier.payouts.length === 0 || tier.payouts.length > 1_000) {
    throw new Error('RGS simulation tier requires between 1 and 1000 payouts');
  }
  const payouts = tier.payouts.map((payout) => normalizePayout(payout, payoutIds));
  return deepFreeze({
    key: tier.key,
    payouts,
    probabilityPpm: tier.probabilityPpm,
  });
}

function normalizePayout(payout: RgsSimulationPayout, payoutIds: Set<string>): RgsSimulationPayout {
  if (!isRecord(payout)) throw new Error('RGS simulation payout is invalid');
  assertIdentifier(payout.id, 'payout.id');
  if (payoutIds.has(payout.id)) {
    throw new Error(`RGS simulation payout id is duplicated: ${payout.id}`);
  }
  payoutIds.add(payout.id);
  return deepFreeze({
    id: payout.id,
    payoutMinor: parseMinorUnits(payout.payoutMinor, 'payout.payoutMinor').toString(),
  });
}

function normalizeTolerances(tolerances: RgsSimulationTolerances): RgsSimulationTolerances {
  if (!isRecord(tolerances)) throw new Error('RGS simulation tolerances are required');
  return deepFreeze({
    hitRateAbsolutePpm: boundedInteger(
      tolerances.hitRateAbsolutePpm,
      'hitRateAbsolutePpm',
      1,
      100_000,
    ),
    rtpRelativePpm: boundedInteger(tolerances.rtpRelativePpm, 'rtpRelativePpm', 1, 1_000_000),
    varianceRelativePpm: boundedInteger(
      tolerances.varianceRelativePpm,
      'varianceRelativePpm',
      1,
      1_000_000,
    ),
  });
}

function assertHash(value: string, field: string): void {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 hash`);
  }
}

function assertIdentifier(value: string, field: string): void {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${field} must be a canonical versioned identifier`);
  }
}

function parseMinorUnits(value: string, field: string): bigint {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER_PATTERN.test(value)) {
    throw new Error(`${field} must be canonical unsigned minor units`);
  }
  const amount = BigInt(value);
  if (amount > MAX_U64) throw new Error(`${field} exceeds the u64 limit`);
  return amount;
}

function boundedInteger(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
