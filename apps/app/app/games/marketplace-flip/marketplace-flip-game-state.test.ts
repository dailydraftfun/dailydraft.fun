import { describe, expect, test } from 'bun:test';
import {
  flipResultCallForRound,
  INITIAL_MARKETPLACE_FLIP_GAME_STATE,
  marketplaceFlipGameReducer,
  pointsForFlipCall,
} from './marketplace-flip-game-state';

describe('Marketplace Flip fixture game state', () => {
  test('runs the guarded commit, flip, reveal, receipt, and replay loop', () => {
    const selected = marketplaceFlipGameReducer(INITIAL_MARKETPLACE_FLIP_GAME_STATE, {
      call: 'chase',
      type: 'call-selected',
    });
    const committed = marketplaceFlipGameReducer(selected, { type: 'call-committed' });
    const revealing = marketplaceFlipGameReducer(committed, { type: 'card-flipped' });
    const result = marketplaceFlipGameReducer(revealing, { type: 'reveal-completed' });
    const receipt = marketplaceFlipGameReducer(result, { type: 'receipt-opened' });
    const replay = marketplaceFlipGameReducer(receipt, { type: 'round-replayed' });

    expect(committed.phase).toBe('committed');
    expect(revealing.phase).toBe('revealing');
    expect(result).toMatchObject({ lastPoints: 3, phase: 'result', score: 3, streak: 1 });
    expect(receipt.phase).toBe('receipt');
    expect(replay).toMatchObject({ call: 'chase', phase: 'pick', round: 2, score: 3, streak: 1 });
  });

  test('scores only an exact call and resets the streak after a miss', () => {
    expect(pointsForFlipCall('chase')).toBe(3);
    expect(pointsForFlipCall('core')).toBe(0);
    expect(flipResultCallForRound(1)).toBe('chase');
    expect(flipResultCallForRound(2)).toBe('floor');
    expect(flipResultCallForRound(3)).toBe('core');
    expect(flipResultCallForRound(4)).toBe('chase');
    expect(pointsForFlipCall('floor', flipResultCallForRound(2))).toBe(1);

    const missed = marketplaceFlipGameReducer(
      {
        ...INITIAL_MARKETPLACE_FLIP_GAME_STATE,
        call: 'floor',
        phase: 'revealing',
        score: 6,
        streak: 2,
      },
      { type: 'reveal-completed' },
    );

    expect(missed).toMatchObject({ lastPoints: 0, phase: 'result', score: 6, streak: 0 });
  });

  test('scores the round-specific fixture result after replay', () => {
    const roundTwo = marketplaceFlipGameReducer(
      {
        ...INITIAL_MARKETPLACE_FLIP_GAME_STATE,
        call: 'floor',
        phase: 'revealing',
        round: 2,
      },
      { type: 'reveal-completed' },
    );

    expect(roundTwo).toMatchObject({ lastPoints: 1, score: 1, streak: 1 });
  });

  test('ignores out-of-order actions so the result cannot be exposed before a commit', () => {
    expect(
      marketplaceFlipGameReducer(INITIAL_MARKETPLACE_FLIP_GAME_STATE, {
        type: 'card-flipped',
      }),
    ).toEqual(INITIAL_MARKETPLACE_FLIP_GAME_STATE);
    expect(
      marketplaceFlipGameReducer(INITIAL_MARKETPLACE_FLIP_GAME_STATE, {
        type: 'reveal-completed',
      }),
    ).toEqual(INITIAL_MARKETPLACE_FLIP_GAME_STATE);
  });
});
