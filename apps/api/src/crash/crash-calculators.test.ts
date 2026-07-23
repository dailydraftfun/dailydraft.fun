import { describe, expect, test } from 'bun:test';

import type { Money } from '../domain.js';
import {
  CRASH_CALCULATOR_VERSION,
  CRASH_RULES_SCHEMA_VERSION,
  CrashCalculatorContractError,
  type CrashCalculatorRuleSet,
  calculateCrashBust,
  calculateCrashPot,
  hashCrashCalculatorRuleSet,
  type UnsignedCrashCalculatorRuleSet,
  validateCrashCalculatorRuleSet,
} from './crash-calculators.js';

const UNSIGNED_FIXTURE_RULES = {
  activation: 'fixture-only',
  calculatorVersion: CRASH_CALCULATOR_VERSION,
  constraints: {
    bustThresholdPpm: 'nondecreasing',
    maxPotAmount: 'nondecreasing',
    potContributionBps: 'nondecreasing',
  },
  currency: 'USDC',
  decimals: 6,
  rounding: 'floor',
  rulesVersion: 'synthetic-ci-v1',
  schemaVersion: CRASH_RULES_SCHEMA_VERSION,
  stages: [
    {
      bustThresholdPpm: 100_000,
      maxPotAmount: '100000000',
      potContributionBps: 10_000,
      stage: 1,
    },
    {
      bustThresholdPpm: 250_000,
      maxPotAmount: '250000000',
      potContributionBps: 15_000,
      stage: 2,
    },
    {
      bustThresholdPpm: 500_000,
      maxPotAmount: '500000000',
      potContributionBps: 20_000,
      stage: 3,
    },
  ],
} as const satisfies UnsignedCrashCalculatorRuleSet;

const FIXTURE_RULES_HASH = 'b458a1f37a50fa1d4a780a78b2e9d649fea71581e4a9075f9d3125548b5df380';

const FIXTURE_RULES: CrashCalculatorRuleSet = Object.freeze({
  ...UNSIGNED_FIXTURE_RULES,
  rulesHash: FIXTURE_RULES_HASH,
});

