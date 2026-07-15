import { describe, expect, test } from 'bun:test';

import { PacksService } from '../packs/packs.service.js';
import { DuelsService } from './duels.service.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';

describe('DuelsService', () => {
  test('replays an idempotent create request', () => {
    const service = new DuelsService(new PacksService());
    const input = {
      creatorWallet: WALLET,
      expiresAt: '2099-01-01T00:00:00.000Z',
      matchmakingMode: 'open' as const,
      packId: 'pokemon_50',
    };

    const first = service.create(input, 'idempotency-key-0001');
    const replay = service.create(input, 'idempotency-key-0001');

    expect(replay.id).toBe(first.id);
  });

  test('requires an opponent for direct matchmaking', () => {
    const service = new DuelsService(new PacksService());

    expect(() =>
      service.create(
        {
          creatorWallet: WALLET,
          expiresAt: '2099-01-01T00:00:00.000Z',
          matchmakingMode: 'direct',
          packId: 'pokemon_50',
        },
        'idempotency-key-0002',
      ),
    ).toThrow('opponentWallet is required');
  });
});
