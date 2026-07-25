import { describe, expect, test } from 'bun:test';
import { pullRarityFor, pullRarityLabel, pullRarityPresentation } from './pull-rarity';

describe('pullRarityFor', () => {
  test('treats a zero or negative committed value as common', () => {
    expect(pullRarityFor(0n, 6)).toBe('common');
    expect(pullRarityFor(-1n, 6)).toBe('common');
  });

  test('maps committed USDC minor units onto ascending tiers', () => {
    expect(pullRarityFor(4_990_000n, 6)).toBe('common');
    expect(pullRarityFor(10_000_000n, 6)).toBe('uncommon');
    expect(pullRarityFor(41_000_000n, 6)).toBe('uncommon');
    expect(pullRarityFor(50_000_000n, 6)).toBe('rare');
    expect(pullRarityFor(72_500_000n, 6)).toBe('rare');
    expect(pullRarityFor(150_000_000n, 6)).toBe('chase');
    expect(pullRarityFor(4_000_000_000n, 6)).toBe('chase');
  });

  test('holds each boundary exactly at the floor, not one unit under', () => {
    expect(pullRarityFor(9_999_999n, 6)).toBe('common');
    expect(pullRarityFor(49_999_999n, 6)).toBe('uncommon');
    expect(pullRarityFor(149_999_999n, 6)).toBe('rare');
  });

  test('scales the same thresholds across other decimal precisions', () => {
    expect(pullRarityFor(150n, 0)).toBe('chase');
    expect(pullRarityFor(50n, 0)).toBe('rare');
    expect(pullRarityFor(15_000_000_000n, 8)).toBe('chase');
  });

  test('falls back to a zero-decimal read when decimals are not usable', () => {
    expect(pullRarityFor(150n, Number.NaN)).toBe('chase');
    expect(pullRarityFor(150n, -3)).toBe('chase');
  });
});

describe('pullRarityLabel', () => {
  test('labels every tier without leaking gambling jargon', () => {
    const labels = [
      pullRarityLabel('common'),
      pullRarityLabel('uncommon'),
      pullRarityLabel('rare'),
      pullRarityLabel('chase'),
    ];
    expect(labels).toEqual(['Common pull', 'Uncommon pull', 'Rare pull', 'Chase pull']);
    for (const label of labels) {
      expect(label.toLowerCase()).not.toContain('odds');
      expect(label.toLowerCase()).not.toContain('jackpot');
      expect(label.toLowerCase()).not.toContain('win');
    }
  });
});

describe('pullRarityPresentation', () => {
  test('pairs the derived tier with its label', () => {
    expect(pullRarityPresentation(72_500_000n, 6)).toEqual({
      label: 'Rare pull',
      rarity: 'rare',
    });
  });
});