describe('versioned Crash pot calculator', () => {
  test('pins the reviewed synthetic rule fixture to its literal SHA-256 commitment', () => {
    expect(hashCrashCalculatorRuleSet(UNSIGNED_FIXTURE_RULES)).toBe(FIXTURE_RULES_HASH);
    expect(validateCrashCalculatorRuleSet(FIXTURE_RULES).rulesHash).toBe(FIXTURE_RULES_HASH);
  });

  test('reproduces reviewed integer vectors for every synthetic stage', () => {
    const vectors = [
      {
        currentPot: '10000000',
        expectedChange: '5000000',
        expectedHash: '52b50a2f2dc69bfaed5cedf61ab1b57e682c627007e0efa357fe1f8583785c09',
        expectedPot: '15000000',
        stage: 1,
        stageValue: '5000000',
      },
      {
        currentPot: '15000000',
        expectedChange: '2250000',
        expectedHash: 'b438d79ade79b7ef7a003b33602d8562e4d865bad50a0902dc9d2da34f29362c',
        expectedPot: '17250000',
        stage: 2,
        stageValue: '1500000',
      },
      {
        currentPot: '17250000',
        expectedChange: '4000000',
        expectedHash: '4369661aad8ebe4f7c572b8f86188e04ceb416ab1a3eba398e730e4b6a6c00df',
        expectedPot: '21250000',
        stage: 3,
        stageValue: '2000000',
      },
    ];

    for (const vector of vectors) {
      const result = calculateCrashPot(FIXTURE_RULES, {
        currentPot: usdc(vector.currentPot),
        stage: vector.stage,
        stageValue: usdc(vector.stageValue),
      });

      expect(result).toEqual(
        expect.objectContaining({
          calculationHash: vector.expectedHash,
          nextPot: usdc(vector.expectedPot),
          rulesHash: FIXTURE_RULES.rulesHash,
          rulesVersion: 'synthetic-ci-v1',
          stage: vector.stage,
          valueChange: usdc(vector.expectedChange),
        }),
      );
    }
  });

  test('uses explicit floor rounding and preserves its exact remainder evidence', () => {
    const result = calculateCrashPot(FIXTURE_RULES, {
      currentPot: usdc('0'),
      stage: 2,
      stageValue: usdc('1'),
    });

    expect(result).toEqual(
      expect.objectContaining({
        nextPot: usdc('1'),
        rounding: 'floor',
        roundingDenominator: '10000',
        roundingRemainderNumerator: '5000',
        valueChange: usdc('1'),
      }),
    );
  });

  test('accepts each exact configured maximum and rejects the next positive change', () => {
    for (const stageRule of FIXTURE_RULES.stages) {
      expect(
        calculateCrashPot(FIXTURE_RULES, {
          currentPot: usdc(stageRule.maxPotAmount),
          stage: stageRule.stage,
          stageValue: usdc('0'),
        }).nextPot,
      ).toEqual(usdc(stageRule.maxPotAmount));

      expectContractError(
        () =>
          calculateCrashPot(FIXTURE_RULES, {
            currentPot: usdc(stageRule.maxPotAmount),
            stage: stageRule.stage,
            stageValue: usdc('1'),
          }),
        'POT_LIMIT_EXCEEDED',
      );
    }
  });

  test('is deterministic and binds every proof input to the calculation hash', () => {
    const input = {
      currentPot: usdc('1000000'),
      stage: 2,
      stageValue: usdc('2000000'),
    };
    const baseline = calculateCrashPot(FIXTURE_RULES, input);

    expect(calculateCrashPot(FIXTURE_RULES, input)).toEqual(baseline);
    expect(
      calculateCrashPot(FIXTURE_RULES, { ...input, currentPot: usdc('1000001') }).calculationHash,
    ).not.toBe(baseline.calculationHash);
    expect(
      calculateCrashPot(FIXTURE_RULES, { ...input, stageValue: usdc('2000001') }).calculationHash,
    ).not.toBe(baseline.calculationHash);
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(Object.isFrozen(baseline.currentPot)).toBe(true);
    expect(Object.isFrozen(baseline.maxPot)).toBe(true);
    expect(Object.isFrozen(baseline.nextPot)).toBe(true);
    expect(Object.isFrozen(baseline.stageValue)).toBe(true);
    expect(Object.isFrozen(baseline.valueChange)).toBe(true);
  });

  test('proves bounded pot monotonicity and remainder invariants', () => {
    const amounts = [0n, 1n, 9n, 999n, 999_999n, 1_000_000n];

    for (const stageRule of FIXTURE_RULES.stages) {
      let previousNextPot = -1n;
      let previousValueChange = -1n;
      for (const amount of amounts) {
        const currentSweep = calculateCrashPot(FIXTURE_RULES, {
          currentPot: usdc(amount.toString()),
          stage: stageRule.stage,
          stageValue: usdc('1000'),
        });
        const contributionSweep = calculateCrashPot(FIXTURE_RULES, {
          currentPot: usdc('0'),
          stage: stageRule.stage,
          stageValue: usdc(amount.toString()),
        });

        expect(BigInt(currentSweep.nextPot.amount)).toBeGreaterThanOrEqual(previousNextPot);
        expect(BigInt(contributionSweep.valueChange.amount)).toBeGreaterThanOrEqual(
          previousValueChange,
        );
        expect(BigInt(contributionSweep.roundingRemainderNumerator)).toBeLessThan(10_000n);
        previousNextPot = BigInt(currentSweep.nextPot.amount);
        previousValueChange = BigInt(contributionSweep.valueChange.amount);
      }
    }
  });

  test('rejects u64 output overflow after high-basis-point arithmetic', () => {
    const rules = fixtureRules([
      {
        ...UNSIGNED_FIXTURE_RULES.stages[0],
        maxPotAmount: '18446744073709551615',
        potContributionBps: 1_000_000,
      },
    ]);

    expectContractError(
      () =>
        calculateCrashPot(rules, {
          currentPot: usdc('18446744073709551615'),
          stage: 1,
          stageValue: usdc('1'),
        }),
      'POT_LIMIT_EXCEEDED',
    );
  });
});

