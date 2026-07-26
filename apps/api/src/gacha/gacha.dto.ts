import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class GachaMachineParams {
  @Matches(/^[a-z0-9][a-z0-9._:-]{0,127}$/)
  machineKey!: string;
}

export class GachaPaymentIntentParams {
  @Matches(/^gachapay_[a-f0-9]{32}$/)
  intentId!: string;
}

export class CreateGachaPaymentIntentRequest {
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  payerWallet!: string;
}

export class VerifyGachaPaymentRequest {
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{64,96}$/)
  signature!: string;
}

export class CreateFixtureGachaRipRequest {
  @Matches(/^[a-z0-9][a-z0-9._:-]{0,127}$/)
  machineKey!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(240)
  seed!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  recipientWallet!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  commitmentId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  idempotencyKey?: string;

  // Optional at the edge because fixture-mode rips are unfunded; the service
  // rejects a missing intent whenever the deployment requires payment.
  @IsOptional()
  @Matches(/^gachapay_[a-f0-9]{32}$/)
  paymentIntentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  oddsVersion = 1;
}
