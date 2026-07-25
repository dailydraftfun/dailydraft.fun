import { createHash } from 'node:crypto';

import { stableStringify } from '../providers/valuation-policy.js';

export const GACHA_PULL_ODDS_SCHEMA_VERSION = 'dailydraft.gacha-pull-odds.v1' as const;
export const GACHA_PULL_ODDS_CALCULATOR_VERSION =
  'dailydraft.gacha-pull-odds-calculator.v1' as const;

export const GACHA_PROBABILITY_SCALE_PPM = 1_000_000;

const BAND_LABELS = ['base', 'plus', 'premium', 'chase'] as const;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RULES_VERSION_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const MAX_U64 = 18_446_744_073_709_551_615n;

export type GachaPullOddsErrorCode =
  | 'INVALID_RULES'
  | 'ODDS_TOTAL_MISMATCH'
  | 'RULES_HASH_MISMATCH'
  | 'UNSUPPORTED_RULES';

export class GachaPullOddsContractError extends Error {
  constructor(
    readonly code: GachaPullOddsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GachaPullOddsContractError';
  }
}

export type GachaPullOddsBandLabel = (typeof BAND_LABELS)[number];

export interface GachaPullOddsBand {
  label: GachaPullOddsBandLabel;
  minimumInsuredValueMinor: string;
  probabilityPpm: number;
}

export interface UnsignedGachaPullOddsRuleSet {
  activation: 'fixture-only';
  bands: readonly GachaPullOddsBand[];
  calculatorVersion: typeof GACHA_PULL_ODDS_CALCULATOR_VERSION;
  constraints: {
    minimumInsuredValueMinor: 'nondecreasing';
  };
  currency: 'USDC';
  decimals: 6;
  probabilityScalePpm: typeof GACHA_PROBABILITY_SCALE_PPM;
  rulesVersion: string;
  schemaVersion: typeof GACHA_PULL_ODDS_SCHEMA_VERSION;
  snapshotContentHash: string;
}

export interface GachaPullOddsRuleSet extends UnsignedGachaPullOddsRuleSet {
  rulesHash: string;
}

export function hashGachaPullOddsRuleSet(rules: UnsignedGachaPullOddsRuleSet): string {
  return sha256(stableStringify(rules));
}

