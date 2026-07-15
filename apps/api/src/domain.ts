export interface Money {
  amount: string;
  currency: 'USDC';
  decimals: 6;
}

export interface Pack {
  active: boolean;
  id: string;
  imageUrl?: string;
  name: string;
  price: Money;
  provider: string;
  providerPackId?: string;
  valuationPolicyHash?: string;
}

export type MatchmakingMode = 'direct' | 'house' | 'open';

export type DuelStatus =
  | 'waiting'
  | 'matched'
  | 'committing'
  | 'funded'
  | 'opening'
  | 'awaiting_assets'
  | 'settling'
  | 'settled'
  | 'cancelling'
  | 'cancelled'
  | 'refunding'
  | 'refunded'
  | 'failed';

export interface Duel {
  cancellationReason?: string | null;
  createdAt: string;
  creatorWallet: string;
  environment: 'solana-devnet';
  escrowAddress?: string | null;
  expiresAt: string;
  houseOpponent: boolean;
  id: string;
  matchmakingMode: MatchmakingMode;
  opponentJoinedAt?: string | null;
  opponentWallet?: string | null;
  pack: Pack;
  providerMode: 'collector-crypt-sandbox' | 'mock';
  result?: DuelResult | null;
  stake: Money;
  status: DuelStatus;
  transactionSignature?: string | null;
  updatedAt?: string;
  version: number;
  winnerWallet?: string | null;
}

export interface DuelPackOutcome {
  assetReference: string;
  displayName: string;
  insuredValue: Money;
  isMock: boolean;
  resultHash: string;
  side: 'creator' | 'opponent';
}

export interface DuelResult {
  comparisonMetric: 'insured-value';
  outcomes: DuelPackOutcome[];
  resultHash: string;
  settlementReady: boolean;
  valuationPolicyHash: string;
  winnerSide: 'creator' | 'opponent' | null;
}

export interface DuelEvent {
  actorWallet?: string | null;
  createdAt: string;
  data?: Record<string, unknown> | null;
  duelId: string;
  fromStatus?: DuelStatus | null;
  id: string;
  sequence: number;
  toStatus?: DuelStatus | null;
  type: string;
}

export interface DuelTransactionRecord {
  action: 'cancel' | 'fund' | 'open_pack' | 'refund' | 'settle';
  confirmedAt?: string | null;
  createdAt: string;
  duelId: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  expiresAt?: string | null;
  id: string;
  lastValidBlockHeight?: string | null;
  network: 'solana-devnet';
  providerReference?: string | null;
  recentBlockhash?: string | null;
  signature?: string | null;
  status: 'confirmed' | 'expired' | 'failed' | 'prepared' | 'submitted';
  submittedAt?: string | null;
  updatedAt: string;
  wallet: string;
}

export interface Page<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string | null;
}
