import { describe, expect, test } from 'bun:test';

import {
  GAME_AVAILABILITY_SCHEMA_VERSION,
  PUBLIC_GAME_MODE_IDS,
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivity,
  type VerifiedGameActivityPage,
  verifiedGameActivityContractFixtures,
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
      data: [verifiedGameActivityContractFixtures.duel],
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

  test('keeps one generic envelope compatible with two-player and single-player modes', () => {
    expect(
      Object.values(verifiedGameActivityContractFixtures).map((activity) => ({
        mode: activity.mode,
        participants: activity.participants.length,
        result: activity.result,
      })),
    ).toEqual([
      { mode: 'crash', participants: 1, result: 'cashed-out' },
      { mode: 'duel', participants: 2, result: 'winner-verified' },
      { mode: 'flip', participants: 1, result: 'acquired' },
    ]);

    const singlePlayerResults: VerifiedGameActivity[] = [
      'acquired',
      'bust',
      'cashed-out',
      'completed',
    ].map((result) => ({
      ...verifiedGameActivityContractFixtures.crash,
      result,
    }));
    expect(singlePlayerResults.map((activity) => activity.result)).toEqual([
      'acquired',
      'bust',
      'cashed-out',
      'completed',
    ]);
  });
});
