import { describe, expect, test } from 'bun:test';

import {
  GAME_AVAILABILITY_SCHEMA_VERSION,
  PUBLIC_GAME_MODE_IDS,
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivityPage,
} from './game-lobby.js';

describe('public game lobby contracts', () => {
  test('pins the stable public modes and versioned response schemas', () => {
    expect(PUBLIC_GAME_MODE_IDS).toEqual(['duel', 'flip', 'crash']);
    expect(GAME_AVAILABILITY_SCHEMA_VERSION).toBe('dailydraft.game-availability.v1');
    expect(VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION).toBe('dailydraft.verified-game-activity.v1');
  });

  test('keeps verified activity free of participant identifiers', () => {
    const page: VerifiedGameActivityPage = {
      asOf: '2026-07-28T12:00:00.000Z',
      data: [
        {
          activityId: 'duel:duel_activity000001',
          mode: 'duel',
          occurredAt: '2026-07-28T11:59:00.000Z',
          participants: [
            { label: '9xQe…9gJ1', side: 'creator' },
            { label: 'Gk8Z…MQyW', side: 'opponent' },
          ],
          receiptHref: '/duels/duel_activity000001/receipt',
          result: 'winner-verified',
          resultHref: '/rgs/rounds/duel/duel_activity000001/proof',
          resultSummary: '9xQe…9gJ1 won a verified Sports Pack Duel.',
          tier: { amount: '50000000', currency: 'USDC', decimals: 6 },
          title: 'Sports Pack Duel settled',
          verification: 'settled-rgs-proof',
        },
      ],
      hasMore: false,
      nextCursor: null,
      schemaVersion: VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
    };

    expect(Object.keys(page.data[0] ?? {}).sort()).toEqual([
      'activityId',
      'mode',
      'occurredAt',
      'participants',
      'receiptHref',
      'result',
      'resultHref',
      'resultSummary',
      'tier',
      'title',
      'verification',
    ]);
  });
});
