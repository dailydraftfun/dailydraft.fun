import { describe, expect, test } from 'bun:test';
import {
  CARD_STREAK_CARDS,
  cardStreakCardsForRound,
  cardStreakReducer,
  fixturePotFor,
  INITIAL_CARD_STREAK_STATE,
  nextCardFor,
  streakProgressFor,
} from './card-streak-state';

describe('Card Streak deterministic game state', () => {
  test('continues through four immediate card reveals and then busts', () => {
    let state = INITIAL_CARD_STREAK_STATE;

    expect(state.stageIndex).toBe(0);
    expect(nextCardFor(state)?.name).toBe('Mewtwo');

    state = cardStreakReducer(state, { type: 'continue' });
    expect(state).toMatchObject({ decisionCount: 1, stageIndex: 1, status: 'active' });

    state = cardStreakReducer(state, { type: 'continue' });
    state = cardStreakReducer(state, { type: 'continue' });
    expect(state).toMatchObject({ decisionCount: 3, stageIndex: 3, status: 'active' });
    expect(nextCardFor(state)).toBeNull();

    state = cardStreakReducer(state, { type: 'continue' });
    expect(state).toMatchObject({ decisionCount: 4, stageIndex: 3, status: 'busted' });
  });

  test('cash-out locks the current fixture score and ignores terminal actions', () => {
    const continued = cardStreakReducer(INITIAL_CARD_STREAK_STATE, { type: 'continue' });
    const cashed = cardStreakReducer(continued, { type: 'cash-out' });

    expect(cashed).toMatchObject({ decisionCount: 2, stageIndex: 1, status: 'cashed-out' });
    expect(cardStreakReducer(cashed, { type: 'continue' })).toBe(cashed);
    expect(fixturePotFor(cashed.stageIndex)).toBe(85.5);
  });

  test('replay starts a clean, numbered run from the first card', () => {
    const cashed = cardStreakReducer(INITIAL_CARD_STREAK_STATE, { type: 'cash-out' });
    const replayed = cardStreakReducer(cashed, { type: 'replay' });

    expect(replayed).toEqual({
      decisionCount: 0,
      round: 2,
      stageIndex: 0,
      status: 'active',
    });
    expect(streakProgressFor(replayed)).toBe(25);
    expect(cardStreakCardsForRound(replayed.round)[0]?.name).toBe('Mewtwo');
    expect(nextCardFor(replayed)?.name).toBe('Blastoise');
    expect(fixturePotFor(99)).toBe(
      25 + CARD_STREAK_CARDS.reduce((sum, card) => sum + card.value, 0),
    );
  });
});
