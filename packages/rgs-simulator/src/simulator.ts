import {
  canonicalRgsJson,
  deriveRgsSeededEntropy,
  hashRgsText,
  hashRgsValue,
  type RgsJsonValue,
} from '@dailydraft/contracts/rgs';

import { validateRgsSimulationConfig } from './config.js';
import {
  RGS_SIMULATION_MANIFEST_SCHEMA_VERSION,
  RGS_SIMULATION_MINIMUM_PROMOTION_ROUNDS,
  RGS_SIMULATION_PROBABILITY_SCALE_PPM,
  RGS_SIMULATION_REPORT_SCHEMA_VERSION,
  RGS_SIMULATOR_VERSION,
  type RgsSimulationCheck,
  type RgsSimulationConfig,
  type RgsSimulationDeclaredMetrics,
  type RgsSimulationEvidenceEntry,
  type RgsSimulationEvidenceManifest,
  type RgsSimulationPromotionEvaluation,
  type RgsSimulationRealizedMetrics,
  type RgsSimulationReport,
  type RgsSimulationRun,
  type RgsSimulationVerification,
  type UnsignedRgsSimulationReport,
} from './types.js';

const MAX_ROUNDS = 10_000_000;
const MAX_SEED_LENGTH = 240;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function simulateRgsMathConfig(
  configInput: RgsSimulationConfig,
  runInput: RgsSimulationRun,
): RgsSimulationReport {
  const config = validateRgsSimulationConfig(configInput);
  const run = normalizeRun(runInput);
  const declared = declaredMetrics(config);
  const tierHits = new Map(config.tiers.map((tier) => [tier.key, 0]));
  const stake = BigInt(config.stakeMinor);
  let totalReturnPpm = 0n;
  let totalReturnPpmSquared = 0n;
  let observedMaxPayout = -1n;
  let observedMaxHits = 0;
  let observedMaxOutcomeIds = new Set<string>();

  for (let round = 0; round < run.rounds; round += 1) {
    const clientSeed = hashRgsText(`${run.seed}:client:${round}`);
    const serverSeed = hashRgsText(`${run.seed}:server:${round}`);
    const entropy = deriveRgsSeededEntropy({
      clientSeed,
      configHash: config.configHash,
      rulesHash: config.rulesHash,
      serverSeed,
    });
    const tier = selectTier(config, parseEntropyWord(entropy, 0));
    const payout = tier.payouts[parseEntropyWord(entropy, 8) % tier.payouts.length];
    if (!payout) throw new Error('RGS simulation payout selection failed');
    tierHits.set(tier.key, (tierHits.get(tier.key) ?? 0) + 1);

    const payoutMinor = BigInt(payout.payoutMinor);
    const returnPpm = (payoutMinor * BigInt(RGS_SIMULATION_PROBABILITY_SCALE_PPM)) / stake;
    totalReturnPpm += returnPpm;
    totalReturnPpmSquared += returnPpm * returnPpm;

    if (payoutMinor > observedMaxPayout) {
      observedMaxPayout = payoutMinor;
      observedMaxHits = 1;
      observedMaxOutcomeIds = new Set([payout.id]);
    } else if (payoutMinor === observedMaxPayout) {
      observedMaxHits += 1;
      observedMaxOutcomeIds.add(payout.id);
    }
  }

  const rounds = BigInt(run.rounds);
  const realizedMean = totalReturnPpm / rounds;
  const realizedSecondMoment = totalReturnPpmSquared / rounds;
  const realizedVariance = nonNegative(realizedSecondMoment - realizedMean * realizedMean);
  const realized: RgsSimulationRealizedMetrics = {
    maxExposure: {
      hitRatePpm: ratioPpm(observedMaxHits, run.rounds),
      hits: observedMaxHits,
      netExposureMinor: nonNegative(observedMaxPayout - stake).toString(),
      outcomeIds: [...observedMaxOutcomeIds].sort(),
      payoutMinor: observedMaxPayout.toString(),
    },
    payoutVariancePpmSquared: realizedVariance.toString(),
    rtpPpm: realizedMean.toString(),
    tiers: config.tiers.map((tier) => {
      const hits = tierHits.get(tier.key) ?? 0;
      return {
        hitRatePpm: ratioPpm(hits, run.rounds),
        hits,
        key: tier.key,
      };
    }),
  };
  const checks = evaluateChecks(config, declared, realized);
  const unsigned: UnsignedRgsSimulationReport = {
    checks,
    config: {
      activation: config.activation,
      configHash: config.configHash,
      currency: config.currency,
      decimals: config.decimals,
      mathConfigHash: config.mathConfigHash,
      mode: config.mode,
      realValueGate: 'hitl-required',
      rulesHash: config.rulesHash,
      simulationKey: config.simulationKey,
      stakeMinor: config.stakeMinor,
    },
    declared,
    passed: checks.every((check) => check.passed),
    realized,
    run,
    schemaVersion: RGS_SIMULATION_REPORT_SCHEMA_VERSION,
    simulatorVersion: RGS_SIMULATOR_VERSION,
    tolerances: config.tolerances,
  };
  return deepFreeze({
    ...unsigned,
    reportHash: hashRgsSimulationReport(unsigned),
  });
}

