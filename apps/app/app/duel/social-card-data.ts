export const duelStatuses = [
  'waiting',
  'matched',
  'funded',
  'opening',
  'awaiting_assets',
  'settled',
  'refunded',
  'cancelled',
  'expired',
  'failed',
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
  opponentType: 'wallet' | 'house';
  playerCard: string;
  playerValue: number;
  opponentCard: string;
  opponentValue: number;
  totalValue: number;
  winner: string;
  valuationPolicy: string;
  network: 'devnet';
};

export type DuelAction = {
  href: string;
  label: string;
};

const statusPresentation: Record<DuelStatus, StatusPresentation> = {
  waiting: {
    accent: '#d8ff3e',
    badge: 'CHALLENGE OPEN',
    headline: 'Take the other pack.',
    subline: 'Accept this $50 challenge before the seat expires.',
  },
  matched: {
    accent: '#53e6ff',
    badge: 'OPPONENT FOUND',
    headline: 'Two wallets. One vault.',
    subline: 'The seats are assigned and both commitments are due.',
  },
  funded: {
    accent: '#55f0a6',
    badge: 'BOTH SIDES FUNDED',
    headline: 'The duel is locked.',
    subline: 'Neither side can back out. Both packs are being prepared.',
  },
  opening: {
    accent: '#b68cff',
    badge: 'RIPPING NOW',
    headline: 'Both packs are opening.',
    subline: 'The outcomes stay hidden until both results are committed.',
  },
  awaiting_assets: {
    accent: '#f7c948',
    badge: 'SETTLEMENT PENDING',
    headline: 'Winner verified. Cards moving.',
    subline: 'The result is final; devnet is confirming both asset transfers.',
  },
  settled: {
    accent: '#d8ff3e',
    badge: 'DUEL SETTLED',
    headline: 'Umbreon takes the vault.',
    subline: 'The higher committed value won both cards on Solana devnet.',
  },
  refunded: {
    accent: '#62a8ff',
    badge: 'FUNDS RETURNED',
    headline: 'This duel was refunded.',
    subline: 'The recovery path closed safely and returned both deposits.',
  },
  cancelled: {
    accent: '#9aa3ad',
    badge: 'DUEL CANCELLED',
    headline: 'No cards changed hands.',
    subline: 'The challenge closed before both wallets committed.',
  },
  expired: {
    accent: '#9aa3ad',
    badge: 'CHALLENGE EXPIRED',
    headline: 'This seat timed out.',
    subline: 'The creator can open a fresh challenge without stale commitments.',
  },
  failed: {
    accent: '#ff6b6b',
    badge: 'RECOVERY REQUIRED',
    headline: 'The duel did not settle.',
    subline: 'No winner is claimed while transaction reconciliation is incomplete.',
  },
};

export function isDuelStatus(value: string): value is DuelStatus {
  return duelStatuses.includes(value as DuelStatus);
}

export function resolveDuelStatus(value: string | string[] | undefined): DuelStatus {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === 'won' || candidate === 'lost') return 'settled';
  return candidate && isDuelStatus(candidate) ? candidate : 'waiting';
}

export function getDuelSocialSnapshot(duelId: string, status: DuelStatus): DuelSocialSnapshot {
  return {
    duelId,
    status,
    tier: 50,
    player: '8xK4…p2Te',
    opponent: 'Boba.sol',
    opponentType: 'wallet',
    playerCard: 'Umbreon VMAX',
    playerValue: 1380,
    opponentCard: 'Blastoise',
    opponentValue: 615,
    totalValue: 1995,
    winner: '8xK4…p2Te',
    valuationPolicy: 'Mock insured value · devnet v1',
    network: 'devnet',
    ...statusPresentation[status],
  };
}

export function getPrimaryAction(snapshot: DuelSocialSnapshot): DuelAction {
  if (snapshot.status === 'waiting') {
    return {
      href: `/overview?challenge=${encodeURIComponent(snapshot.duelId)}`,
      label: 'Accept challenge',
    };
  }
  if (snapshot.status === 'settled') {
    return {
      href: `/overview?rematch=${encodeURIComponent(snapshot.duelId)}`,
      label: 'Run a rematch',
    };
  }
  if (['matched', 'funded', 'opening', 'awaiting_assets'].includes(snapshot.status)) {
    return {
      href: `/duel/${encodeURIComponent(snapshot.duelId)}?status=${snapshot.status}`,
      label: 'Watch live',
    };
  }
  return { href: '/overview', label: 'Open a new duel' };
}

export function getSocialDescription(snapshot: DuelSocialSnapshot): string {
  if (snapshot.status === 'settled') {
    return `${snapshot.playerCard} ($${snapshot.playerValue.toLocaleString()}) faced ${snapshot.opponentCard} ($${snapshot.opponentValue.toLocaleString()}) in a $${snapshot.tier} Pack Duel.`;
  }

  return snapshot.subline;
}
