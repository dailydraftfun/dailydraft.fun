import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { FANTASY_POSITIONS, FANTASY_SPORTS } from './fantasy-domain.js';

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOURNAMENT_ID = /^fantnmt_[A-Za-z0-9]{12,64}$/;
const PLAYER_ID = /^fanplyr_[A-Za-z0-9]{12,64}$/;

export class FantasyTournamentIdParams {
  @Matches(TOURNAMENT_ID)
  tournamentId!: string;
}

export class FantasyPlayerIdParams {
  @Matches(PLAYER_ID)
  playerId!: string;
}

export class FantasyWalletParams {
  @Matches(SOLANA_ADDRESS)
  wallet!: string;
}

export class ListFantasyTournamentsQuery {
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
  @IsIn([...FANTASY_SPORTS])
  sport?: (typeof FANTASY_SPORTS)[number];

  @IsOptional()
  @IsIn([...FANTASY_POSITIONS])
  position?: (typeof FANTASY_POSITIONS)[number];

  @IsOptional()
  @IsIn(['upcoming', 'locked', 'settling', 'settled', 'cancelled'])
  status?: string;

  @IsOptional()
  @Matches(SOLANA_ADDRESS)
  wallet?: string;
}
