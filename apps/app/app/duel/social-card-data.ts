export const duelStatuses = [
  'waiting',
  'matched',
  'opening',
  'won',
  'lost',
  'refunded',
  'cancelled',
] as const;

export type DuelStatus = (typeof duelStatuses)[number];

type StatusPresentation = {
  accent: string;
  badge: string;
  headline: string;
  subline: string;
};

export type DuelSocialSnapshot = StatusPresentation & {
  duelId: string;
  status: DuelStatus;
  tier: number;
  player: string;
  opponent: string;
  playerCard: string;
  playerValue: number;
  opponentCard: string;
  opponentValue: number;
  totalValue: number;
};

const statusPresentation: Record<DuelStatus, StatusPresentation> = {
  waiting: {
    accent: '#d8ff3e',
    badge: 'WAITING FOR A RIVAL',
    headline: 'A $50 Pack Duel is open.',
    subline: 'Take the other seat and rip together on Solana.',
  },
  matched: {
    accent: '#53e6ff',
    badge: 'OPPONENT FOUND',
    headline: 'Two wallets. One vault.',
    subline: 'Both players are locked in. Packs open when escrow confirms.',
  },
  opening: {
    accent: '#b68cff',
    badge: 'RIPPING NOW',
    headline: 'The packs are opening.',
    subline: 'Two authenticated pulls reveal on the same beat.',
  },
  won: {
    accent: '#d8ff3e',
    badge: 'DUEL WON',
    headline: 'Umbreon takes the vault.',
    subline: 'The higher verified pull wins every card in the duel.',
  },
  lost: {
    accent: '#ff8f70',
    badge: 'DUEL SETTLED',
    headline: 'The vault went to the rival.',
    subline: 'Rematch the wallet and run the reveal back.',
  },
  refunded: {
    accent: '#62a8ff',
    badge: 'FUNDS RETURNED',
    headline: 'This duel was refunded.',
    subline: 'The timeout path closed safely and returned both deposits.',
  },
  cancelled: {
    accent: '#9aa3ad',
    badge: 'DUEL CANCELLED',
    headline: 'No cards changed hands.',
    subline: 'This challenge closed before both wallets funded escrow.',
  },
};

export function isDuelStatus(value: string): value is DuelStatus {
  return duelStatuses.includes(value as DuelStatus);
}

export function resolveDuelStatus(value: string | string[] | undefined): DuelStatus {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && isDuelStatus(candidate) ? candidate : 'waiting';
}

export function getDuelSocialSnapshot(duelId: string, status: DuelStatus): DuelSocialSnapshot {
  return {
    duelId,
    status,
    tier: 50,
    player: '8xK4…p2Te',
    opponent: 'Boba.sol',
    playerCard: 'Umbreon VMAX',
    playerValue: 1380,
    opponentCard: 'Blastoise',
    opponentValue: 615,
    totalValue: 1995,
    ...statusPresentation[status],
  };
}

export function getSocialDescription(snapshot: DuelSocialSnapshot): string {
  if (snapshot.status === 'won' || snapshot.status === 'lost') {
    return `${snapshot.playerCard} ($${snapshot.playerValue.toLocaleString()}) faced ${snapshot.opponentCard} ($${snapshot.opponentValue.toLocaleString()}) in a $${snapshot.tier} Pack Duel.`;
  }

  return snapshot.subline;
}
