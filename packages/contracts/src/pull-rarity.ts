/**
 * Presentation-only rarity tiers derived from committed insured value.
 *
 * Rarity must never participate in a canonical result hash, odds, valuation,
 * or settlement. It only controls how an already-decided pull is presented.
 */

export const PULL_RARITY_SCHEMA_VERSION = 'dailydraft.pull-rarity.v1' as const;

export type PullRarity = 'common' | 'uncommon' | 'rare' | 'chase';

export type PullRarityPresentation = {
  label: string;
  rarity: PullRarity;
};

export const PULL_RARITY_FLOORS_USD = [
  { minUsd: 150, rarity: 'chase' },
  { minUsd: 50, rarity: 'rare' },
  { minUsd: 10, rarity: 'uncommon' },
] as const satisfies ReadonlyArray<{ minUsd: number; rarity: PullRarity }>;

const rarityLabels: Record<PullRarity, string> = {
  chase: 'Chase pull',
  common: 'Common pull',
  rare: 'Rare pull',
  uncommon: 'Uncommon pull',
};

export const pullRarityFixtures = {
  cases: [
    { decimals: null, expected: 'common', name: 'missing value data', valueMinor: null },
    { decimals: 6, expected: 'common', name: 'negative value', valueMinor: '-1' },
    { decimals: 6, expected: 'common', name: 'zero value', valueMinor: '0' },
    { decimals: 6, expected: 'common', name: 'below uncommon', valueMinor: '9999999' },
    { decimals: 6, expected: 'uncommon', name: 'uncommon floor', valueMinor: '10000000' },
    { decimals: 6, expected: 'uncommon', name: 'below rare', valueMinor: '49999999' },
    { decimals: 6, expected: 'rare', name: 'rare floor', valueMinor: '50000000' },
    { decimals: 6, expected: 'rare', name: 'below chase', valueMinor: '149999999' },
    { decimals: 6, expected: 'chase', name: 'chase floor', valueMinor: '150000000' },
    { decimals: 2, expected: 'chase', name: 'alternate decimals', valueMinor: '15000' },
  ],
  schemaVersion: PULL_RARITY_SCHEMA_VERSION,
} as const;

export function pullRarityFor(
  valueMinor: bigint | null | undefined,
  decimals: number | null | undefined,
): PullRarity {
  if (valueMinor === null || valueMinor === undefined || valueMinor <= 0n || decimals == null) {
    return 'common';
  }
  const safeDecimals = Math.max(0, Math.trunc(Number.isFinite(decimals) ? decimals : 0));
  const divisor = 10n ** BigInt(safeDecimals);
  const floor = PULL_RARITY_FLOORS_USD.find((tier) => valueMinor >= BigInt(tier.minUsd) * divisor);
  return floor?.rarity ?? 'common';
}

export function pullRarityLabel(rarity: PullRarity): string {
  return rarityLabels[rarity];
}

export function pullRarityPresentation(
  valueMinor: bigint | null | undefined,
  decimals: number | null | undefined,
): PullRarityPresentation {
  const rarity = pullRarityFor(valueMinor, decimals);
  return { label: rarityLabels[rarity], rarity };
}
