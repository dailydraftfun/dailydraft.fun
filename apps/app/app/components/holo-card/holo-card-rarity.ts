// TODO(#208): Replace this local model with the shared contracts rarity once it lands.
export type HoloCardRarity = 'common' | 'uncommon' | 'rare' | 'chase';

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
