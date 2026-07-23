import { createHash } from 'node:crypto';

import type { Money } from '../domain.js';
import { stableStringify } from '../providers/valuation-policy.js';

export const CRASH_CALCULATOR_VERSION = 'openpacksduel.crash-calculators.v1' as const;
export const CRASH_RULES_SCHEMA_VERSION = 'openpacksduel.crash-rules.v1' as const;

const BPS_SCALE = 10_000n;
const MAX_POT_CONTRIBUTION_BPS = 1_000_000;
const PPM_SCALE = 1_000_000;
const MAX_RULE_STAGES = 64;
const MAX_U64 = 18_446_744_073_709_551_615n;
const RULES_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RULES_VERSION_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;

export type CrashCalculatorErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_RULES'
  | 'POT_LIMIT_EXCEEDED'
  | 'RULES_HASH_MISMATCH'
  | 'STAGE_NOT_CONFIGURED'
  | 'UNSUPPORTED_RULES';

export class CrashCalculatorContractError extends Error {
  constructor(
    readonly code: CrashCalculatorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CrashCalculatorContractError';
  }
}

export interface CrashStageRule {
  bustThresholdPpm: number;
  maxPotAmount: string;
  potContributionBps: number;
  stage: number;
}

export interface UnsignedCrashCalculatorRuleSet {
  activation: 'fixture-only';
  calculatorVersion: typeof CRASH_CALCULATOR_VERSION;
  constraints: {
    bustThresholdPpm: 'nondecreasing';
    maxPotAmount: 'nondecreasing';
    potContributionBps: 'nondecreasing';
  };
  currency: 'USDC';
  decimals: 6;
  rounding: 'floor';
  rulesVersion: string;
  schemaVersion: typeof CRASH_RULES_SCHEMA_VERSION;
  stages: readonly CrashStageRule[];
}

export interface CrashCalculatorRuleSet extends UnsignedCrashCalculatorRuleSet {
  rulesHash: string;
}

export interface CrashPotCalculationInput {
  currentPot: Money;
  stage: number;
  stageValue: Money;
}

export interface CrashPotCalculation {
  calculationHash: string;
  calculatorVersion: typeof CRASH_CALCULATOR_VERSION;
  currentPot: Money;
  maxPot: Money;
  nextPot: Money;
  potContributionBps: number;
  rounding: 'floor';
  roundingDenominator: '10000';
  roundingRemainderNumerator: string;
  rulesHash: string;
  rulesVersion: string;
  stage: number;
  stageValue: Money;
  valueChange: Money;
}

export interface CrashBustCalculationInput {
  rollPpm: number;
  stage: number;
}

export interface CrashBustCalculation {
  bustThresholdPpm: number;
  busted: boolean;
  calculationHash: string;
  calculatorVersion: typeof CRASH_CALCULATOR_VERSION;
  comparison: 'roll-lt-threshold';
  probabilityScalePpm: typeof PPM_SCALE;
  rollPpm: number;
  rulesHash: string;
  rulesVersion: string;
  stage: number;
}

export function hashCrashCalculatorRuleSet(rules: UnsignedCrashCalculatorRuleSet): string {
  return sha256(stableStringify(rules));
}

