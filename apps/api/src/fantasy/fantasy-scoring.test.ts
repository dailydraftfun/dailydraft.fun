import { describe, expect, test } from 'bun:test';

import {
  calculateFantasyPlayerScore,
  FANTASY_POINTS_SCALE,
  FANTASY_SCORING_SCHEMA_VERSION,
  FANTASY_SCORING_VERSION,
  FantasyScoringContractError,
  type FantasyScoringRuleSet,
  hashFantasyScoringRuleSet,
  type UnsignedFantasyScoringRuleSet,
  validateFantasyScoringRuleSet,
} from './fantasy-scoring.js';

const UNSIGNED_FIXTURE_RULES = {
  activation: 'fixture-only',
  calculatorVersion: FANTASY_SCORING_VERSION,
  pointsScale: FANTASY_POINTS_SCALE,
  positions: [
    {
      baseMilliPoints: '0',
      components: [
        { milliPointsPerUnit: '10', stat: 'minutesPlayed' },
        { milliPointsPerUnit: '500', stat: 'saves' },
        { milliPointsPerUnit: '4000', stat: 'cleanSheet' },
        { milliPointsPerUnit: '-1000', stat: 'goalsConceded' },
      ],
      position: 'GOALKEEPER',
    },
    {
      baseMilliPoints: '0',
      components: [
        { milliPointsPerUnit: '10', stat: 'minutesPlayed' },
        { milliPointsPerUnit: '6000', stat: 'goals' },
        { milliPointsPerUnit: '4000', stat: 'cleanSheet' },
        { milliPointsPerUnit: '200', stat: 'tackles' },
        { milliPointsPerUnit: '150', stat: 'interceptions' },
      ],
      position: 'DEFENDER',
    },
    {
      baseMilliPoints: '0',
      components: [
        { milliPointsPerUnit: '10', stat: 'minutesPlayed' },
        { milliPointsPerUnit: '5000', stat: 'goals' },
        { milliPointsPerUnit: '3000', stat: 'assists' },
        { milliPointsPerUnit: '250', stat: 'keyPasses' },
        { milliPointsPerUnit: '200', stat: 'tackles' },
      ],
      position: 'MIDFIELDER',
    },
    {
      baseMilliPoints: '0',
      components: [
        { milliPointsPerUnit: '10', stat: 'minutesPlayed' },
        { milliPointsPerUnit: '4000', stat: 'goals' },
        { milliPointsPerUnit: '3000', stat: 'assists' },
        { milliPointsPerUnit: '500', stat: 'shotsOnTarget' },
      ],
      position: 'FORWARD',
    },
  ],
  rounding: 'exact',
  rulesVersion: 'synthetic-soccer-ci-v1',
  schemaVersion: FANTASY_SCORING_SCHEMA_VERSION,
  sport: 'SOCCER',
} as const satisfies UnsignedFantasyScoringRuleSet;

const FIXTURE_RULES_HASH = '72c2dc2b307c582a4e3b92850bb212d5c9b1dee5389849fed0a37475bd7b485f';

const FIXTURE_RULES: FantasyScoringRuleSet = Object.freeze({
  ...UNSIGNED_FIXTURE_RULES,
  rulesHash: FIXTURE_RULES_HASH,
});

describe('versioned fantasy scoring calculator', () => {
  test('pins the reviewed synthetic rule fixture to its literal SHA-256 commitment', () => {
    expect(hashFantasyScoringRuleSet(UNSIGNED_FIXTURE_RULES)).toBe(FIXTURE_RULES_HASH);
    const validated = validateFantasyScoringRuleSet(FIXTURE_RULES);
    expect(validated.rulesHash).toBe(FIXTURE_RULES_HASH);
    expect(validated.sport).toBe('SOCCER');
  });

  test('accumulates position milli-points exactly with no division', () => {
    const result = calculateFantasyPlayerScore(FIXTURE_RULES, {
      position: 'FORWARD',
      statLine: { assists: 1, goals: 2, minutesPlayed: 90, shotsOnTarget: 4 },
    });

    // 90*10 + 2*4000 + 1*3000 + 4*500 = 900 + 8000 + 3000 + 2000
    expect(result.totalMilliPoints).toBe('13900');
    expect(result.pointsScale).toBe(FANTASY_POINTS_SCALE);
    expect(result.rounding).toBe('exact');
    expect(result.calculationHash).toBe(
      '19f7afffce32e2b9cdc871e89507cf622ab3b6fd292ee76e5477a7fdade21d11',
    );
    expect(result.breakdown).toHaveLength(4);
    expect(result.breakdown.map((component) => component.milliPoints)).toEqual([
      '900',
      '8000',
      '3000',
      '2000',
    ]);
  });

  test('treats absent configured stats as zero units', () => {
    const result = calculateFantasyPlayerScore(FIXTURE_RULES, {
      position: 'GOALKEEPER',
      statLine: { cleanSheet: 1, minutesPlayed: 90 },
    });

    // 90*10 + 0*500(saves) + 1*4000 + 0*-1000(goalsConceded)
    expect(result.totalMilliPoints).toBe('4900');
  });

  test('applies negative component weights to subtract points', () => {
    const result = calculateFantasyPlayerScore(FIXTURE_RULES, {
      position: 'GOALKEEPER',
      statLine: { goalsConceded: 3, minutesPlayed: 90, saves: 2 },
    });

    // 90*10 + 2*500 + 0*4000 + 3*-1000 = 900 + 1000 - 3000
    expect(result.totalMilliPoints).toBe('-1100');
  });

  test('is deterministic across repeated evaluations', () => {
    const input = {
      position: 'MIDFIELDER' as const,
      statLine: { assists: 2, goals: 1, keyPasses: 3, minutesPlayed: 88, tackles: 4 },
    };
    const first = calculateFantasyPlayerScore(FIXTURE_RULES, input);
    const second = calculateFantasyPlayerScore(FIXTURE_RULES, input);
    expect(second.calculationHash).toBe(first.calculationHash);
    expect(second.totalMilliPoints).toBe(first.totalMilliPoints);
  });

  test('fails closed on stat keys that are not scored for the position', () => {
    expect(() =>
      calculateFantasyPlayerScore(FIXTURE_RULES, {
        position: 'FORWARD',
        statLine: { goals: 1, saves: 5 },
      }),
    ).toThrow(FantasyScoringContractError);
    try {
      calculateFantasyPlayerScore(FIXTURE_RULES, {
        position: 'FORWARD',
        statLine: { goals: 1, saves: 5 },
      });
    } catch (error) {
      expect((error as FantasyScoringContractError).code).toBe('UNKNOWN_STAT');
    }
  });

  test('rejects a rule set whose committed hash does not match its contents', () => {
    const tampered = { ...FIXTURE_RULES, rulesVersion: 'tampered-ci-v1' };
    try {
      validateFantasyScoringRuleSet(tampered);
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FantasyScoringContractError);
      expect((error as FantasyScoringContractError).code).toBe('RULES_HASH_MISMATCH');
    }
  });

  test('rejects non-integer stat units', () => {
    try {
      calculateFantasyPlayerScore(FIXTURE_RULES, {
        position: 'FORWARD',
        statLine: { goals: 1.5 },
      });
      throw new Error('expected validation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FantasyScoringContractError);
      expect((error as FantasyScoringContractError).code).toBe('INVALID_INPUT');
    }
  });
});
