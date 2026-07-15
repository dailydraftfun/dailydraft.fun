import { IsString, Matches } from 'class-validator';

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class MatchmakingRequest {
  @Matches(SOLANA_ADDRESS)
  wallet!: string;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  packId!: string;
}

export class MatchmakingWalletRequest {
  @Matches(SOLANA_ADDRESS)
  wallet!: string;
}
