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
    'funded',
    'opening',
    'awaiting_assets',
    'settled',
    'cancelled',
    'refunded',
    'failed',
  ])
  status?: string;

  @IsOptional()
  @Matches(SOLANA_ADDRESS)
  wallet?: string;
}

export class CreateDuelRequest {
  @Matches(SOLANA_ADDRESS)
  creatorWallet!: string;

  @IsDateString()
  expiresAt!: string;

  @IsIn(['open', 'direct'])
  matchmakingMode!: 'direct' | 'open';

  @IsOptional()
  @Matches(SOLANA_ADDRESS)
  opponentWallet?: string | null;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  packId!: string;
}

export class PrepareTransactionRequest {
  @IsIn(['fund', 'cancel', 'refund'])
  action!: 'cancel' | 'fund' | 'refund';

  @Matches(SOLANA_ADDRESS)
  wallet!: string;
}
