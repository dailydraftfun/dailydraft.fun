import { describe, expect, test } from 'bun:test';
import { GAME_CATALOG_SCHEMA_VERSION } from '@dailydraft/contracts';
import {
  fallbackGameCatalog,
  gateRuntimeActions,
  playableGameModes,
  roadmapGameModes,
} from './game-catalog';
import {
  getGameCatalog,
  parseGameCatalog,
  readCachedGameCatalog,
  writeCachedGameCatalog,
} from './games-client';

describe('game catalog client', () => {
  test('fails runtime-backed modes closed before a capability response arrives', () => {
    const catalog = fallbackGameCatalog();

    expect(playableGameModes(catalog)).toEqual([]);
    expect(catalog.modes.map((mode) => mode.id)).toEqual(['duel', 'gacha', 'flip', 'crash']);
    expect(catalog.modes.slice(0, 2).every((mode) => mode.availableActions.length === 0)).toBe(
      true,
    );
    expect(roadmapGameModes(catalog).map((mode) => mode.id)).toEqual([
      'duel',
      'gacha',
      'flip',
      'crash',
    ]);
  });

  test('accepts only one complete canonical mode set', () => {
    const catalog = responseCatalog();

    expect(parseGameCatalog(catalog)).toEqual(catalog);
    expect(() =>
      parseGameCatalog({ ...catalog, modes: catalog.modes.filter((mode) => mode.id !== 'crash') }),
    ).toThrow('malformed catalog');
    expect(() =>
      parseGameCatalog({ ...catalog, modes: catalog.modes.map(() => catalog.modes[0]) }),
    ).toThrow('malformed catalog');
  });

  test('reads the catalog from the public no-store endpoint', async () => {
    const catalog = responseCatalog();
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const result = await getGameCatalog('https://api.example.test/v1', (input, init) => {
      requests.push({ input: String(input), ...(init ? { init } : {}) });
      return Promise.resolve(Response.json(catalog));
    });

    expect(result).toEqual(catalog);
    expect(requests).toEqual([
      {
        init: { cache: 'no-store' },
        input: 'https://api.example.test/v1/games/catalog',
      },
    ]);
  });

  test('retains a validated response as an explicit stale fallback', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const catalog = responseCatalog();

    writeCachedGameCatalog(catalog, storage);

    expect(readCachedGameCatalog(storage)).toEqual(catalog);
    values.set('dailydraft.games-catalog.v1', '{"modes":[]}');
    expect(readCachedGameCatalog(storage)).toBeNull();
  });

  test('withholds cached runtime actions until a fresh server response arrives', () => {
    const catalog = responseCatalog();
    const stale = gateRuntimeActions(catalog, 'stale');

    expect(playableGameModes(stale)).toEqual([]);
    expect(stale.modes.find((mode) => mode.id === 'duel')).toMatchObject({
      availableActions: [],
      capabilitySource: { kind: 'runtime', status: 'degraded' },
      state: 'degraded',
    });
    expect(stale.modes.find((mode) => mode.id === 'flip')?.availableActions).toEqual(
      catalog.modes.find((mode) => mode.id === 'flip')?.availableActions,
    );
    expect(catalog.modes.find((mode) => mode.id === 'duel')?.state).toBe('playable');
  });
});

function responseCatalog() {
  return {
    asOf: '2026-07-27T20:00:00.000Z',
    modes: [
      {
        availableActions: [
          { href: '/games/duel' as const, id: 'direct-challenge', label: 'Challenge a wallet' },
        ],
        capabilitySource: {
          kind: 'runtime' as const,
          name: 'duel-readiness' as const,
          status: 'verified' as const,
        },
        description: 'Duel description',
        id: 'duel' as const,
        name: 'Card Duel',
        reason: 'Duel ready.',
        state: 'playable' as const,
      },
      {
        availableActions: [],
        capabilitySource: {
          kind: 'runtime' as const,
          name: 'gacha-capability' as const,
          status: 'verified' as const,
        },
        description: 'Gacha description',
        id: 'gacha' as const,
        name: 'Sports Pack Gacha',
        reason: 'Deposit pending.',
        state: 'preview' as const,
      },
      {
        availableActions: [
          {
            href: '/games/marketplace-flip' as const,
            id: 'view-preview',
            label: 'View fixture preview',
          },
        ],
        capabilitySource: {
          kind: 'fixture' as const,
          name: 'rgs-fixture' as const,
          status: 'gated' as const,
        },
        description: 'Flip description',
        id: 'flip' as const,
        name: 'Marketplace Flip',
        reason: 'Fixture only.',
        state: 'preview' as const,
      },
      {
        availableActions: [
          { href: '/games/crash' as const, id: 'view-preview', label: 'View fixture preview' },
        ],
        capabilitySource: {
          kind: 'fixture' as const,
          name: 'rgs-fixture' as const,
          status: 'gated' as const,
        },
        description: 'Crash description',
        id: 'crash' as const,
        name: 'Card Streak',
        reason: 'Fixture only.',
        state: 'preview' as const,
      },
    ],
    network: 'solana-devnet' as const,
    schemaVersion: GAME_CATALOG_SCHEMA_VERSION,
  };
}
