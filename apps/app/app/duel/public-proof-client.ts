import 'server-only';

import type { PublicMoneyValue } from './public-money';

export { formatPublicMoney } from './public-money';

export type PublicDuelStatus =
  | 'awaiting_assets'
  | 'cancelled'
  | 'cancelling'
  | 'committing'
  | 'expired'
  | 'failed'
  | 'funded'
  | 'matched'
  | 'opening'
  | 'refunded'
  | 'refunding'
  | 'settled'
  | 'settling'
  | 'waiting';

export type PublicMoney = PublicMoneyValue;
export type PublicProviderMode = 'collector-crypt-sandbox' | 'mock' | 'dailydraft-devnet';

export type PublicParticipant = {
  address: string;
  display: string;
  role: 'creator' | 'house' | 'opponent';
};

export type PublicPostDuelCardAction = {
  action: 'keep' | 'list' | 'redeem' | 'sell-back';
  alternative: { action: 'keep'; label: 'Keep card' } | null;
  availability: 'available' | 'unavailable';
  capability:
    | 'collector-crypt-buyback'
    | 'collector-crypt-marketplace-listing'
    | 'collector-crypt-shipping'
    | 'ownership-receipt';
  detail: string;
  label: string;
  reason: 'partner-onboarding-required' | null;
  requiresSignature: false;
  transaction: null;
};

export type PublicPostDuelCardActionState = {
  actionStateId: string;
  actions: PublicPostDuelCardAction[];
  assetReference: string;
  displayName: string;
  imageUrl: string | null;
  duelId: string;
  insuredValue: PublicMoney;
  owner: PublicParticipant;
  ownership: {
    basis: 'finalized-settlement-reference';
    settlementSignature: string;
    status: 'reconciled';
  };
  providerReference: string;
  receiptHref: string;
  side: 'creator' | 'opponent';
};

export type PublicDuelReceipt = {
  actions: {
    primary: { href: string; label: string };
    rematch: { href: string; label: string } | null;
    share: { href: string; label: string };
  };
  availability: { complete: boolean; missing: string[] };
  cardActions: {
    availability: 'available' | 'hidden';
    cards: PublicPostDuelCardActionState[];
    reason: 'duel-not-settled' | 'mock-assets' | 'ownership-mismatch' | 'ownership-pending' | null;
    receiptHref: string;
    schemaVersion: 'dailydraft.card-actions.v1';
  };
  custody: {
    cardAssets: { detail: string; status: string };
    platformFee: { asset: 'WSOL'; escrowAddress: string | null; status: string };
  };
  duel: {
    createdAt: string;
    expiresAt: string;
    id: string;
    mode: 'direct' | 'house' | 'open';
    network: 'solana-devnet';
    observedAt: string;
    status: PublicDuelStatus;
  };
  fees: {
    asset: 'WSOL';
    finalizedSides: number;
    perSideAmountLamports: string | null;
    requiredSides: 2;
    totalFinalizedAmountLamports: string | null;
  };
  pack: {
    id: string;
    name: string;
    provider: string;
    providerMode: PublicProviderMode;
    providerPackId: string | null;
    tier: PublicMoney;
  };
  participants: { creator: PublicParticipant; opponent: PublicParticipant | null };
  privacy: { indexable: false; reason: string };
  references: {
    provider: Array<{
      assetReference: string;
      provider: string;
      providerReference: string;
      side: 'creator' | 'opponent';
    }>;
    solana: Array<{
      action: string;
      bindingSource: 'api-submission' | 'rpc-recovery';
      explorerUrl: string;
      finalizedAt: string | null;
      recoveredAt: string | null;
      signature: string;
      status: string;
    }>;
  };
  recovery: {
    alerts: Array<{
      action: 'commit_result' | 'fund' | 'settle';
      code: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH';
      detectedAt: string;
      explorerUrl: string;
      signature: string;
    }>;
    status: 'attention-required' | 'none' | 'recovered';
  };
  result: {
    comparisonMetric: 'insured-value';
    margin: PublicMoney;
    outcomes: Array<{
      assetReference: string;
      displayName: string;
      imageUrl: string | null;
      insuredValue: PublicMoney;
      isMock: boolean;
      openedAt: string;
      poolVersion: string;
      resultHash: string;
      side: 'creator' | 'opponent';
      sourceTimestamp: string;
      valuationSourceReference: string | null;
    }>;
    policy: {
      authoritativeField: string;
      currency: 'USDC';
      decimals: 6;
      hash: string;
      hashAlgorithm: 'sha256';
      maxSourceAgeSeconds: number;
      maxValueMinorUnits: string;
      policyVersion: string;
      rounding: 'none';
      tieRule: 'return-original-assets-and-refund-platform-fees';
    };
    proof: {
      context: {
        creatorWallet: string;
        duelId: string;
        escrowAddress: string;
        network: 'solana-devnet';
        opponentWallet: string;
        providerMode: PublicProviderMode;
      };
      creatorResultHash: string;
      opponentResultHash: string;
      poolVersion: string;
      providerAttestation: {
        required: boolean;
        scope: 'escrow-mints-values-policy' | 'none';
        status: 'mock-not-applicable' | 'not-recorded' | 'on-chain-commitment-finalized';
      };
      schemaVersion: 'dailydraft.result-proof.v1';
    };
    resultHash: string;
    settlementReady: boolean;
    totalValue: PublicMoney;
    valuationPolicyHash: string;
    winner: PublicParticipant | null;
    winnerSide: 'creator' | 'opponent' | null;
  } | null;
  schemaVersion: 'dailydraft.receipt.v1';
};

