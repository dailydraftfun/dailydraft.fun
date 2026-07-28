'use client';

import {
  GAME_CATALOG_SCHEMA_VERSION,
  GAME_MODE_IDS,
  type GameCapabilitySource,
  type GameCatalog,
  type GameCatalogAction,
  type GameCatalogMode,
} from '@dailydraft/contracts/game-catalog';

const apiBaseUrl = process.env.NEXT_PUBLIC_DUEL_API_URL?.replace(/\/$/, '');
const CATALOG_CACHE_KEY = 'dailydraft.games-catalog.v1';

type GameCatalogFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function getGameCatalog(
  baseUrl: string | undefined = apiBaseUrl,
  fetcher: GameCatalogFetch = fetch,
): Promise<GameCatalog> {
  if (!baseUrl) throw new Error('The games API is not configured.');
  const response = await fetcher(`${baseUrl}/games/catalog`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The games catalog is unavailable (${response.status}).`);
  return parseGameCatalog(await response.json());
}

export function parseGameCatalog(value: unknown): GameCatalog {
  if (!isObject(value)) throw malformedCatalogError();
  if (
    value.schemaVersion !== GAME_CATALOG_SCHEMA_VERSION ||
    value.network !== 'solana-devnet' ||
    !isIsoDate(value.asOf) ||
    !Array.isArray(value.modes) ||
    value.modes.length !== GAME_MODE_IDS.length ||
    !value.modes.every(isGameCatalogMode)
  ) {
    throw malformedCatalogError();
  }

  const ids = value.modes.map((mode) => mode.id);
  if (new Set(ids).size !== GAME_MODE_IDS.length || GAME_MODE_IDS.some((id) => !ids.includes(id))) {
    throw malformedCatalogError();
  }

  return value as unknown as GameCatalog;
}

export function readCachedGameCatalog(storage: Pick<Storage, 'getItem'>): GameCatalog | null {
  try {
    const serialized = storage.getItem(CATALOG_CACHE_KEY);
    return serialized ? parseGameCatalog(JSON.parse(serialized)) : null;
  } catch {
    return null;
  }
}

export function writeCachedGameCatalog(
  catalog: GameCatalog,
  storage: Pick<Storage, 'setItem'>,
): void {
  try {
    storage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalog));
  } catch {
    // Storage is optional. The in-memory response remains authoritative for this page.
  }
}

function isGameCatalogMode(value: unknown): value is GameCatalogMode {
  if (!isObject(value)) return false;
  return (
    GAME_MODE_IDS.includes(value.id as GameCatalogMode['id']) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.description === 'string' &&
    value.description.length > 0 &&
    typeof value.reason === 'string' &&
    value.reason.length > 0 &&
    ['degraded', 'playable', 'preview', 'unavailable'].includes(String(value.state)) &&
    Array.isArray(value.availableActions) &&
    value.availableActions.every(isGameCatalogAction) &&
    isCapabilitySource(value.capabilitySource)
  );
}

function isGameCatalogAction(value: unknown): value is GameCatalogAction {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.label === 'string' &&
    value.label.length > 0 &&
    typeof value.href === 'string' &&
    /^\/games\/[a-z0-9-]+$/.test(value.href)
  );
}

function isCapabilitySource(value: unknown): value is GameCapabilitySource {
  return (
    isObject(value) &&
    ['fixture', 'runtime'].includes(String(value.kind)) &&
    ['duel-readiness', 'gacha-capability', 'rgs-fixture'].includes(String(value.name)) &&
    ['degraded', 'gated', 'verified'].includes(String(value.status))
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function malformedCatalogError(): Error {
  return new Error('The games API returned a malformed catalog.');
}
