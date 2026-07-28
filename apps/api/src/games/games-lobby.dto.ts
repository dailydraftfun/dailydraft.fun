import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class ListVerifiedGameActivityQuery {
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
