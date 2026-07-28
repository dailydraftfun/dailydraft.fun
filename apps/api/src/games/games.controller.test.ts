import { describe, expect, test } from 'bun:test';
import {
  GAME_AVAILABILITY_SCHEMA_VERSION,
  type GameCatalog,
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
} from '@dailydraft/contracts';
import type { FastifyReply } from 'fastify';
import { GamesController } from './games.controller.js';
import type { GamesCatalogService } from './games-catalog.service.js';
import type { GamesLobbyService } from './games-lobby.service.js';

describe('GamesController', () => {
  test('returns the service-owned public catalog', async () => {
    const catalog: GameCatalog = {
      asOf: '2026-07-27T20:00:00.000Z',
      modes: [],
      network: 'solana-devnet',
      schemaVersion: 'dailydraft.game-catalog.v1',
    };
    const controller = new GamesController(
      {
        getCatalog: () => Promise.resolve(catalog),
      } as unknown as GamesCatalogService,
      {} as GamesLobbyService,
    );

    await expect(controller.getCatalog()).resolves.toBe(catalog);
  });

  test('returns the policy-aware public availability projection', async () => {
    const availability = {
      asOf: '2026-07-28T12:00:00.000Z',
      modes: [],
      network: 'solana-devnet' as const,
      schemaVersion: GAME_AVAILABILITY_SCHEMA_VERSION,
    };
    const controller = new GamesController(
      {} as GamesCatalogService,
      {
        getAvailability: () => Promise.resolve(availability),
      } as unknown as GamesLobbyService,
    );

    await expect(controller.getAvailability()).resolves.toBe(availability);
  });

  test('sets bounded public cache headers only after verified activity loads', async () => {
    const activity = {
      asOf: '2026-07-28T12:00:00.000Z',
      data: [],
      hasMore: false,
      nextCursor: null,
      schemaVersion: VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
    };
    const controller = new GamesController(
      {} as GamesCatalogService,
      {
        getVerifiedActivity: () => Promise.resolve(activity),
      } as unknown as GamesLobbyService,
    );
    const headers = new Map<string, string>();
    const response = {
      header: (name: string, value: string) => {
        headers.set(name, value);
        return response;
      },
    } as unknown as FastifyReply;

    await expect(controller.getVerifiedActivity({ limit: 20 }, response)).resolves.toBe(activity);
    expect(Object.fromEntries(headers)).toEqual({
      'cache-control': 'public, max-age=30, stale-while-revalidate=120',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    });
  });

  test('does not mark failed activity reads as publicly cacheable', async () => {
    const controller = new GamesController(
      {} as GamesCatalogService,
      {
        getVerifiedActivity: () => Promise.reject(new Error('database unavailable')),
      } as unknown as GamesLobbyService,
    );
    const headers = new Map<string, string>();
    const response = {
      header: (name: string, value: string) => {
        headers.set(name, value);
        return response;
      },
    } as unknown as FastifyReply;

    await expect(controller.getVerifiedActivity({ limit: 20 }, response)).rejects.toThrow(
      'database unavailable',
    );
    expect(headers.size).toBe(0);
  });
});
