import { describe, expect, test } from 'bun:test';

import {
  GACHA_PULL_ODDS_CALCULATOR_VERSION,
  GACHA_PULL_ODDS_SCHEMA_VERSION,
  GachaPullOddsContractError,
  type GachaPullOddsRuleSet,
  gachaPullOddsBandForRoll,
  gachaPullOddsBandForValue,
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
      { ...RULES, schemaVersion: 'dailydraft.gacha-pull-odds.v2' },
      {
        ...RULES,
        calculatorVersion: 'dailydraft.gacha-pull-odds-calculator.v2',
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

  test('rejects missing rules and malformed contract metadata', () => {
    const cases: Array<{
      candidate: unknown;
      code: GachaPullOddsContractError['code'];
    }> = [
      { candidate: null, code: 'UNSUPPORTED_RULES' },
      { candidate: { ...RULES, currency: 'USD' }, code: 'INVALID_RULES' },
      { candidate: { ...RULES, rulesVersion: 'INVALID RULES VERSION' }, code: 'INVALID_RULES' },
      { candidate: { ...RULES, snapshotContentHash: 'not-a-hash' }, code: 'INVALID_RULES' },
      { candidate: { ...RULES, rulesHash: 'not-a-hash' }, code: 'RULES_HASH_MISMATCH' },
      { candidate: { ...RULES, bands: RULES.bands.slice(0, 3) }, code: 'INVALID_RULES' },
    ];

    for (const { candidate, code } of cases) {
      expectContractError(() => validateGachaPullOddsRuleSet(candidate), code);
    }
  });

  test('rejects malformed bands and non-canonical minor units', () => {
    const cases: unknown[] = [
      { ...RULES, bands: [null, ...RULES.bands.slice(1)] },
      {
        ...RULES,
        bands: [{ ...RULES.bands[0], label: 'plus' }, ...RULES.bands.slice(1)],
      },
      {
        ...RULES,
        bands: [{ ...RULES.bands[0], probabilityPpm: -1 }, ...RULES.bands.slice(1)],
      },
      {
        ...RULES,
        bands: [{ ...RULES.bands[0], minimumInsuredValueMinor: '1' }, ...RULES.bands.slice(1)],
      },
      {
        ...RULES,
        bands: [{ ...RULES.bands[0], minimumInsuredValueMinor: '-1' }, ...RULES.bands.slice(1)],
      },
      {
        ...RULES,
        bands: [
          {
            ...RULES.bands[0],
            minimumInsuredValueMinor: '18446744073709551616',
          },
          ...RULES.bands.slice(1),
        ],
      },
    ];

    for (const candidate of cases) {
      expectContractError(() => validateGachaPullOddsRuleSet(candidate), 'INVALID_RULES');
    }
  });

  test('classifies deterministic PPM rolls and insured values at exact band boundaries', () => {
    expect(gachaPullOddsBandForRoll(RULES.bands, 0).label).toBe('base');
    expect(gachaPullOddsBandForRoll(RULES.bands, 599_999).label).toBe('base');
    expect(gachaPullOddsBandForRoll(RULES.bands, 600_000).label).toBe('plus');
    expect(gachaPullOddsBandForRoll(RULES.bands, 999_999).label).toBe('chase');

    expect(gachaPullOddsBandForValue(RULES.bands, '0').label).toBe('base');
    expect(gachaPullOddsBandForValue(RULES.bands, '49999999').label).toBe('base');
    expect(gachaPullOddsBandForValue(RULES.bands, '50000000').label).toBe('plus');
    expect(gachaPullOddsBandForValue(RULES.bands, '250000000').label).toBe('chase');
  });

  test('fails closed for invalid simulation rolls and insured values', () => {
    expectContractError(() => gachaPullOddsBandForRoll(RULES.bands, -1), 'INVALID_RULES');
    expectContractError(() => gachaPullOddsBandForRoll(RULES.bands, 1_000_000), 'INVALID_RULES');
    expectContractError(() => gachaPullOddsBandForValue(RULES.bands, '-1'), 'INVALID_RULES');
    expectContractError(() => gachaPullOddsBandForValue([], '0'), 'INVALID_RULES');
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