describe('versioned Crash bust calculator', () => {
  test('uses the exact lower-inclusive PPM threshold boundary at every stage', () => {
    for (const stageRule of FIXTURE_RULES.stages) {
      expect(
        calculateCrashBust(FIXTURE_RULES, {
          rollPpm: stageRule.bustThresholdPpm - 1,
          stage: stageRule.stage,
        }).busted,
      ).toBe(true);
      expect(
        calculateCrashBust(FIXTURE_RULES, {
          rollPpm: stageRule.bustThresholdPpm,
          stage: stageRule.stage,
        }).busted,
      ).toBe(false);
    }
  });

  test('supports the exact never-bust and always-bust threshold extrema', () => {
    const rules = fixtureRules([
      { ...UNSIGNED_FIXTURE_RULES.stages[0], bustThresholdPpm: 0 },
      { ...UNSIGNED_FIXTURE_RULES.stages[1], bustThresholdPpm: 1_000_000 },
    ]);

    expect(calculateCrashBust(rules, { rollPpm: 0, stage: 1 }).busted).toBe(false);
    expect(calculateCrashBust(rules, { rollPpm: 999_999, stage: 2 }).busted).toBe(true);
  });

  test('reproduces every synthetic stage and emits stable proof hashes', () => {
    const vectors = [
      {
        busted: true,
        expectedHash: '7eae5fd31740a9e1920420b08b420120909ab3500540a8c281957f3b2887313f',
        rollPpm: 99_999,
        stage: 1,
      },
      {
        busted: false,
        expectedHash: '0e90cb35e6e51ea21ffacd86380a725ffc9cc96f7c69a29e76098043f25f76b0',
        rollPpm: 250_000,
        stage: 2,
      },
      {
        busted: true,
        expectedHash: 'b3c2322adadb7fbba5eb88c34184e87eaf00901e2f91654b8cb2a8c17d5ff7c5',
        rollPpm: 499_999,
        stage: 3,
      },
    ];

    for (const vector of vectors) {
      const first = calculateCrashBust(FIXTURE_RULES, vector);
      const replay = calculateCrashBust(FIXTURE_RULES, vector);

      expect(first).toEqual(replay);
      expect(first).toEqual(
        expect.objectContaining({
          busted: vector.busted,
          calculationHash: vector.expectedHash,
          comparison: 'roll-lt-threshold',
          probabilityScalePpm: 1_000_000,
          rulesHash: FIXTURE_RULES.rulesHash,
        }),
      );
    }
  });

  test('proves the declared nondecreasing bust constraint across the entire rule set', () => {
    for (const rollPpm of [0, 99_999, 100_000, 249_999, 250_000, 499_999, 999_999]) {
      const outcomes = FIXTURE_RULES.stages.map(({ stage }) =>
        calculateCrashBust(FIXTURE_RULES, { rollPpm, stage }),
      );

      for (let index = 1; index < outcomes.length; index += 1) {
        if (outcomes[index - 1]?.busted) expect(outcomes[index]?.busted).toBe(true);
      }
    }
  });

  test('rejects rolls outside the fixed integer PPM space', () => {
    for (const rollPpm of [-1, -0, 1.5, 1_000_000, Number.NaN]) {
      expectContractError(
        () => calculateCrashBust(FIXTURE_RULES, { rollPpm, stage: 1 }),
        'INVALID_INPUT',
      );
    }
  });
});

