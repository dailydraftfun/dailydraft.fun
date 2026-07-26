import type { PullRarity } from '@dailydraft/contracts';

/** The card treatment is keyed by the same tiers the API serves on the wire. */
export type HoloCardRarity = PullRarity;

export const holoCardRarities = [
  'common',
  'uncommon',
  'rare',
  'chase',
] as const satisfies readonly HoloCardRarity[];

export const holoCardRarityProfiles: Record<
  HoloCardRarity,
  {
    foilLayers: number;
    label: string;
    treatment: 'etched' | 'full-spectrum' | 'prismatic' | 'silver';
  }
> = {
  common: {
    foilLayers: 1,
    label: 'Common',
    treatment: 'silver',
  },
  uncommon: {
    foilLayers: 2,
    label: 'Uncommon',
    treatment: 'etched',
  },
  rare: {
    foilLayers: 3,
    label: 'Rare holo',
    treatment: 'prismatic',
  },
  chase: {
    foilLayers: 4,
    label: 'Chase foil',
    treatment: 'full-spectrum',
  },
};
