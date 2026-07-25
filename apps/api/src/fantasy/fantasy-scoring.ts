import { createHash } from 'node:crypto';

import { stableStringify } from '../providers/valuation-policy.js';
import {
  FANTASY_RULES_HASH_PATTERN,
  FANTASY_RULES_VERSION_PATTERN,
  FANTASY_SIGNED_INTEGER_PATTERN,
  FANTASY_STAT_KEY_PATTERN,
  type FantasyPosition,
  type FantasySport,
  isFantasyPosition,
  isFantasySport,
} from './fantasy-domain.js';

export const FANTASY_SCORING_VERSION = 'dailydraft.fantasy-scoring.v1' as const;
export const FANTASY_SCORING_SCHEMA_VERSION = 'dailydraft.fantasy-scoring-rules.v1' as const;

// Scores are accumulated in signed milli-points (1 point = 1000 minor units) so
// fractional per-stat weights stay exact integers. Accumulation is pure BigInt
// addition and multiplication — there is no division and therefore no rounding.
export const FANTASY_POINTS_SCALE = 1000 as const;

const MAX_COMPONENTS_PER_POSITION = 64;
const MAX_STAT_UNITS = 100_000;
const MAX_MILLI_POINTS_PER_UNIT = 100_000_000n;

export type FantasyScoringErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_RULES'
  | 'POSITION_NOT_CONFIGURED'
  | 'RULES_HASH_MISMATCH'
  | 'UNKNOWN_STAT'
  | 'UNSUPPORTED_RULES';

export class FantasyScoringContractError extends Error {
  constructor(
    readonly code: FantasyScoringErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FantasyScoringContractError';
  }
}

export interface FantasyScoringComponent {
  milliPointsPerUnit: string;
  stat: string;
}

export interface FantasyPositionScoringRule {
  baseMilliPoints: string;
  components: readonly FantasyScoringComponent[];
  position: FantasyPosition;
}

export interface UnsignedFantasyScoringRuleSet {
  activation: 'fixture-only';
  calculatorVersion: typeof FANTASY_SCORING_VERSION;
  pointsScale: typeof FANTASY_POINTS_SCALE;
  positions: readonly FantasyPositionScoringRule[];
  rounding: 'exact';
  rulesVersion: string;
  schemaVersion: typeof FANTASY_SCORING_SCHEMA_VERSION;
  sport: FantasySport;
}

export interface FantasyScoringRuleSet extends UnsignedFantasyScoringRuleSet {
  rulesHash: string;
}

export interface FantasyScoreInput {
  position: FantasyPosition;
  statLine: Readonly<Record<string, number>>;
}

export interface FantasyScoreComponentResult {
  milliPoints: string;
  milliPointsPerUnit: string;
  stat: string;
  units: number;
}

export interface FantasyPlayerScoreResult {
  breakdown: readonly FantasyScoreComponentResult[];
  calculationHash: string;
  calculatorVersion: typeof FANTASY_SCORING_VERSION;
  pointsScale: typeof FANTASY_POINTS_SCALE;
  position: FantasyPosition;
  rounding: 'exact';
  rulesHash: string;
  rulesVersion: string;
  sport: FantasySport;
  totalMilliPoints: string;
}

export function hashFantasyScoringRuleSet(rules: UnsignedFantasyScoringRuleSet): string {
  return sha256(stableStringify(rules));
}

export function validateFantasyScoringRuleSet(value: unknown): FantasyScoringRuleSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError('UNSUPPORTED_RULES', 'Fantasy scoring rules are required');
  }

  const rules = value as Partial<FantasyScoringRuleSet>;
  if (
    rules.schemaVersion !== FANTASY_SCORING_SCHEMA_VERSION ||
    rules.calculatorVersion !== FANTASY_SCORING_VERSION ||
    rules.activation !== 'fixture-only'
  ) {
    throw contractError(
      'UNSUPPORTED_RULES',
      'Fantasy scoring rules use an unsupported schema, calculator, or activation mode',
    );
  }
  if (
    rules.pointsScale !== FANTASY_POINTS_SCALE ||
    rules.rounding !== 'exact' ||
    !isFantasySport(rules.sport)
  ) {
    throw contractError('INVALID_RULES', 'Fantasy scoring rules have invalid scoring semantics');
  }
  if (
    typeof rules.rulesVersion !== 'string' ||
    !FANTASY_RULES_VERSION_PATTERN.test(rules.rulesVersion)
  ) {
    throw contractError('INVALID_RULES', 'Fantasy scoring rulesVersion is invalid');
  }
  if (typeof rules.rulesHash !== 'string' || !FANTASY_RULES_HASH_PATTERN.test(rules.rulesHash)) {
    throw contractError('RULES_HASH_MISMATCH', 'Fantasy scoring rulesHash is invalid');
  }
  if (!Array.isArray(rules.positions) || rules.positions.length === 0) {
    throw contractError('INVALID_RULES', 'Fantasy scoring rules require a position table');
  }

  const positions: FantasyPositionScoringRule[] = [];
  const seenPositions = new Set<FantasyPosition>();

  for (const candidate of rules.positions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw contractError('INVALID_RULES', 'Fantasy scoring position rule is invalid');
    }
    const positionRule = candidate as Partial<FantasyPositionScoringRule>;
    if (!isFantasyPosition(positionRule.position) || seenPositions.has(positionRule.position)) {
      throw contractError('INVALID_RULES', 'Fantasy scoring positions must be known and unique');
    }
    seenPositions.add(positionRule.position);

    const baseMilliPoints = parseSignedMilliPoints(
      positionRule.baseMilliPoints,
      'base milli-points',
    );
    if (
      !Array.isArray(positionRule.components) ||
      positionRule.components.length > MAX_COMPONENTS_PER_POSITION
    ) {
      throw contractError('INVALID_RULES', 'Fantasy scoring components must be a bounded list');
    }

    const components: FantasyScoringComponent[] = [];
    const seenStats = new Set<string>();
    for (const rawComponent of positionRule.components) {
      if (!rawComponent || typeof rawComponent !== 'object' || Array.isArray(rawComponent)) {
        throw contractError('INVALID_RULES', 'Fantasy scoring component is invalid');
      }
      const component = rawComponent as Partial<FantasyScoringComponent>;
      if (typeof component.stat !== 'string' || !FANTASY_STAT_KEY_PATTERN.test(component.stat)) {
        throw contractError('INVALID_RULES', 'Fantasy scoring component stat key is invalid');
      }
      if (seenStats.has(component.stat)) {
        throw contractError('INVALID_RULES', 'Fantasy scoring component stats must be unique');
      }
      seenStats.add(component.stat);
      const milliPointsPerUnit = parseSignedMilliPoints(
        component.milliPointsPerUnit,
        'component milli-points per unit',
      );

      components.push(
        Object.freeze({
          milliPointsPerUnit: milliPointsPerUnit.toString(),
          stat: component.stat,
        }),
      );
    }

    positions.push(
      Object.freeze({
        baseMilliPoints: baseMilliPoints.toString(),
        components: Object.freeze(components),
        position: positionRule.position,
      }),
    );
  }

  const unsignedRules: UnsignedFantasyScoringRuleSet = {
    activation: 'fixture-only',
    calculatorVersion: FANTASY_SCORING_VERSION,
    pointsScale: FANTASY_POINTS_SCALE,
    positions: Object.freeze(positions),
    rounding: 'exact',
    rulesVersion: rules.rulesVersion,
    schemaVersion: FANTASY_SCORING_SCHEMA_VERSION,
    sport: rules.sport,
  };
  const calculatedHash = hashFantasyScoringRuleSet(unsignedRules);
  if (calculatedHash !== rules.rulesHash) {
    throw contractError(
      'RULES_HASH_MISMATCH',
      'Fantasy scoring rules do not match their committed hash',
    );
  }

  return Object.freeze({ ...unsignedRules, rulesHash: calculatedHash });
}

