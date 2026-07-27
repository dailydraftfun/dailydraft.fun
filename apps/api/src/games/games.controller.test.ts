import { describe, expect, test } from 'bun:test';
import type { GameCatalog } from '@dailydraft/contracts';
import { GamesController } from './games.controller.js';
import type { GamesCatalogService } from './games-catalog.service.js';

describe('GamesController', () => {
  test('returns the service-owned public catalog', async () => {
    const catalog: GameCatalog = {
      asOf: '2026-07-27T20:00:00.000Z',
      modes: [],
      network: 'solana-devnet',
      schemaVersion: 'dailydraft.game-catalog.v1',
    };
    const controller = new GamesController({
      getCatalog: () => Promise.resolve(catalog),
    } as unknown as GamesCatalogService);

    await expect(controller.getCatalog()).resolves.toBe(catalog);
  });
});