export function validateCrashCalculatorRuleSet(value: unknown): CrashCalculatorRuleSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError('UNSUPPORTED_RULES', 'Crash calculator rules are required');
  }

  const rules = value as Partial<CrashCalculatorRuleSet>;
  if (
    rules.schemaVersion !== CRASH_RULES_SCHEMA_VERSION ||
    rules.calculatorVersion !== CRASH_CALCULATOR_VERSION ||
    rules.activation !== 'fixture-only'
  ) {
    throw contractError(
      'UNSUPPORTED_RULES',
      'Crash calculator rules use an unsupported schema, calculator, or activation mode',
    );
  }
  if (
    rules.currency !== 'USDC' ||
    rules.decimals !== 6 ||
    rules.rounding !== 'floor' ||
    !rules.constraints ||
    rules.constraints.bustThresholdPpm !== 'nondecreasing' ||
    rules.constraints.maxPotAmount !== 'nondecreasing' ||
    rules.constraints.potContributionBps !== 'nondecreasing'
  ) {
    throw contractError('INVALID_RULES', 'Crash calculator rules have invalid numeric semantics');
  }
  if (typeof rules.rulesVersion !== 'string' || !RULES_VERSION_PATTERN.test(rules.rulesVersion)) {
    throw contractError('INVALID_RULES', 'Crash calculator rulesVersion is invalid');
  }
  if (typeof rules.rulesHash !== 'string' || !RULES_HASH_PATTERN.test(rules.rulesHash)) {
    throw contractError('RULES_HASH_MISMATCH', 'Crash calculator rulesHash is invalid');
  }
  if (
    !Array.isArray(rules.stages) ||
    rules.stages.length === 0 ||
    rules.stages.length > MAX_RULE_STAGES
  ) {
    throw contractError('INVALID_RULES', 'Crash calculator rules require a bounded stage list');
  }

  const stages: CrashStageRule[] = [];
  let previousBustThreshold = -1;
  let previousContributionBps = -1;
  let previousMaxPot = -1n;

  for (const [index, candidate] of rules.stages.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw contractError('INVALID_RULES', 'Crash calculator stage rule is invalid');
    }
    const stage = candidate as Partial<CrashStageRule>;
    if (stage.stage !== index + 1) {
      throw contractError(
        'INVALID_RULES',
        'Crash calculator stages must be unique, contiguous, and one-indexed',
      );
    }
    if (
      !Number.isInteger(stage.potContributionBps) ||
      stage.potContributionBps === undefined ||
      Object.is(stage.potContributionBps, -0) ||
      stage.potContributionBps < 0 ||
      stage.potContributionBps > MAX_POT_CONTRIBUTION_BPS
    ) {
      throw contractError('INVALID_RULES', 'Crash pot contribution basis points are invalid');
    }
    if (
      !Number.isInteger(stage.bustThresholdPpm) ||
      stage.bustThresholdPpm === undefined ||
      Object.is(stage.bustThresholdPpm, -0) ||
      stage.bustThresholdPpm < 0 ||
      stage.bustThresholdPpm > PPM_SCALE
    ) {
      throw contractError('INVALID_RULES', 'Crash bust threshold PPM is invalid');
    }
    const maxPot = parseUnsignedAmount(stage.maxPotAmount, 'stage max pot', 'INVALID_RULES');
    if (maxPot <= 0n) {
      throw contractError('INVALID_RULES', 'Crash stage max pot must be positive');
    }
    if (
      stage.potContributionBps < previousContributionBps ||
      stage.bustThresholdPpm < previousBustThreshold ||
      maxPot < previousMaxPot
    ) {
      throw contractError(
        'INVALID_RULES',
        'Crash stage rules violate their declared nondecreasing constraints',
      );
    }

    stages.push(
      Object.freeze({
        bustThresholdPpm: stage.bustThresholdPpm,
        maxPotAmount: maxPot.toString(),
        potContributionBps: stage.potContributionBps,
        stage: stage.stage,
      }),
    );
    previousBustThreshold = stage.bustThresholdPpm;
    previousContributionBps = stage.potContributionBps;
    previousMaxPot = maxPot;
  }

  const unsignedRules: UnsignedCrashCalculatorRuleSet = {
    activation: 'fixture-only',
    calculatorVersion: CRASH_CALCULATOR_VERSION,
    constraints: Object.freeze({
      bustThresholdPpm: 'nondecreasing',
      maxPotAmount: 'nondecreasing',
      potContributionBps: 'nondecreasing',
    }),
    currency: 'USDC',
    decimals: 6,
    rounding: 'floor',
    rulesVersion: rules.rulesVersion,
    schemaVersion: CRASH_RULES_SCHEMA_VERSION,
    stages: Object.freeze(stages),
  };
  const calculatedHash = hashCrashCalculatorRuleSet(unsignedRules);
  if (calculatedHash !== rules.rulesHash) {
    throw contractError(
      'RULES_HASH_MISMATCH',
      'Crash calculator rules do not match their committed hash',
    );
  }

  return Object.freeze({ ...unsignedRules, rulesHash: calculatedHash });
}

