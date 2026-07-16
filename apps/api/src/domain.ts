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

export type PackProviderMode = 'collector-crypt-sandbox' | 'mock' | 'openpacksduel-devnet';

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
  providerMode: PackProviderMode;
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
  imageUrl?: string;
  insuredValue: Money;
  isMock: boolean;
  openedAt: string;
  provider: string;
  providerReference: string;
  poolVersion: string;
  resultHash: string;
  side: 'creator' | 'opponent';
  sourceTimestamp: string;
}

export interface DuelResult {
  comparisonMetric: 'insured-value';
  outcomes: DuelPackOutcome[];
  resultHash: string;
  settlementReady: boolean;
  tieRule: 'return-original-assets-and-refund-platform-fees';
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
  action: 'cancel' | 'commit_result' | 'fund' | 'open_pack' | 'refund' | 'settle';
  checkAttempts?: number;
  confirmationStatus?: 'confirmed' | 'finalized' | null;
  confirmedAt?: string | null;
  createdAt: string;
  duelId: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  expiresAt?: string | null;
  feeAmountLamports?: string | null;
  id: string;
  finalizedAt?: string | null;
  lastCheckedAt?: string | null;
  lastValidBlockHeight?: string | null;
  network: 'solana-devnet';
  providerReference?: string | null;
  recentBlockhash?: string | null;
  recoveredAt?: string | null;
  recoveryAlertCode?: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH' | null;
  recoveryCandidateAt?: string | null;
  recoveryCandidateSignature?: string | null;
  signature?: string | null;
  status: 'confirmed' | 'expired' | 'failed' | 'finalized' | 'prepared' | 'submitted';
  submittedAt?: string | null;
  stuckAt?: string | null;
  updatedAt: string;
  wallet: string;
}

export interface Page<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string | null;
}
