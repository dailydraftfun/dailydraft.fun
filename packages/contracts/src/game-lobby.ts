import type { GameCapabilitySource, GameCatalogAction, GameModeState } from './game-catalog.js';

export const GAME_AVAILABILITY_SCHEMA_VERSION = 'dailydraft.game-availability.v1' as const;
export const VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION =
  'dailydraft.verified-game-activity.v1' as const;

export const PUBLIC_GAME_MODE_IDS = ['duel', 'flip', 'crash'] as const;

export type PublicGameModeId = (typeof PUBLIC_GAME_MODE_IDS)[number];

export interface PublicGameAvailabilityMode {
  asOf: string;
  availableActions: GameCatalogAction[];
  capabilitySource: GameCapabilitySource;
  id: PublicGameModeId;
  reason: string;
  state: GameModeState;
}

export interface PublicGameAvailability {
  asOf: string;
  modes: PublicGameAvailabilityMode[];
  network: 'solana-devnet';
  schemaVersion: typeof GAME_AVAILABILITY_SCHEMA_VERSION;
}

export interface VerifiedGameActivity {
  activityId: `${PublicGameModeId}:${string}`;
  mode: PublicGameModeId;
  occurredAt: string;
  participants: Array<{
    label: string;
    side: 'creator' | 'opponent';
  }>;
  receiptHref: `/${string}`;
  result: 'tie' | 'winner-verified';
  resultHref: `/rgs/rounds/${PublicGameModeId}/${string}/proof`;
  resultSummary: string;
  tier: {
    amount: string;
    currency: 'USDC';
    decimals: 6;
  };
  title: string;
  verification: 'settled-rgs-proof';
}

export interface VerifiedGameActivityPage {
  asOf: string;
  data: VerifiedGameActivity[];
  hasMore: boolean;
  nextCursor: string | null;
  schemaVersion: typeof VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION;
}