export function hashRgsSimulationReport(report: UnsignedRgsSimulationReport): string {
  return hashRgsValue(report as unknown as RgsJsonValue);
}

export function verifyRgsSimulationReport(
  configInput: RgsSimulationConfig,
  candidate: unknown,
): RgsSimulationVerification {
  const errors: string[] = [];
  try {
    const config = validateRgsSimulationConfig(configInput);
    if (!isRecord(candidate)) throw new Error('RGS simulation report is required');
    const report = candidate as unknown as RgsSimulationReport;
    if (report.schemaVersion !== RGS_SIMULATION_REPORT_SCHEMA_VERSION) {
      errors.push('unsupported report schemaVersion');
    }
    if (report.simulatorVersion !== RGS_SIMULATOR_VERSION) {
      errors.push('unsupported simulatorVersion');
    }
    if (typeof report.reportHash !== 'string' || !HASH_PATTERN.test(report.reportHash)) {
      errors.push('reportHash must be a lowercase SHA-256 hash');
    } else {
      const { reportHash: _reportHash, ...unsigned } = report;
      if (hashRgsSimulationReport(unsigned as UnsignedRgsSimulationReport) !== report.reportHash) {
        errors.push('reportHash mismatch');
      }
    }

    const expected = simulateRgsMathConfig(config, report.run);
    if (
      canonicalRgsJson(expected as unknown as RgsJsonValue) !==
      canonicalRgsJson(candidate as unknown as RgsJsonValue)
    ) {
      errors.push('report does not reproduce from its config, seed, and round count');
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'RGS simulation verification failed');
  }
  return { errors: unique(errors), valid: errors.length === 0 };
}

export function createRgsSimulationEvidenceEntry(input: {
  config: RgsSimulationConfig;
  minimumRounds?: number;
  report: RgsSimulationReport;
  reportPath: string;
}): RgsSimulationEvidenceEntry {
  const config = validateRgsSimulationConfig(input.config);
  const verification = verifyRgsSimulationReport(config, input.report);
  if (!verification.valid || !input.report.passed) {
    throw new Error(
      `RGS simulation report is not passing evidence: ${verification.errors.join('; ')}`,
    );
  }
  const minimumRounds = boundedRounds(
    input.minimumRounds ?? RGS_SIMULATION_MINIMUM_PROMOTION_ROUNDS,
  );
  if (input.report.run.rounds < minimumRounds) {
    throw new Error(
      `RGS simulation report has ${input.report.run.rounds} rounds; ${minimumRounds} required`,
    );
  }
  const reportPath = safeEvidencePath(input.reportPath);
  return deepFreeze({
    activation: config.activation,
    configHash: config.configHash,
    mathConfigHash: config.mathConfigHash,
    minimumRounds,
    mode: config.mode,
    realValueGate: 'hitl-required',
    reportHash: input.report.reportHash,
    reportPath,
    rulesHash: config.rulesHash,
  });
}

export function createRgsSimulationEvidenceManifest(
  entries: readonly RgsSimulationEvidenceEntry[],
): RgsSimulationEvidenceManifest {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('RGS simulation evidence manifest requires at least one entry');
  }
  const keys = new Set<string>();
  const normalized = entries.map((entry) => {
    const key = `${entry.mode}:${entry.mathConfigHash}`;
    if (keys.has(key)) throw new Error(`RGS simulation evidence entry is duplicated: ${key}`);
    keys.add(key);
    if (entry.realValueGate !== 'hitl-required') {
      throw new Error('RGS simulation evidence must preserve the hitl-required gate');
    }
    for (const [field, hash] of [
      ['configHash', entry.configHash],
      ['mathConfigHash', entry.mathConfigHash],
      ['reportHash', entry.reportHash],
      ['rulesHash', entry.rulesHash],
    ] as const) {
      if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)) {
        throw new Error(`${field} must be a lowercase SHA-256 hash`);
      }
    }
    return {
      ...entry,
      minimumRounds: boundedRounds(entry.minimumRounds),
      reportPath: safeEvidencePath(entry.reportPath),
    };
  });
  return deepFreeze({
    entries: normalized,
    schemaVersion: RGS_SIMULATION_MANIFEST_SCHEMA_VERSION,
  });
}

