import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const SAFE_REFERENCE = /^[A-Za-z0-9:_-]{1,160}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const operatorReasonCodes = [
  'maintenance',
  'provider_degraded',
  'rpc_degraded',
  'treasury_limit',
  'security_incident',
  'manual_review',
] as const;

export type OperatorReasonCode = (typeof operatorReasonCodes)[number];

export class AdminDuelQuery {
  @IsOptional()
  @Matches(/^duel_[A-Za-z0-9]{12,64}$/)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsIn(['all', 'failed', 'stuck'])
  attention: 'all' | 'failed' | 'stuck' = 'all';

  @IsOptional()
  @Matches(/^duel_[A-Za-z0-9]{12,64}$/)
  duelId?: string;

  @IsOptional()
  @Matches(SOLANA_ADDRESS)
  wallet?: string;

  @IsOptional()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/)
  signature?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Matches(SAFE_REFERENCE)
  providerReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Matches(SAFE_REFERENCE)
  assetReference?: string;
}

export class OperatorAuditQuery {
  @IsOptional()
  @Matches(/^oaud_[a-f0-9]{32}$/)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class EmergencyPauseRequest {
  @IsBoolean()
  paused!: boolean;

  @IsIn(operatorReasonCodes)
  reasonCode!: OperatorReasonCode;
}