export function calculateFantasyPlayerScore(
  rulesInput: unknown,
  input: FantasyScoreInput,
): FantasyPlayerScoreResult {
  const rules = validateFantasyScoringRuleSet(rulesInput);
  if (!isFantasyPosition(input.position)) {
    throw contractError('INVALID_INPUT', 'Fantasy score input position is invalid');
  }
  const positionRule = rules.positions.find((rule) => rule.position === input.position);
  if (!positionRule) {
    throw contractError('POSITION_NOT_CONFIGURED', 'Fantasy scoring position is not configured');
  }
  const statLine = input.statLine;
  if (!statLine || typeof statLine !== 'object' || Array.isArray(statLine)) {
    throw contractError('INVALID_INPUT', 'Fantasy score input stat line must be an object');
  }

  const configuredStats = new Set(positionRule.components.map((component) => component.stat));
  for (const stat of Object.keys(statLine)) {
    if (!configuredStats.has(stat)) {
      throw contractError(
        'UNKNOWN_STAT',
        `Fantasy score stat "${stat}" is not scored for position`,
      );
    }
  }

  let totalMilliPoints = BigInt(positionRule.baseMilliPoints);
  const breakdown: FantasyScoreComponentResult[] = [];

  for (const component of positionRule.components) {
    const rawUnits = Object.hasOwn(statLine, component.stat) ? statLine[component.stat] : 0;
    const units = parseStatUnits(rawUnits, component.stat);
    const milliPoints = BigInt(units) * BigInt(component.milliPointsPerUnit);
    totalMilliPoints += milliPoints;
    breakdown.push(
      Object.freeze({
        milliPoints: milliPoints.toString(),
        milliPointsPerUnit: component.milliPointsPerUnit,
        stat: component.stat,
        units,
      }),
    );
  }

  const canonical = {
    breakdown: Object.freeze(breakdown),
    calculatorVersion: FANTASY_SCORING_VERSION,
    pointsScale: FANTASY_POINTS_SCALE,
    position: input.position,
    rounding: 'exact' as const,
    rulesHash: rules.rulesHash,
    rulesVersion: rules.rulesVersion,
    sport: rules.sport,
    totalMilliPoints: totalMilliPoints.toString(),
  };

  return Object.freeze({
    ...canonical,
    calculationHash: sha256(stableStringify(canonical)),
  });
}

function parseSignedMilliPoints(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !FANTASY_SIGNED_INTEGER_PATTERN.test(value)) {
    throw contractError(
      'INVALID_RULES',
      `Fantasy scoring ${field} must be a signed integer string`,
    );
  }
  const amount = BigInt(value);
  if (amount > MAX_MILLI_POINTS_PER_UNIT || amount < -MAX_MILLI_POINTS_PER_UNIT) {
    throw contractError('INVALID_RULES', `Fantasy scoring ${field} exceeds the configured bound`);
  }
  return amount;
}

function parseStatUnits(value: unknown, stat: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    Object.is(value, -0) ||
    value < -MAX_STAT_UNITS ||
    value > MAX_STAT_UNITS
  ) {
    throw contractError('INVALID_INPUT', `Fantasy score stat "${stat}" must be a bounded integer`);
  }
  return value;
}

function contractError(
  code: FantasyScoringErrorCode,
  message: string,
): FantasyScoringContractError {
  return new FantasyScoringContractError(code, message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
