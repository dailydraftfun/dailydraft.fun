export const PACK_TIER_CATALOG = [
  {
    comingSoonReason: 'The $25 pack tier is coming soon.',
    id: 'pokemon_25',
    name: 'Pokémon $25 Pack',
    supported: false,
    tier: 25,
  },
  {
    comingSoonReason: null,
    id: 'pokemon_50',
    name: 'Pokémon $50 Pack',
    supported: true,
    tier: 50,
  },
  {
    comingSoonReason: 'The $100 pack tier is coming soon.',
    id: 'pokemon_100',
    name: 'Pokémon $100 Pack',
    supported: false,
    tier: 100,
  },
] as const;
