import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class HouseInventoryQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsIn(['disposed', 'held', 'listed', 'reconciliation_required'])
  status?: 'disposed' | 'held' | 'listed' | 'reconciliation_required';
}

export class HouseInventoryParams {
  @Matches(/^hinv_[a-f0-9]{32}$/)
  inventoryId!: string;
}

export class HouseDispositionRequest {
  @IsIn(['buyback', 'hold', 'list', 'manual_review', 'promotion'])
  disposition!: 'buyback' | 'hold' | 'list' | 'manual_review' | 'promotion';

  @Matches(/^[A-Za-z0-9:_-]{8,160}$/)
  operationKey!: string;

  @IsString()
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9 _:-]{3,160}$/)
  reason!: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._:-]{3,80}$/)
  provider?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._:-]{8,240}$/)
  providerListingReference?: string;
}

export class CompleteHouseDispositionRequest {
  @Matches(/^\d+$/)
  feeAmount!: string;

  @Matches(/^[A-Za-z0-9:_-]{8,160}$/)
  operationKey!: string;

  @Matches(/^\d+$/)
  realizedAmount!: string;

  @IsIn(['USDC'])
  realizedCurrency!: 'USDC';

  @Type(() => Number)
  @IsInt()
  @Min(6)
  @Max(6)
  realizedDecimals!: number;

  @IsString()
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9 _:-]{3,160}$/)
  reason!: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._:-]{3,80}$/)
  provider?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._:-]{8,240}$/)
  providerListingReference?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  providerSaleAt?: string;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  providerSaleEvidenceHash?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._:-]{8,240}$/)
  providerSaleReference?: string;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  providerSaleSignature?: string;
}

export class DelistHouseInventoryRequest {
  @IsISO8601({ strict: true })
  cancelledAt!: string;

  @Matches(/^[a-f0-9]{64}$/)
  providerCancellationEvidenceHash!: string;

  @Matches(/^[a-f0-9]{64}$/)
  providerCancellationSignature!: string;

  @Matches(/^[A-Za-z0-9._:-]{8,240}$/)
  providerCancellationReference!: string;

  @Matches(/^[A-Za-z0-9:_-]{8,160}$/)
  operationKey!: string;

  @Matches(/^[A-Za-z0-9._:-]{3,80}$/)
  provider!: string;

  @Matches(/^[A-Za-z0-9._:-]{8,240}$/)
  providerListingReference!: string;

  @IsString()
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9 _:-]{3,160}$/)
  reason!: string;
}
