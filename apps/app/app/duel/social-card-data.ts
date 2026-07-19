import type { PublicDuelReceipt, PublicDuelStatus, PublicMoney } from './public-proof-client';

export const duelStatuses = [
  'waiting',
  'matched',
  'committing',
  'funded',
  'opening',
  'awaiting_assets',
  'settling',
  'settled',
  'refunding',
  'refunded',
  'cancelling',
  'cancelled',
  'expired',
  'failed',
] as const satisfies readonly PublicDuelStatus[];

export type DuelStatus = (typeof duelStatuses)[number];

export type StatusPresentation = {
  accent: string;
  badge: string;
  headline: string;
  subline: string;
};

export type DuelSocialPull = {
  displayName: string;
  side: 'creator' | 'opponent';
  value: string;
  winner: boolean;
};

export type DuelSocialSnapshot = StatusPresentation & {
  duelId: string;
  mockPreview: boolean;
  network: 'devnet';
  opponent: string;
  opponentType: 'house' | 'wallet';
  primaryAction: DuelAction;
  player: string;
  pulls: DuelSocialPull[];
  requestedStatusMatches: boolean;
  status: DuelStatus;
  tier: string;
  totalValue: string | null;
  valuationPolicy: string | null;
  winner: string | null;
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
    subline: 'Accept this challenge before the seat expires.',
  },
  matched: {
    accent: '#53e6ff',
    badge: 'OPPONENT FOUND',
    headline: 'Two wallets. One vault.',
    subline: 'The seats are assigned and both commitments are due.',
  },
  committing: {
    accent: '#53e6ff',
    badge: 'FUNDING ESCROW',
    headline: 'Both wallets are committing.',
    subline: 'The duel advances only after both devnet transactions finalize.',
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
    badge: 'ASSETS PENDING',
    headline: 'Pulls verified. Cards moving.',
    subline: 'The result is committed while both card assets enter settlement.',
  },
  settling: {
    accent: '#f7c948',
    badge: 'SETTLEMENT PENDING',
    headline: 'Winner verified. Cards moving.',
    subline: 'Devnet is confirming the final ownership transfer.',
  },
  settled: {
    accent: '#d8ff3e',
    badge: 'DUEL SETTLED',
    headline: 'The vault has a winner.',
    subline: 'The higher committed value won both cards on Solana devnet.',
  },
  refunding: {
    accent: '#62a8ff',
    badge: 'REFUND IN PROGRESS',
    headline: 'Funds are returning.',
    subline: 'Devnet is confirming the recovery transaction.',
  },
  refunded: {
    accent: '#62a8ff',
    badge: 'FUNDS RETURNED',
    headline: 'This duel was refunded.',
    subline: 'The recovery path closed safely and returned both deposits.',
  },
  cancelling: {
    accent: '#9aa3ad',
    badge: 'CANCELLING',
    headline: 'This duel is closing.',
    subline: 'No winner is claimed while cancellation is pending.',
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

export function getDuelStatusPresentation(status: DuelStatus): StatusPresentation {
  return statusPresentation[status];
}

export function isDuelStatus(value: string): value is DuelStatus {
  return duelStatuses.includes(value as DuelStatus);
}

export function resolveDuelStatus(value: string | string[] | undefined): DuelStatus | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === 'won' || candidate === 'lost') return 'settled';
  return candidate && isDuelStatus(candidate) ? candidate : null;
}

export function isMockDuelResult(receipt: PublicDuelReceipt): boolean {
  return Boolean(
    receipt.result &&
      (receipt.pack.providerMode === 'mock' ||
        receipt.result.outcomes.some((outcome) => outcome.isMock)),
  );
}

export function getDuelSocialSnapshot(
  receipt: PublicDuelReceipt,
  requestedStatus?: DuelStatus | null,
): DuelSocialSnapshot {
  const status = receipt.duel.status;
  const winner = receipt.result?.winner ?? null;
  const mockPreview = isMockDuelResult(receipt);
  const pulls = (receipt.result?.outcomes ?? []).map((outcome) => ({
    displayName: outcome.displayName,
    side: outcome.side,
    value: formatMoney(outcome.insuredValue),
    winner: outcome.side === receipt.result?.winnerSide,
  }));
  const presentation = getDuelStatusPresentation(status);

  return {
    duelId: receipt.duel.id,
    mockPreview,
    network: 'devnet',
    opponent: receipt.participants.opponent?.display ?? 'Waiting for opponent',
    opponentType: receipt.duel.mode === 'house' ? 'house' : 'wallet',
    primaryAction: { ...receipt.actions.primary },
    player: receipt.participants.creator.display,
    pulls,
    requestedStatusMatches: requestedStatus == null || requestedStatus === status,
    status,
    tier: formatMoney(receipt.pack.tier),
    totalValue: receipt.result ? formatMoney(receipt.result.totalValue) : null,
    valuationPolicy: receipt.result
      ? `${receipt.result.policy.authoritativeField} · ${receipt.result.policy.policyVersion}`
      : null,
    winner: winner?.display ?? null,
    ...presentation,
    ...(mockPreview
      ? {
          badge: 'Devnet preview',
          headline: 'Devnet result preview.',
          subline: 'Committed mock values do not represent purchased cards or transferred assets.',
        }
      : status === 'settled' && winner
        ? { headline: `${winner.display} won the vault.` }
        : status === 'settled' && receipt.result
          ? { headline: 'The duel ended in a tie.' }
          : {}),
  };
}

export function getPrimaryAction(snapshot: DuelSocialSnapshot): DuelAction {
  return snapshot.primaryAction;
}

export function getSocialDescription(snapshot: DuelSocialSnapshot): string {
  if (snapshot.status === 'settled' && snapshot.pulls.length === 2) {
    return `${snapshot.pulls[0]?.displayName} (${snapshot.pulls[0]?.value}) faced ${snapshot.pulls[1]?.displayName} (${snapshot.pulls[1]?.value}) in a ${snapshot.tier} Pack Duel.`;
  }

  if (snapshot.status === 'waiting') {
    return `${snapshot.player} opened a ${snapshot.tier} challenge. ${snapshot.subline}`;
  }

  if (
    ['matched', 'committing', 'funded', 'opening', 'awaiting_assets', 'settling'].includes(
      snapshot.status,
    )
  ) {
    return `${snapshot.player} vs ${snapshot.opponent} in a ${snapshot.tier} Pack Duel. ${snapshot.subline}`;
  }

  return `${snapshot.headline} ${snapshot.subline}`;
}

function formatMoney(money: PublicMoney): string {
  const amount = BigInt(money.amount);
  const divisor = 10n ** BigInt(money.decimals);
  const whole = amount / divisor;
  const fractional = (amount % divisor).toString().padStart(money.decimals, '0').replace(/0+$/, '');
  return `$${whole.toLocaleString('en-US')}${fractional ? `.${fractional}` : ''}`;
}
