import { IsString, Matches, MaxLength } from 'class-validator';

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class CreateWalletChallengeRequest {
  @Matches(SOLANA_ADDRESS)
  wallet!: string;
}

export class CreateWalletSessionRequest {
  @Matches(/^authc_[a-f0-9]{32}$/)
  challengeId!: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/)
  signature!: string;

  @Matches(SOLANA_ADDRESS)
  wallet!: string;
}
