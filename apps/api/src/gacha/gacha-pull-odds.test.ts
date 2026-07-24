import { describe, expect, test } from 'bun:test';

import {
  GACHA_PULL_ODDS_CALCULATOR_VERSION,
  GACHA_PULL_ODDS_SCHEMA_VERSION,
  GachaPullOddsContractError,
  type GachaPullOddsRuleSet,
  hashGachaPullOddsRuleSet,
  type UnsignedGachaPullOddsRuleSet,
  validateGachaPullOddsRuleSet,
} from './gacha-pull-odds.js';

const SNAPSHOT_HASH = 'a'.repeat(64);

const UNSIGNED_RULES = Object.freeze({
  activation: 'fixture-only',
  bands: Object.freeze([
    Object.freeze({ label: 'base', minimumInsuredValueMinor: '0', probabilityPpm: 600_000 }),
    Object.freeze({
      label: 'plus',
      minimumInsuredValueMinor: '50000000',
      probabilityPpm: 250_000,
    }),
    Object.freeze({
      label: 'premium',
      minimumInsuredValueMinor: '100000000',
      probabilityPpm: 120_000,
    }),
    Object.freeze({
      label: 'chase',
      minimumInsuredValueMinor: '250000000',
      probabilityPpm: 30_000,
    }),
  ]),
  calculatorVersion: GACHA_PULL_ODDS_CALCULATOR_VERSION,
  constraints: Object.freeze({ minimumInsuredValueMinor: 'nondecreasing' }),
  currency: 'USDC',
  decimals: 6,
  probabilityScalePpm: 1_000_000,
  rulesVersion: 'gacha-odds-fixture-v1',
  schemaVersion: GACHA_PULL_ODDS_SCHEMA_VERSION,
  snapshotContentHash: SNAPSHOT_HASH,
} as const satisfies UnsignedGachaPullOddsRuleSet);

const RULES: GachaPullOddsRuleSet = Object.freeze({
  ...UNSIGNED_RULES,
  rulesHash: hashGachaPullOddsRuleSet(UNSIGNED_RULES),
});

describe('versioned Gacha pull odds', () => {
  test('round-trips the canonical hash and freezes validated bands', () => {
    const validated = validateGachaPullOddsRuleSet(RULES);

    expect(validated.rulesHash).toBe(hashGachaPullOddsRuleSet(UNSIGNED_RULES));
    expect(validated.snapshotContentHash).toBe(SNAPSHOT_HASH);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.bands)).toBe(true);
    expect(validated.bands.every(Object.isFrozen)).toBe(true);
  });

  test('enforces an exact one-million PPM total', () => {
    expectContractError(
      () =>
        validateGachaPullOddsRuleSet({
          ...RULES,
          bands: RULES.bands.map((band) =>
            band.label === 'base' ? { ...band, probabilityPpm: 599_999 } : band,
          ),
        }),
      'ODDS_TOTAL_MISMATCH',
    );
  });

  test('rejects a hash-locked rules tamper', () => {
    expectContractError(
      () =>
        validateGachaPullOddsRuleSet({
          ...RULES,
          bands: RULES.bands.map((band) =>
            band.label === 'plus' ? { ...band, minimumInsuredValueMinor: '50000001' } : band,
          ),
        }),
      'RULES_HASH_MISMATCH',
    );
  });

  test('rejects schema and calculator version mismatches', () => {
    for (const candidate of [
      { ...RULES, schemaVersion: 'openpacksduel.gacha-pull-odds.v2' },
      {
        ...RULES,
        calculatorVersion: 'openpacksduel.gacha-pull-odds-calculator.v2',
      },
    ]) {
      expectContractError(() => validateGachaPullOddsRuleSet(candidate), 'UNSUPPORTED_RULES');
    }
  });

  test('rejects decreasing insured-value band boundaries', () => {
    expectContractError(
      () =>
        validateGachaPullOddsRuleSet({
          ...RULES,
          bands: [
            RULES.bands[0],
            { ...RULES.bands[1], minimumInsuredValueMinor: '200000000' },
            RULES.bands[2],
            RULES.bands[3],
          ],
        }),
      'INVALID_RULES',
    );
  });
});

function expectContractError(
  operation: () => unknown,
  code: GachaPullOddsContractError['code'],
): void {
  try {
    operation();
    throw new Error('Expected GachaPullOddsContractError');
  } catch (error) {
    expect(error).toBeInstanceOf(GachaPullOddsContractError);
    expect((error as GachaPullOddsContractError).code).toBe(code);
  }
}
