export type PullRarity = 'common' | 'uncommon' | 'rare' | 'chase';

export type PullRarityPresentation = {
  label: string;
  rarity: PullRarity;
};

/**
 * Presentation-only tiers derived from the committed insured value.
 *
 * These never participate in the canonical result hash. The API commits
 * `insuredValue` before any animation runs, so mapping that committed number
 * into a visual tier cannot change an outcome — it only decides how loudly the
 * already-decided pull is presented.
 */
const rarityFloorsUsd: ReadonlyArray<{ minUsd: number; rarity: PullRarity }> = [
  { minUsd: 150, rarity: 'chase' },
  { minUsd: 50, rarity: 'rare' },
  { minUsd: 10, rarity: 'uncommon' },
];

const rarityLabels: Record<PullRarity, string> = {
  chase: 'Chase pull',
  common: 'Common pull',
  rare: 'Rare pull',
  uncommon: 'Uncommon pull',
};

export function pullRarityFor(valueMinor: bigint, decimals: number): PullRarity {
  if (valueMinor <= 0n) return 'common';
  const safeDecimals = Math.max(0, Math.trunc(Number.isFinite(decimals) ? decimals : 0));
  const divisor = 10n ** BigInt(safeDecimals);
  const floor = rarityFloorsUsd.find((tier) => valueMinor >= BigInt(tier.minUsd) * divisor);
  return floor?.rarity ?? 'common';
}

export function pullRarityLabel(rarity: PullRarity): string {
  return rarityLabels[rarity];
}

export function pullRarityPresentation(
  valueMinor: bigint,
  decimals: number,
): PullRarityPresentation {
  const rarity = pullRarityFor(valueMinor, decimals);
  return { label: rarityLabels[rarity], rarity };
}
