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

export type MatchmakingMode = 'open' | 'direct';

export type DuelStatus =
  | 'waiting'
  | 'funded'
  | 'opening'
  | 'awaiting_assets'
  | 'settled'
  | 'cancelled'
  | 'refunded'
  | 'failed';

export interface Duel {
  createdAt: string;
  creatorWallet: string;
  escrowAddress?: string | null;
  expiresAt: string;
  id: string;
  matchmakingMode: MatchmakingMode;
  opponentWallet?: string | null;
  pack: Pack;
  stake: Money;
  status: DuelStatus;
  transactionSignature?: string | null;
  updatedAt?: string;
  winnerWallet?: string | null;
}

export interface Page<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string | null;
}