export function evaluateRgsSimulationPromotion(
  configInput: RgsSimulationConfig,
  report: unknown,
  targetActivation: 'devnet',
): RgsSimulationPromotionEvaluation {
  const errors: string[] = [];
  try {
    const config = validateRgsSimulationConfig(configInput);
    if (targetActivation !== 'devnet') errors.push('targetActivation must be devnet');
    const verification = verifyRgsSimulationReport(config, report);
    errors.push(...verification.errors);
    if (isRecord(report)) {
      const candidate = report as unknown as RgsSimulationReport;
      if (!candidate.passed) errors.push('simulation report did not pass its tolerances');
      if (candidate.run?.rounds < RGS_SIMULATION_MINIMUM_PROMOTION_ROUNDS) {
        errors.push(
          `simulation report requires at least ${RGS_SIMULATION_MINIMUM_PROMOTION_ROUNDS} rounds`,
        );
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'promotion evidence failed');
  }
  return {
    errors: unique(errors),
    promotionAuthorized: false,
    realValueGate: 'hitl-required',
    simulationGatePassed: errors.length === 0,
    targetActivation: 'devnet',
  };
}

function declaredMetrics(config: RgsSimulationConfig): RgsSimulationDeclaredMetrics {
  const scale = BigInt(RGS_SIMULATION_PROBABILITY_SCALE_PPM);
  const stake = BigInt(config.stakeMinor);
  let weightedReturnPpm = 0n;
  let weightedReturnPpmSquared = 0n;
  let maximumPayout = -1n;
  const maximumOutcomeIds: string[] = [];
  let maximumProbabilityPpm = 0n;

  for (const tier of config.tiers) {
    const probability = BigInt(tier.probabilityPpm);
    const payoutCount = BigInt(tier.payouts.length);
    let tierReturnPpm = 0n;
    let tierReturnPpmSquared = 0n;
    let tierMaximumCount = 0n;
    for (const payout of tier.payouts) {
      const payoutMinor = BigInt(payout.payoutMinor);
      const returnPpm = (payoutMinor * scale) / stake;
      tierReturnPpm += returnPpm;
      tierReturnPpmSquared += returnPpm * returnPpm;
      if (payoutMinor > maximumPayout) {
        maximumPayout = payoutMinor;
        maximumOutcomeIds.length = 0;
        maximumOutcomeIds.push(payout.id);
        maximumProbabilityPpm = 0n;
        tierMaximumCount = 1n;
      } else if (payoutMinor === maximumPayout) {
        maximumOutcomeIds.push(payout.id);
        tierMaximumCount += 1n;
      }
    }
    weightedReturnPpm += (probability * tierReturnPpm) / payoutCount;
    weightedReturnPpmSquared += (probability * tierReturnPpmSquared) / payoutCount;
    if (tierMaximumCount > 0n) {
      maximumProbabilityPpm += (probability * tierMaximumCount) / payoutCount;
    }
  }

  const mean = weightedReturnPpm / scale;
  const secondMoment = weightedReturnPpmSquared / scale;
  return {
    maxExposure: {
      hitRatePpm: Number(maximumProbabilityPpm),
      netExposureMinor: nonNegative(maximumPayout - stake).toString(),
      outcomeIds: maximumOutcomeIds.sort(),
      payoutMinor: maximumPayout.toString(),
    },
    payoutVariancePpmSquared: nonNegative(secondMoment - mean * mean).toString(),
    rtpPpm: mean.toString(),
    tiers: config.tiers.map((tier) => ({
      hitRatePpm: tier.probabilityPpm,
      key: tier.key,
    })),
  };
}

function evaluateChecks(
  config: RgsSimulationConfig,
  declared: RgsSimulationDeclaredMetrics,
  realized: RgsSimulationRealizedMetrics,
): RgsSimulationCheck[] {
  const checks: RgsSimulationCheck[] = [];
  for (const expected of declared.tiers) {
    const actual = realized.tiers.find((tier) => tier.key === expected.key);
    const realizedHitRate = actual?.hitRatePpm ?? -1;
    checks.push({
      declared: expected.hitRatePpm.toString(),
      name: `tier:${expected.key}:hit-rate-ppm`,
      passed:
        Math.abs(realizedHitRate - expected.hitRatePpm) <= config.tolerances.hitRateAbsolutePpm,
      realized: realizedHitRate.toString(),
      tolerance: config.tolerances.hitRateAbsolutePpm.toString(),
    });
  }

  checks.push(
    relativeCheck(
      'rtp-ppm',
      BigInt(declared.rtpPpm),
      BigInt(realized.rtpPpm),
      config.tolerances.rtpRelativePpm,
    ),
    relativeCheck(
      'payout-variance-ppm-squared',
      BigInt(declared.payoutVariancePpmSquared),
      BigInt(realized.payoutVariancePpmSquared),
      config.tolerances.varianceRelativePpm,
    ),
    {
      declared: canonicalRgsJson(declared.maxExposure as unknown as RgsJsonValue),
      name: 'max-exposure-profile',
      passed:
        realized.maxExposure.hits > 0 &&
        realized.maxExposure.payoutMinor === declared.maxExposure.payoutMinor &&
        realized.maxExposure.netExposureMinor === declared.maxExposure.netExposureMinor &&
        canonicalRgsJson(realized.maxExposure.outcomeIds) ===
          canonicalRgsJson(declared.maxExposure.outcomeIds),
      realized: canonicalRgsJson(realized.maxExposure as unknown as RgsJsonValue),
      tolerance: 'exact payout, net exposure, and outcome ids; at least one observation',
    },
  );
  return checks;
}

function relativeCheck(
  name: string,
  declared: bigint,
  realized: bigint,
  relativeTolerancePpm: number,
): RgsSimulationCheck {
  const tolerance = maximum(
    1n,
    (absolute(declared) * BigInt(relativeTolerancePpm)) /
      BigInt(RGS_SIMULATION_PROBABILITY_SCALE_PPM),
  );
  return {
    declared: declared.toString(),
    name,
    passed: absolute(realized - declared) <= tolerance,
    realized: realized.toString(),
    tolerance: tolerance.toString(),
  };
}

function selectTier(config: RgsSimulationConfig, entropyWord: number) {
  const roll = entropyWord % RGS_SIMULATION_PROBABILITY_SCALE_PPM;
  let upperBound = 0;
  for (const tier of config.tiers) {
    upperBound += tier.probabilityPpm;
    if (roll < upperBound) return tier;
  }
  throw new Error('RGS simulation tiers do not cover the deterministic roll');
}

function parseEntropyWord(entropy: string, offset: number): number {
  return Number.parseInt(entropy.slice(offset, offset + 8), 16);
}

function normalizeRun(input: RgsSimulationRun): RgsSimulationRun {
  if (!isRecord(input)) throw new Error('RGS simulation run is required');
  const rounds = boundedRounds(input.rounds, 1);
  if (
    typeof input.seed !== 'string' ||
    input.seed.length === 0 ||
    input.seed.length > MAX_SEED_LENGTH ||
    input.seed.trim() !== input.seed ||
    hasControlCharacter(input.seed)
  ) {
    throw new Error(`RGS simulation seed must contain 1-${MAX_SEED_LENGTH} canonical characters`);
  }
  return deepFreeze({ rounds, seed: input.seed });
}

function boundedRounds(value: number, minimum = 1): number {
  if (!Number.isInteger(value) || value < minimum || value > MAX_ROUNDS) {
    throw new Error(`rounds must be between ${minimum} and ${MAX_ROUNDS}`);
  }
  return value;
}

function safeEvidencePath(value: string): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('evidence/rgs-simulation/') ||
    value.includes('..') ||
    !value.endsWith('.json')
  ) {
    throw new Error('reportPath must be a JSON file under evidence/rgs-simulation/');
  }
  return value;
}

function ratioPpm(numerator: number, denominator: number): number {
  return Number(
    (BigInt(numerator) * BigInt(RGS_SIMULATION_PROBABILITY_SCALE_PPM)) / BigInt(denominator),
  );
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function nonNegative(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function maximum(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
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