export function validateGachaPullOddsRuleSet(value: unknown): GachaPullOddsRuleSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError('UNSUPPORTED_RULES', 'Gacha pull odds rules are required');
  }

  const rules = value as Partial<GachaPullOddsRuleSet>;
  if (
    rules.schemaVersion !== GACHA_PULL_ODDS_SCHEMA_VERSION ||
    rules.calculatorVersion !== GACHA_PULL_ODDS_CALCULATOR_VERSION ||
    rules.activation !== 'fixture-only'
  ) {
    throw contractError(
      'UNSUPPORTED_RULES',
      'Gacha pull odds use an unsupported schema, calculator, or activation mode',
    );
  }
  if (
    rules.currency !== 'USDC' ||
    rules.decimals !== 6 ||
    rules.probabilityScalePpm !== GACHA_PROBABILITY_SCALE_PPM ||
    rules.constraints?.minimumInsuredValueMinor !== 'nondecreasing'
  ) {
    throw contractError('INVALID_RULES', 'Gacha pull odds have invalid numeric semantics');
  }
  if (typeof rules.rulesVersion !== 'string' || !RULES_VERSION_PATTERN.test(rules.rulesVersion)) {
    throw contractError('INVALID_RULES', 'Gacha pull odds rulesVersion is invalid');
  }
  if (
    typeof rules.snapshotContentHash !== 'string' ||
    !HASH_PATTERN.test(rules.snapshotContentHash)
  ) {
    throw contractError('INVALID_RULES', 'Gacha pull odds snapshot content hash is invalid');
  }
  if (typeof rules.rulesHash !== 'string' || !HASH_PATTERN.test(rules.rulesHash)) {
    throw contractError('RULES_HASH_MISMATCH', 'Gacha pull odds rulesHash is invalid');
  }
  if (!Array.isArray(rules.bands) || rules.bands.length !== BAND_LABELS.length) {
    throw contractError('INVALID_RULES', 'Gacha pull odds require four ordered bands');
  }

  const bands: GachaPullOddsBand[] = [];
  let previousMinimum = -1n;
  let probabilityTotal = 0;
  for (const [index, expectedLabel] of BAND_LABELS.entries()) {
    const candidate = rules.bands[index];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw contractError('INVALID_RULES', 'Gacha pull odds band is invalid');
    }
    const band = candidate as Partial<GachaPullOddsBand>;
    if (band.label !== expectedLabel) {
      throw contractError('INVALID_RULES', 'Gacha pull odds bands must use canonical ordering');
    }
    if (
      !Number.isInteger(band.probabilityPpm) ||
      band.probabilityPpm === undefined ||
      Object.is(band.probabilityPpm, -0) ||
      band.probabilityPpm < 0 ||
      band.probabilityPpm > GACHA_PROBABILITY_SCALE_PPM
    ) {
      throw contractError('INVALID_RULES', 'Gacha pull odds band probability is invalid');
    }
    const minimum = parseMinorUnits(band.minimumInsuredValueMinor);
    if (minimum < previousMinimum) {
      throw contractError(
        'INVALID_RULES',
        'Gacha pull odds violate the nondecreasing band constraint',
      );
    }
    bands.push(
      Object.freeze({
        label: expectedLabel,
        minimumInsuredValueMinor: minimum.toString(),
        probabilityPpm: band.probabilityPpm,
      }),
    );
    previousMinimum = minimum;
    probabilityTotal += band.probabilityPpm;
  }
  if (bands[0]?.minimumInsuredValueMinor !== '0') {
    throw contractError('INVALID_RULES', 'Gacha pull odds base band must begin at zero');
  }
  if (probabilityTotal !== GACHA_PROBABILITY_SCALE_PPM) {
    throw contractError(
      'ODDS_TOTAL_MISMATCH',
      `Gacha pull odds must total ${GACHA_PROBABILITY_SCALE_PPM} PPM`,
    );
  }

  const unsignedRules: UnsignedGachaPullOddsRuleSet = {
    activation: 'fixture-only',
    bands: Object.freeze(bands),
    calculatorVersion: GACHA_PULL_ODDS_CALCULATOR_VERSION,
    constraints: Object.freeze({ minimumInsuredValueMinor: 'nondecreasing' }),
    currency: 'USDC',
    decimals: 6,
    probabilityScalePpm: GACHA_PROBABILITY_SCALE_PPM,
    rulesVersion: rules.rulesVersion,
    schemaVersion: GACHA_PULL_ODDS_SCHEMA_VERSION,
    snapshotContentHash: rules.snapshotContentHash,
  };
  const calculatedHash = hashGachaPullOddsRuleSet(unsignedRules);
  if (calculatedHash !== rules.rulesHash) {
    throw contractError('RULES_HASH_MISMATCH', 'Gacha pull odds do not match their committed hash');
  }

  return Object.freeze({ ...unsignedRules, rulesHash: calculatedHash });
}

export function createFixtureGachaPullOddsRuleSet(
  snapshotContentHash: string,
): GachaPullOddsRuleSet {
  const unsigned = Object.freeze({
    activation: 'fixture-only',
    bands: Object.freeze([
      Object.freeze({
        label: 'base',
        minimumInsuredValueMinor: '0',
        probabilityPpm: 620_000,
      }),
      Object.freeze({
        label: 'plus',
        minimumInsuredValueMinor: '50000000',
        probabilityPpm: 250_000,
      }),
      Object.freeze({
        label: 'premium',
        minimumInsuredValueMinor: '100000000',
        probabilityPpm: 100_000,
      }),
      Object.freeze({
        label: 'chase',
        minimumInsuredValueMinor: '250000000',
        probabilityPpm: 30_000,
      }),
    ]),
    calculatorVersion: GACHA_PULL_ODDS_CALCULATOR_VERSION,
    constraints: Object.freeze({
      minimumInsuredValueMinor: 'nondecreasing',
    }),
    currency: 'USDC',
    decimals: 6,
    probabilityScalePpm: GACHA_PROBABILITY_SCALE_PPM,
    rulesVersion: 'sports-pack-gacha-fixture-v1',
    schemaVersion: GACHA_PULL_ODDS_SCHEMA_VERSION,
    snapshotContentHash,
  } as const satisfies UnsignedGachaPullOddsRuleSet);

  return Object.freeze({
    ...unsigned,
    rulesHash: hashGachaPullOddsRuleSet(unsigned),
  });
}

function parseMinorUnits(value: unknown): bigint {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER_PATTERN.test(value)) {
    throw contractError(
      'INVALID_RULES',
      'Gacha pull odds band minimum must be canonical unsigned minor units',
    );
  }
  const amount = BigInt(value);
  if (amount > MAX_U64) {
    throw contractError('INVALID_RULES', 'Gacha pull odds band minimum exceeds the u64 limit');
  }
  return amount;
}

function contractError(code: GachaPullOddsErrorCode, message: string): GachaPullOddsContractError {
  return new GachaPullOddsContractError(code, message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
