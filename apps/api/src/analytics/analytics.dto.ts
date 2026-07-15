import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const productEventNames = [
  'lobby_viewed',
  'tier_selected',
  'wallet_connected',
  'wallet_authenticated',
  'duel_created',
  'duel_matched',
  'duel_funded',
  'pack_reveal_started',
  'pack_revealed',
  'duel_shared',
  'duel_rematched',
  'duel_cancelled',
  'duel_refunded',
  'duel_settled',
  'settlement_failed',
  'provider_error',
  'solana_rpc_error',
  'ui_error',
  'matchmaking_wait_started',
  'matchmaking_matched',
  'matchmaking_abandoned',
  'matchmaking_commitment_failed',
  'house_fallback_selected',
] as const;

export type ProductEventName = (typeof productEventNames)[number];

const clientProductEventNames = [
  'lobby_viewed',
  'tier_selected',
  'wallet_connected',
  'wallet_authenticated',
  'pack_reveal_started',
  'duel_shared',
  'duel_rematched',
  'ui_error',
] as const satisfies readonly ProductEventName[];

const duelStatuses = [
  'waiting',
  'matched',
  'committing',
  'funded',
  'opening',
  'awaiting_assets',
  'settling',
  'settled',
  'cancelling',
  'cancelled',
  'refunding',
  'refunded',
  'failed',
] as const;

export class ProductEventRequest {
  @IsIn(clientProductEventNames)
  name!: ProductEventName;

  @IsOptional()
  @Matches(/^duel_[A-Za-z0-9]{12,64}$/)
  duelId?: string;

  @IsOptional()
  @IsIn(duelStatuses)
  status?: (typeof duelStatuses)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([25, 50, 100])
  tier?: number;

  @IsOptional()
  @IsIn(['direct', 'house', 'open'])
  mode?: 'direct' | 'house' | 'open';
}

export class IngestProductEventsRequest {
  @Matches(/^anon_[a-f0-9]{32}$/)
  sessionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductEventRequest)
  events!: ProductEventRequest[];
}

export class AnalyticsFunnelQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  windowHours = 24;
}
