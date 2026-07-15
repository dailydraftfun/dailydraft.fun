import { IsIn, IsOptional, Matches } from 'class-validator';

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class PrepareProviderEscrowRequest {
  @IsIn(['deposit_card', 'commit_result', 'settle', 'refund_card', 'refund_payment'])
  operation!: 'commit_result' | 'deposit_card' | 'refund_card' | 'refund_payment' | 'settle';

  @Matches(SOLANA_ADDRESS)
  callerWallet!: string;

  @IsOptional()
  @IsIn(['creator', 'opponent'])
  side?: 'creator' | 'opponent';

  @IsOptional()
  @Matches(SOLANA_ADDRESS)
  sourceTokenAccount?: string;

  @IsOptional()
  @IsIn(['legacy-spl-nft'])
  assetStandard?: 'legacy-spl-nft';

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  providerRequestId?: string;
}
