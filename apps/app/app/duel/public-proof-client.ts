import 'server-only';

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

export type PublicMoney = { amount: string; currency: 'USDC'; decimals: 6 };

export type PublicParticipant = {
  address: string;
  display: string;
  role: 'creator' | 'house' | 'opponent';
};

export type PublicDuelReceipt = {
  actions: {
    primary: { href: string; label: string };
    rematch: { href: string; label: string } | null;
    share: { href: string; label: string };
  };
  availability: { complete: boolean; missing: string[] };
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
    providerMode: 'collector-crypt-sandbox' | 'mock';
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
      action: 'fund';
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
      insuredValue: PublicMoney;
      isMock: boolean;
      openedAt: string;
      poolVersion: string;
      resultHash: string;
      side: 'creator' | 'opponent';
      sourceTimestamp: string;
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
        providerMode: 'collector-crypt-sandbox' | 'mock';
      };
      creatorResultHash: string;
      opponentResultHash: string;
      poolVersion: string;
      providerAttestation: {
        required: boolean;
        status: 'mock-not-applicable' | 'not-recorded';
      };
      schemaVersion: 'openpacksduel.result-proof.v1';
    };
    resultHash: string;
    settlementReady: boolean;
    totalValue: PublicMoney;
    valuationPolicyHash: string;
    winner: PublicParticipant | null;
    winnerSide: 'creator' | 'opponent' | null;
  } | null;
  schemaVersion: 'openpacksduel.receipt.v1';
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
  schemaVersion: 'openpacksduel.profile.v1';
  wallet: { address: string; display: string };
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

export function publicReceiptDownloadUrl(duelId: string): string {
  return `${apiBaseUrl}/duels/${encodeURIComponent(duelId)}/receipt`;
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

export function formatPublicMoney(money: PublicMoney): string {
  const value = BigInt(money.amount);
  const divisor = 10n ** BigInt(money.decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(money.decimals, '0').replace(/0+$/, '');
  return `${money.currency} ${whole.toLocaleString()}${fraction ? `.${fraction}` : ''}`;
}
