import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class PackIdParams {
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  packId!: string;
}

export class ListPacksQuery {
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'false' | 'true';

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
}
