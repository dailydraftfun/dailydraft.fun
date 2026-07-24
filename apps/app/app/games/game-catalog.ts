export type GameAvailability = 'gated' | 'playable' | 'preview';

export type GameMode = {
  actionLabel: string;
  availability: GameAvailability;
  detailsHref: string;
  description: string;
  eyebrow: string;
  href: string | null;
  id: 'crash' | 'duels' | 'flip';
  name: string;
  playerLoop: string;
  trustContract: string;
};

export type FlipCapabilities = {
  acquisition: boolean;
  odds: boolean;
  provider: boolean;
  settlement: boolean;
};

export const FLIP_DEVNET_CAPABILITIES = Object.freeze({
  acquisition: false,
  odds: false,
  provider: false,
  settlement: false,
} satisfies FlipCapabilities);

export function resolveFlipAvailability(caps: FlipCapabilities): {
  actionLabel: string;
  availability: GameAvailability;
  href: string | null;
} {
  if (caps.provider && caps.odds && caps.acquisition && caps.settlement) {
    return {
      actionLabel: 'Rip a sports pack',
      availability: 'playable',
      href: '/games/flip',
    };
  }
  return {
    actionLabel: 'Provider gate pending',
    availability: 'preview',
    href: null,
  };
}

export const gameModes: readonly GameMode[] = [
  {
    actionLabel: 'Enter duel arena',
    availability: 'playable',
    detailsHref: '/overview',
    description:
      'Open identical pack tiers against a wallet or the house. The higher committed card value wins the duel.',
    eyebrow: 'Live devnet mode',
    href: '/overview',
    id: 'duels',
    name: 'Duels',
    playerLoop: 'Choose a tier · find a rival · reveal together',
    trustContract: 'Capability-gated packs, durable duel state, and public receipts.',
  },
  {
    ...resolveFlipAvailability(FLIP_DEVNET_CAPABILITIES),
    detailsHref: '/games/flip',
    description:
      'A solo card gacha built from a committed eligible inventory pool, versioned probability bands, and a finalized acquisition reveal.',
    eyebrow: 'Fixture-backed next',
    id: 'flip',
    name: 'Flip Gacha',
    playerLoop: 'Choose a pool · commit the draw · reveal ownership',
    trustContract: 'No live purchase until inventory, probability, and acquisition gates pass.',
  },
  {
    actionLabel: 'Rules gate pending',
    availability: 'gated',
    detailsHref: '/games/crash',
    description:
      'Build a run through card stages, choosing to continue or cash out before a committed bust condition ends the session.',
    eyebrow: 'Architecture gate',
    href: null,
    id: 'crash',
    name: 'Crash',
    playerLoop: 'Open a stage · continue or cash out · preserve the receipt',
    trustContract: 'Live economics, custody, timeouts, and risk limits must be approved first.',
  },
] as const;

export function playableGameModes(modes: readonly GameMode[] = gameModes): GameMode[] {
  return modes.filter((mode) => mode.availability === 'playable' && mode.href !== null);
}
