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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  oddsVersion = 1;
}
