export const PUBLIC_GAME_READINESS_STATES = [
  'playable',
  'preview',
  'degraded',
  'unavailable',
] as const;

export type PublicGameReadinessState = (typeof PUBLIC_GAME_READINESS_STATES)[number];

export const PUBLIC_GAME_TAXONOMY = [
  {
    canonicalHref: '/games/duel',
    description:
      'Compare two committed card outcomes after explicit devnet wallet review and preserve the result in a durable receipt.',
    id: 'duel',
    name: 'Card Duel',
    rulesHref: '/games/duel#rules',
    runtime: true,
    statusLabel: 'Runtime checked · devnet',
  },
  {
    canonicalHref: '/games/gacha',
    description:
      'Rip a sports pack from the server-committed devnet pool when provider, payment, acquisition, and settlement capabilities are verified.',
    id: 'gacha',
    name: 'Sports Pack Gacha',
    rulesHref: '/games/gacha',
    runtime: true,
    statusLabel: 'Runtime checked · devnet',
  },
  {
    canonicalHref: '/games/marketplace-flip',
    description:
      'Inspect a scripted marketplace walkthrough without inventory reservation, purchase, custody, or settlement.',
    id: 'flip',
    name: 'Marketplace Flip',
    rulesHref: '/games/marketplace-flip#rules',
    runtime: false,
    statusLabel: 'Fixture preview',
  },
  {
    canonicalHref: '/games/crash',
    description:
      'Run a fixed continue-or-stop card sequence without live odds, custody, or payout claims.',
    id: 'crash',
    name: 'Card Streak',
    rulesHref: '/games/crash#rules',
    runtime: false,
    statusLabel: 'Fixture preview',
  },
] as const;

export type PublicGameTaxonomyEntry = (typeof PUBLIC_GAME_TAXONOMY)[number];
export type PublicGameTaxonomyId = PublicGameTaxonomyEntry['id'];

export const PUBLIC_GAME_TAXONOMY_BY_ID = Object.fromEntries(
  PUBLIC_GAME_TAXONOMY.map((mode) => [mode.id, mode]),
) as {
  [ModeId in PublicGameTaxonomyId]: Extract<PublicGameTaxonomyEntry, { id: ModeId }>;
};

export function isPublicGameTaxonomyId(value: string): value is PublicGameTaxonomyId {
  return PUBLIC_GAME_TAXONOMY.some((mode) => mode.id === value);
}