export function calculateCrashPot(
  rulesInput: unknown,
  input: CrashPotCalculationInput,
): CrashPotCalculation {
  const rules = validateCrashCalculatorRuleSet(rulesInput);
  const stageRule = requireStage(rules, input.stage);
  const currentPotAmount = parseMoney(input.currentPot, rules, 'current pot');
  const stageValueAmount = parseMoney(input.stageValue, rules, 'stage value');
  const unroundedValueChange = stageValueAmount * BigInt(stageRule.potContributionBps);
  const valueChangeAmount = unroundedValueChange / BPS_SCALE;
  const roundingRemainder = unroundedValueChange % BPS_SCALE;
  const nextPotAmount = currentPotAmount + valueChangeAmount;
  const maxPotAmount = BigInt(stageRule.maxPotAmount);

  if (nextPotAmount > MAX_U64 || nextPotAmount > maxPotAmount) {
    throw contractError(
      'POT_LIMIT_EXCEEDED',
      'Crash pot calculation exceeds the configured stage or u64 limit',
    );
  }

  const canonical = {
    calculatorVersion: CRASH_CALCULATOR_VERSION,
    currentPot: money(currentPotAmount),
    maxPot: money(maxPotAmount),
    nextPot: money(nextPotAmount),
    potContributionBps: stageRule.potContributionBps,
    rounding: 'floor' as const,
    roundingDenominator: BPS_SCALE.toString() as '10000',
    roundingRemainderNumerator: roundingRemainder.toString(),
    rulesHash: rules.rulesHash,
    rulesVersion: rules.rulesVersion,
    stage: stageRule.stage,
    stageValue: money(stageValueAmount),
    valueChange: money(valueChangeAmount),
  };

  return Object.freeze({
    ...canonical,
    calculationHash: sha256(stableStringify(canonical)),
  });
}

export function calculateCrashBust(
  rulesInput: unknown,
  input: CrashBustCalculationInput,
): CrashBustCalculation {
  const rules = validateCrashCalculatorRuleSet(rulesInput);
  const stageRule = requireStage(rules, input.stage);
  if (
    !Number.isInteger(input.rollPpm) ||
    Object.is(input.rollPpm, -0) ||
    input.rollPpm < 0 ||
    input.rollPpm >= PPM_SCALE
  ) {
    throw contractError('INVALID_INPUT', 'Crash bust roll must be an integer from 0 to 999999 PPM');
  }

  const canonical = {
    bustThresholdPpm: stageRule.bustThresholdPpm,
    busted: input.rollPpm < stageRule.bustThresholdPpm,
    calculatorVersion: CRASH_CALCULATOR_VERSION,
    comparison: 'roll-lt-threshold' as const,
    probabilityScalePpm: PPM_SCALE,
    rollPpm: input.rollPpm,
    rulesHash: rules.rulesHash,
    rulesVersion: rules.rulesVersion,
    stage: stageRule.stage,
  };

  return Object.freeze({
    ...canonical,
    calculationHash: sha256(stableStringify(canonical)),
  });
}

function requireStage(rules: CrashCalculatorRuleSet, stage: number): CrashStageRule {
  if (!Number.isInteger(stage) || stage <= 0) {
    throw contractError('INVALID_INPUT', 'Crash calculator stage must be a positive integer');
  }
  const rule = rules.stages[stage - 1];
  if (!rule || rule.stage !== stage) {
    throw contractError('STAGE_NOT_CONFIGURED', 'Crash calculator stage is not configured');
  }
  return rule;
}

function parseMoney(value: unknown, rules: CrashCalculatorRuleSet, field: string): bigint {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as Partial<Money>).currency !== rules.currency ||
    (value as Partial<Money>).decimals !== rules.decimals
  ) {
    throw contractError(
      'INVALID_INPUT',
      `Crash ${field} must use the committed currency and decimals`,
    );
  }
  return parseUnsignedAmount((value as Partial<Money>).amount, field, 'INVALID_INPUT');
}

function parseUnsignedAmount(
  value: unknown,
  field: string,
  errorCode: Extract<CrashCalculatorErrorCode, 'INVALID_INPUT' | 'INVALID_RULES'>,
): bigint {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER_PATTERN.test(value)) {
    throw contractError(errorCode, `Crash ${field} must be canonical unsigned integer minor units`);
  }
  const amount = BigInt(value);
  if (amount > MAX_U64) {
    throw contractError(errorCode, `Crash ${field} exceeds the u64 limit`);
  }
  return amount;
}

function money(amount: bigint): Money {
  return Object.freeze({
    amount: amount.toString(),
    currency: 'USDC',
    decimals: 6,
  });
}

function contractError(
  code: CrashCalculatorErrorCode,
  message: string,
): CrashCalculatorContractError {
  return new CrashCalculatorContractError(code, message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
