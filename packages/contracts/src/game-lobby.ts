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
    role: 'house' | 'player';
  }>;
  receiptHref: `/v1/${string}`;
  result: string;
  resultHref: `/v1/rgs/rounds/${PublicGameModeId}/${string}/proof`;
  resultSummary: string;
  tier: {
    amount: string;
    currency: 'USDC';
    decimals: 6;
  };
  title: string;
  verification: 'settled-rgs-proof';
}

export const verifiedGameActivityContractFixtures = {
  crash: {
    activityId: 'crash:crashround_contract0001',
    mode: 'crash',
    occurredAt: '2026-07-28T11:57:00.000Z',
    participants: [{ label: 'Player 7K2M', role: 'player' }],
    receiptHref: '/v1/rgs/rounds/crash/crashround_contract0001/proof',
    result: 'cashed-out',
    resultHref: '/v1/rgs/rounds/crash/crashround_contract0001/proof',
    resultSummary: 'Player 7K2M cashed out a verified Card Streak round.',
    tier: { amount: '50000000', currency: 'USDC', decimals: 6 },
    title: 'Card Streak round settled',
    verification: 'settled-rgs-proof',
  },
  duel: {
    activityId: 'duel:duel_activity000001',
    mode: 'duel',
    occurredAt: '2026-07-28T11:59:00.000Z',
    participants: [
      { label: '9xQe…9gJ1', role: 'player' },
      { label: 'Gk8Z…MQyW', role: 'player' },
    ],
    receiptHref: '/v1/duels/duel_activity000001/receipt',
    result: 'winner-verified',
    resultHref: '/v1/rgs/rounds/duel/duel_activity000001/proof',
    resultSummary: '9xQe…9gJ1 won a verified Sports Pack Duel.',
    tier: { amount: '50000000', currency: 'USDC', decimals: 6 },
    title: 'Sports Pack Duel settled',
    verification: 'settled-rgs-proof',
  },
  flip: {
    activityId: 'flip:flipround_contract0001',
    mode: 'flip',
    occurredAt: '2026-07-28T11:58:00.000Z',
    participants: [{ label: 'Player P4Q9', role: 'player' }],
    receiptHref: '/v1/rgs/rounds/flip/flipround_contract0001/proof',
    result: 'acquired',
    resultHref: '/v1/rgs/rounds/flip/flipround_contract0001/proof',
    resultSummary: 'Player P4Q9 acquired a verified Marketplace Flip card.',
    tier: { amount: '50000000', currency: 'USDC', decimals: 6 },
    title: 'Marketplace Flip quote settled',
    verification: 'settled-rgs-proof',
  },
} as const satisfies Record<PublicGameModeId, VerifiedGameActivity>;

export interface VerifiedGameActivityPage {
  asOf: string;
  data: VerifiedGameActivity[];
  hasMore: boolean;
  nextCursor: string | null;
  schemaVersion: typeof VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION;
}
