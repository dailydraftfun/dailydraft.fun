export type GameAvailability = 'gated' | 'playable' | 'preview';

export type GameMode = {
  actionLabel: string;
  availability: GameAvailability;
  description: string;
  eyebrow: string;
  href: string | null;
  id: 'crash' | 'duels' | 'flip' | 'tournaments';
  name: string;
  playerLoop: string;
  trustContract: string;
};

export const gameModes: readonly GameMode[] = [
  {
    actionLabel: 'Enter duel arena',
    availability: 'playable',
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
    actionLabel: 'Collector Crypt gate pending',
    availability: 'preview',
    description:
      'Rip a real, vaulted Collector Crypt sports pack — football, soccer, baseball, or basketball — from a committed inventory pool with versioned pull odds and a finalized on-chain acquisition.',
    eyebrow: 'Collector Crypt · next',
    href: null,
    id: 'flip',
    name: 'Sports Pack Gacha',
    playerLoop: 'Pick a sport · commit the rip · reveal your card',
    trustContract: 'No live rip until Collector Crypt inventory, odds, and acquisition gates pass.',
  },
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
    trustContract: 'No entries until the match-data oracle, snapshot lock, and payout math are approved.',
  },
  {
    actionLabel: 'Rules gate pending',
    availability: 'gated',
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

export function playableGameModes(modes: readonly GameMode[] = gameModes): GameMode[] {
  return modes.filter((mode) => mode.availability === 'playable' && mode.href !== null);
}
