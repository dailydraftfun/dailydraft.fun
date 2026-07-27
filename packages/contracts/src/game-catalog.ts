export const GAME_CATALOG_SCHEMA_VERSION = 'dailydraft.game-catalog.v1' as const;

export const GAME_MODE_IDS = ['duel', 'gacha', 'flip', 'crash'] as const;

export type GameModeId = (typeof GAME_MODE_IDS)[number];
export type GameModeState = 'degraded' | 'playable' | 'preview' | 'unavailable';

export interface GameCatalogAction {
  href: `/games/${string}`;
  id: string;
  label: string;
}

export interface GameCapabilitySource {
  kind: 'fixture' | 'runtime';
  name: 'duel-readiness' | 'gacha-capability' | 'rgs-fixture';
  status: 'degraded' | 'gated' | 'verified';
}

export interface GameCatalogMode {
  availableActions: GameCatalogAction[];
  capabilitySource: GameCapabilitySource;
  description: string;
  id: GameModeId;
  name: string;
  reason: string;
  state: GameModeState;
}

export interface GameCatalog {
  asOf: string;
  modes: GameCatalogMode[];
  network: 'solana-devnet';
  schemaVersion: typeof GAME_CATALOG_SCHEMA_VERSION;
}