export type PublicWalletProfile = {
  biggestWin: { duelId: string; prizeValue: PublicMoney } | null;
  duels: Array<{
    createdAt: string;
    duelId: string;
    opponentDisplay: string | null;
    packName: string;
    receiptHref: string;
    rematchHref: string | null;
    result: 'loss' | 'none' | 'win';
    status: PublicDuelStatus;
    tier: PublicMoney;
  }>;
  pagination: { hasMore: boolean; sampleLimit: number };
  privacy: { indexable: false; reason: string };
  record: {
    active: number;
    cancelledOrExpired: number;
    completed: number;
    losses: number;
    refunded: number;
    total: number;
    wins: number;
  };
  schemaVersion: 'dailydraft.profile.v1';
  wallet: { address: string; display: string };
};

export type PublicDuelLeaderboard = {
  entries: Array<{
    display: string;
    lastPlayedAt: string;
    profileHref: string;
    rank: number;
    record: {
      completed: number;
      losses: number;
      ties: number;
      wins: number;
    };
    totalWonValue: PublicMoney;
  }>;
  methodology: {
    entryLimit: number;
    excludesMockResults: true;
    hasMoreSettledDuels: boolean;
    ranking: 'wins-total-value-completed-recency';
    sampleLimit: number;
    sampledSettledDuels: number;
  };
  privacy: { indexable: false; reason: string };
  schemaVersion: 'dailydraft.leaderboard.v1';
};

const apiBaseUrl = (process.env.NEXT_PUBLIC_DUEL_API_URL ?? 'http://localhost:3003/v1').replace(
  /\/$/,
  '',
);

export async function fetchPublicDuelReceipt(duelId: string): Promise<PublicDuelReceipt | null> {
  return fetchPublicJson<PublicDuelReceipt>(
    `${apiBaseUrl}/duels/${encodeURIComponent(duelId)}/receipt`,
  );
}

export async function fetchPublicWalletProfile(
  wallet: string,
): Promise<PublicWalletProfile | null> {
  return fetchPublicJson<PublicWalletProfile>(
    `${apiBaseUrl}/profiles/${encodeURIComponent(wallet)}`,
  );
}

export async function fetchPublicDuelLeaderboard(): Promise<PublicDuelLeaderboard | null> {
  return fetchPublicJson<PublicDuelLeaderboard>(`${apiBaseUrl}/leaderboard`);
}

async function fetchPublicJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
