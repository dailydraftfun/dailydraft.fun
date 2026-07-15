import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class DuelIdParams {
  @Matches(/^duel_[A-Za-z0-9]{12,64}$/)
  duelId!: string;
}

export class WalletParams {
  @Matches(SOLANA_ADDRESS)
  wallet!: string;
}

export class ListDuelsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsIn([
    'waiting',
    'matched',
    'committing',
    'funded',
    'opening',
    'awaiting_assets',
    'settling',
    'settled',
    'cancelling',
    'cancelled',
    'refunding',
    'refunded',
    'failed',
  ])
  status?: string;

  @IsOptional()
  @IsIn(['direct', 'house', 'open'])
  matchmakingMode?: 'direct' | 'house' | 'open';

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  packId?: string;

  @IsOptional()
  @Matches(SOLANA_ADDRESS)
  wallet?: string;
}

export class CreateDuelRequest {
  @IsOptional()
  @Matches(/^anon_[a-f0-9]{32}$/)
  analyticsSessionId?: string;

  @Matches(SOLANA_ADDRESS)
  creatorWallet!: string;

  @IsDateString()
  expiresAt!: string;

  @IsIn(['direct', 'house', 'open'])
  matchmakingMode!: 'direct' | 'house' | 'open';

  @IsOptional()
  @Matches(SOLANA_ADDRESS)
  opponentWallet?: string | null;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  packId!: string;
}

export class JoinDuelRequest {
  @IsOptional()
  @Matches(/^anon_[a-f0-9]{32}$/)
  analyticsSessionId?: string;

  @Matches(SOLANA_ADDRESS)
  wallet!: string;
}

export class CancelDuelRequest {
  @IsOptional()
  @Matches(/^anon_[a-f0-9]{32}$/)
  analyticsSessionId?: string;

  @Matches(SOLANA_ADDRESS)
  wallet!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  reason?: string;
}

export class PrepareTransactionRequest {
  @IsIn(['fund'])
  action!: 'fund';

  @Matches(SOLANA_ADDRESS)
  wallet!: string;
}
