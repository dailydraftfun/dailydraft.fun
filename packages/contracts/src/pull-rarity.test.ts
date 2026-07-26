import { describe, expect, test } from 'bun:test';

import {
  PULL_RARITY_FLOORS_USD,
  PULL_RARITY_SCHEMA_VERSION,
  pullRarityFixtures,
  pullRarityFor,
  pullRarityLabel,
  pullRarityPresentation,
} from './pull-rarity.js';

describe('versioned pull rarity contract', () => {
  test('derives every fixture path from committed minor units and decimals', () => {
    expect(pullRarityFixtures.schemaVersion).toBe(PULL_RARITY_SCHEMA_VERSION);

    for (const fixture of pullRarityFixtures.cases) {
      const valueMinor = fixture.valueMinor === null ? null : BigInt(fixture.valueMinor);
      expect(pullRarityFor(valueMinor, fixture.decimals)).toBe(fixture.expected);
    }
  });

  test('publishes the canonical descending USD floors', () => {
    expect(PULL_RARITY_FLOORS_USD).toEqual([
      { minUsd: 150, rarity: 'chase' },
      { minUsd: 50, rarity: 'rare' },
      { minUsd: 10, rarity: 'uncommon' },
    ]);
  });

  test('normalizes decimals exactly like the canonical presentation helper', () => {
    expect(pullRarityFor(150n, -1)).toBe('chase');
    expect(pullRarityFor(15_000n, 2.9)).toBe('chase');
    expect(pullRarityFor(150n, Number.NaN)).toBe('chase');
    expect(pullRarityFor(150n, Number.POSITIVE_INFINITY)).toBe('chase');
  });

  test('fails closed when either committed value field is missing', () => {
    expect(pullRarityFor(undefined, 6)).toBe('common');
    expect(pullRarityFor(null, 6)).toBe('common');
    expect(pullRarityFor(150_000_000n, undefined)).toBe('common');
    expect(pullRarityFor(150_000_000n, null)).toBe('common');
  });

  test('returns the canonical labels and presentation shape', () => {
    expect(pullRarityLabel('common')).toBe('Common pull');
    expect(pullRarityLabel('uncommon')).toBe('Uncommon pull');
    expect(pullRarityLabel('rare')).toBe('Rare pull');
    expect(pullRarityLabel('chase')).toBe('Chase pull');
    expect(pullRarityPresentation(50_000_000n, 6)).toEqual({
      label: 'Rare pull',
      rarity: 'rare',
    });
  });
});
