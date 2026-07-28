import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class CrashRoundParams {
  @Matches(/^crashround_[A-Za-z0-9._:-]{8,128}$/)
  roundId!: string;
}

export class ListCrashHistoryQuery {
  @IsOptional()
  @Matches(/^v1\.[A-Za-z0-9_-]{1,480}$/)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
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
