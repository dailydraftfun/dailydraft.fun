import { Type } from 'class-transformer';
import { IsIn, IsInt, Matches, Min } from 'class-validator';

export class CrashRoundParams {
  @Matches(/^crashround_[A-Za-z0-9._:-]{8,128}$/)
  roundId!: string;
}

export class CrashPlayerDecisionRequest {
  @IsIn(['continue', 'cash-out'])
  action!: 'cash-out' | 'continue';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedStage!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
