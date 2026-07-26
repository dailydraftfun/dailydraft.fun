import { describe, expect, test } from 'bun:test';
import type { PullRarity } from '@dailydraft/contracts';
import {
  advanceChoreography,
  choreographyBeats,
  choreographyReducer,
  choreographyTimingFor,
  createChoreographyState,
  fastForwardChoreography,
  interruptChoreography,
  isAnimatedChoreographyBeat,
  settleChoreography,
} from './choreography-motion';

describe('reveal choreography state machine', () => {
  test('progresses through every beat and reveals before celebration settles', () => {
    let state = choreographyReducer(createChoreographyState('rare'), { type: 'start' });

    expect(state).toEqual({
      beat: 'anticipation',
      rarity: 'rare',
      revealed: false,
      settled: false,
    });

    state = advanceChoreography(state);
    expect(state.beat).toBe('hold');
    expect(state.revealed).toBe(false);

    state = advanceChoreography(state);
    expect(state.beat).toBe('reveal');
    expect(state.revealed).toBe(true);

    state = advanceChoreography(state);
    expect(state.beat).toBe('celebrate');
    expect(state.revealed).toBe(true);

    state = advanceChoreography(state);
    expect(state).toEqual(createChoreographyState('rare', 'settled'));
    expect(advanceChoreography(state)).toEqual(state);
  });

  test('makes interrupt, fast-forward, and explicit settle identical to natural completion', () => {
    const started = choreographyReducer(createChoreographyState('chase'), { type: 'start' });
    let natural = started;

    while (!natural.settled) natural = advanceChoreography(natural);

    expect(interruptChoreography(started)).toEqual(natural);
    expect(fastForwardChoreography(started)).toEqual(natural);
    expect(settleChoreography(started)).toEqual(natural);
  });

  test('ignores stale completion events and supports restart, reset, and rarity replacement', () => {
    const common = createChoreographyState('common');
    const started = choreographyReducer(common, { rarity: 'uncommon', type: 'start' });

    expect(started.rarity).toBe('uncommon');
    expect(choreographyReducer(started, { from: 'hold', type: 'advance' })).toBe(started);
    expect(choreographyReducer(started, { from: 'anticipation', type: 'advance' }).beat).toBe(
      'hold',
    );
    expect(choreographyReducer(started, { rarity: 'rare', type: 'reset' })).toEqual(
      createChoreographyState('rare'),
    );
    expect(choreographyReducer(started, { rarity: 'chase', type: 'interrupt' })).toEqual(
      createChoreographyState('chase', 'settled'),
    );
    expect(choreographyReducer(started, { rarity: 'chase', type: 'fast-forward' })).toEqual(
      createChoreographyState('chase', 'settled'),
    );
    expect(choreographyReducer(started, { rarity: 'chase', type: 'settle' })).toEqual(
      createChoreographyState('chase', 'settled'),
    );
  });

  test('scales only the celebration timing and intensity by canonical rarity', () => {
    const rarities: PullRarity[] = ['common', 'uncommon', 'rare', 'chase'];
    const celebrations = rarities.map((rarity) => choreographyTimingFor('celebrate', rarity));

    expect(celebrations.map(({ durationMs }) => durationMs)).toEqual([320, 400, 500, 620]);
    expect(celebrations.map(({ intensity }) => intensity)).toEqual([0.35, 0.55, 0.78, 1]);
    expect(choreographyTimingFor('reveal', 'common')).toEqual(
      choreographyTimingFor('reveal', 'chase'),
    );
  });

  test('makes every reduced-motion beat immediate without changing its information state', () => {
    for (const beat of choreographyBeats) {
      const standard = choreographyTimingFor(beat, 'chase');
      const reduced = choreographyTimingFor(beat, 'chase', true);

      expect(reduced).toEqual({ ...standard, durationMs: 0 });
      expect(isAnimatedChoreographyBeat(beat)).toBe(beat !== 'idle' && beat !== 'settled');
    }
  });
});