describe('Crash calculator rule and input contract', () => {
  test('fails closed when rules are missing, live, version-incompatible, or hash-mismatched', () => {
    expectContractError(() => validateCrashCalculatorRuleSet(undefined), 'UNSUPPORTED_RULES');
    expectContractError(
      () => validateCrashCalculatorRuleSet({ ...FIXTURE_RULES, activation: 'production' }),
      'UNSUPPORTED_RULES',
    );
    expectContractError(
      () => validateCrashCalculatorRuleSet({ ...FIXTURE_RULES, calculatorVersion: 'v2' }),
      'UNSUPPORTED_RULES',
    );
    expectContractError(
      () =>
        validateCrashCalculatorRuleSet({
          ...FIXTURE_RULES,
          stages: FIXTURE_RULES.stages.map((stage) =>
            stage.stage === 2 ? { ...stage, bustThresholdPpm: 250_001 } : stage,
          ),
        }),
      'RULES_HASH_MISMATCH',
    );
  });

  test('rejects skipped stages and every declared monotonicity violation', () => {
    const variants = [
      [
        UNSIGNED_FIXTURE_RULES.stages[0],
        { ...UNSIGNED_FIXTURE_RULES.stages[1], stage: 3 },
        UNSIGNED_FIXTURE_RULES.stages[2],
      ],
      [
        UNSIGNED_FIXTURE_RULES.stages[0],
        { ...UNSIGNED_FIXTURE_RULES.stages[1], bustThresholdPpm: 99_999 },
        UNSIGNED_FIXTURE_RULES.stages[2],
      ],
      [
        UNSIGNED_FIXTURE_RULES.stages[0],
        { ...UNSIGNED_FIXTURE_RULES.stages[1], potContributionBps: 9_999 },
        UNSIGNED_FIXTURE_RULES.stages[2],
      ],
      [
        UNSIGNED_FIXTURE_RULES.stages[0],
        { ...UNSIGNED_FIXTURE_RULES.stages[1], maxPotAmount: '99999999' },
        UNSIGNED_FIXTURE_RULES.stages[2],
      ],
      [
        { ...UNSIGNED_FIXTURE_RULES.stages[0], potContributionBps: -0 },
        UNSIGNED_FIXTURE_RULES.stages[1],
        UNSIGNED_FIXTURE_RULES.stages[2],
      ],
      [
        { ...UNSIGNED_FIXTURE_RULES.stages[0], bustThresholdPpm: -0 },
        UNSIGNED_FIXTURE_RULES.stages[1],
        UNSIGNED_FIXTURE_RULES.stages[2],
      ],
    ];

    for (const stages of variants) {
      const unsigned = { ...UNSIGNED_FIXTURE_RULES, stages } as UnsignedCrashCalculatorRuleSet;
      expectContractError(
        () =>
          validateCrashCalculatorRuleSet({
            ...unsigned,
            rulesHash: hashCrashCalculatorRuleSet(unsigned),
          }),
        'INVALID_RULES',
      );
    }
  });

  test('rejects malformed money, invalid stages, unsupported stages, and u64 input overflow', () => {
    const invalidMoney: Money[] = [
      { amount: '-1', currency: 'USDC', decimals: 6 },
      { amount: '01', currency: 'USDC', decimals: 6 },
      { amount: '18446744073709551616', currency: 'USDC', decimals: 6 },
    ];

    for (const currentPot of invalidMoney) {
      expectContractError(
        () =>
          calculateCrashPot(FIXTURE_RULES, {
            currentPot,
            stage: 1,
            stageValue: usdc('1'),
          }),
        'INVALID_INPUT',
      );
    }
    for (const stageValue of invalidMoney) {
      expectContractError(
        () =>
          calculateCrashPot(FIXTURE_RULES, {
            currentPot: usdc('0'),
            stage: 1,
            stageValue,
          }),
        'INVALID_INPUT',
      );
    }
    expectContractError(
      () =>
        calculateCrashPot(FIXTURE_RULES, {
          currentPot: { amount: '0', currency: 'USDC', decimals: 5 } as unknown as Money,
          stage: 1,
          stageValue: usdc('1'),
        }),
      'INVALID_INPUT',
    );
    for (const stage of [0, -1, 1.5, Number.NaN]) {
      expectContractError(
        () =>
          calculateCrashPot(FIXTURE_RULES, {
            currentPot: usdc('0'),
            stage,
            stageValue: usdc('1'),
          }),
        'INVALID_INPUT',
      );
    }
    expectContractError(
      () =>
        calculateCrashPot(FIXTURE_RULES, {
          currentPot: usdc('0'),
          stage: 4,
          stageValue: usdc('1'),
        }),
      'STAGE_NOT_CONFIGURED',
    );
  });
});

function usdc(amount: string): Money {
  return { amount, currency: 'USDC', decimals: 6 };
}

function fixtureRules(stages: UnsignedCrashCalculatorRuleSet['stages']): CrashCalculatorRuleSet {
  const unsigned = { ...UNSIGNED_FIXTURE_RULES, stages };
  return {
    ...unsigned,
    rulesHash: hashCrashCalculatorRuleSet(unsigned),
  };
}

function expectContractError(action: () => unknown, code: CrashCalculatorContractError['code']) {
  try {
    action();
    throw new Error(`Expected Crash calculator error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CrashCalculatorContractError);
    expect((error as CrashCalculatorContractError).code).toBe(code);
  }
}
