export type GameAvailability = 'gated' | 'playable' | 'preview';

export type GameMode = {
  actionLabel: string;
  availability: GameAvailability;
  // Absent for modes with no fixture preview built yet, so the lobby renders the
  // gate status without linking to a route that would 404.
  detailsHref?: string;
  description: string;
  eyebrow: string;
  href: string | null;
  id: 'crash' | 'duels' | 'flip' | 'tournaments';
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

/**
 * Read as a literal static member access on purpose.
 *
 * Next.js substitutes `process.env.NEXT_PUBLIC_*` textually at build time, so
 * this cannot be rewritten as a destructure, a lookup by variable, or a default
 * parameter reading `process.env` — any of those compile to `undefined` in the
 * browser bundle and would silently pin the lobby to the gated copy.
 */
const PROVIDER_MODE = process.env.NEXT_PUBLIC_PROVIDER_MODE?.trim() ?? '';

/**
 * Mirror of the API's `gachaDevnetCapabilities`, with the server still the judge.
 *
 * The client cannot see the treasury configuration the server folds into its
 * acquisition and settlement gates, so this is a hint about which surface to
 * offer, never a claim that a rip will succeed. `/games/flip` re-reads
 * `GET /gacha/capability` and gates itself on the answer; the worst this can do
 * is route a player to a page that explains why the machine is closed.
 */
export function flipDevnetCapabilities(providerMode: string = PROVIDER_MODE): FlipCapabilities {
  const devnet = providerMode === 'dailydraft-devnet';
  return { acquisition: devnet, odds: devnet, provider: devnet, settlement: devnet };
}

export const FLIP_DEVNET_CAPABILITIES = Object.freeze(flipDevnetCapabilities());

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
    actionLabel: 'Collector Crypt gate pending',
    availability: 'preview',
    href: null,
  };
}

/**
 * Modes whose gates are policy decisions rather than configuration.
 *
 * Declared ahead of `buildGameModes` because `gameModes` calls it during module
 * evaluation, which would hit the temporal dead zone if this sat below.
 */
const GATED_GAME_MODES: readonly GameMode[] = [
  {
    actionLabel: 'Match-data gate pending',
    availability: 'gated',
    description:
      'Hold the players you rip and auto-enter tournaments that lock at kickoff and settle on live match data. Top finishers by position pay out, weighted by the cards you hold.',
    eyebrow: 'Flagship · in design',
    href: null,
    id: 'tournaments',
    name: 'Fantasy Tournaments',
    playerLoop: 'Hold your squad · lock at kickoff · score on real games',
    trustContract:
      'No entries until the match-data oracle, snapshot lock, and payout math are approved.',
  },
  {
    actionLabel: 'Rules gate pending',
    availability: 'gated',
    detailsHref: '/games/crash',
    description:
      'Build a streak through card stages, choosing to continue or cash out before a committed bust condition ends the run.',
    eyebrow: 'Architecture gate',
    href: null,
    id: 'crash',
    name: 'Card Streak',
    playerLoop: 'Open a stage · continue or cash out · preserve the receipt',
    trustContract: 'Live economics, custody, timeouts, and risk limits must be approved first.',
  },
] as const;

/**
 * Build the lobby from a given set of Flip gates.
 *
 * Flip's row is the only one that moves with the environment, and taking the
 * gates as an argument keeps that movement out of module scope: tests describe
 * the environment they mean instead of inheriting whichever `.env` the machine
 * happens to carry.
 */
export function buildGameModes(
  flipCapabilities: FlipCapabilities = FLIP_DEVNET_CAPABILITIES,
): readonly GameMode[] {
  const flip = resolveFlipAvailability(flipCapabilities);
  const flipIsLive = flip.availability === 'playable';

  return [
    {
      actionLabel: 'Enter duel arena',
      availability: 'playable',
      detailsHref: '/overview',
      description:
        'Open identical sports pack tiers against a wallet or the house. The higher graded card value wins the duel.',
      eyebrow: 'Live devnet mode',
      href: '/overview',
      id: 'duels',
      name: 'Card Duels',
      playerLoop: 'Choose a tier · find a rival · reveal together',
      trustContract: 'Capability-gated packs, durable duel state, and public receipts.',
    },
    {
      ...flip,
      detailsHref: '/games/flip',
      description:
        'Rip a real, vaulted Collector Crypt sports pack — football, soccer, baseball, or basketball — from a committed inventory pool with versioned pull odds and a finalized on-chain acquisition.',
      // The gated copy names Collector Crypt because that is what production is
      // waiting on. On devnet the inventory is DailyDraft's own, so promising a
      // Collector Crypt pack there would be a lie in the other direction.
      eyebrow: flipIsLive ? 'Live devnet mode' : 'Collector Crypt · next',
      id: 'flip',
      name: 'Sports Pack Gacha',
      playerLoop: 'Pick a sport · commit the rip · reveal your card',
      trustContract: flipIsLive
        ? 'Committed odds, sealed inventory, and a verified deposit before any reveal.'
        : 'No live rip until Collector Crypt inventory, odds, and acquisition gates pass.',
    },
    ...GATED_GAME_MODES,
  ];
}

export const gameModes: readonly GameMode[] = buildGameModes();

export function playableGameModes(modes: readonly GameMode[] = gameModes): GameMode[] {
  return modes.filter((mode) => mode.availability === 'playable' && mode.href !== null);
}
