import { describe, expect, test } from 'bun:test';

import {
  ChoreographyClock,
  choreographyBeats,
  choreographyReducer,
  choreographyTimingFor,
  createChoreographyState,
  createChoreographyTimeline,
} from './choreography.js';

describe('engine reveal choreography', () => {
  test('mirrors the DOM reveal beat order and information state', () => {
    let state = choreographyReducer(createChoreographyState('rare'), { type: 'start' });

    expect(choreographyBeats).toEqual([
      'idle',
      'anticipation',
      'hold',
      'reveal',
      'celebrate',
      'settled',
    ]);
    expect(state).toEqual({
      beat: 'anticipation',
      rarity: 'rare',
      revealed: false,
      settled: false,
    });

    state = choreographyReducer(state, { from: 'anticipation', type: 'advance' });
    expect(state.beat).toBe('hold');
    state = choreographyReducer(state, { type: 'advance' });
    expect(state).toMatchObject({ beat: 'reveal', revealed: true, settled: false });
    state = choreographyReducer(state, { type: 'advance' });
    expect(state).toMatchObject({ beat: 'celebrate', revealed: true, settled: false });
    state = choreographyReducer(state, { type: 'advance' });
    expect(state).toEqual(createChoreographyState('rare', 'settled'));
    expect(choreographyReducer(state, { type: 'advance' })).toEqual(state);
  });

  test('converges interrupt, fast-forward, settle, and natural completion', () => {
    const started = choreographyReducer(createChoreographyState('chase'), { type: 'start' });
    let natural = started;
    while (!natural.settled) natural = choreographyReducer(natural, { type: 'advance' });

    expect(choreographyReducer(started, { type: 'interrupt' })).toEqual(natural);
    expect(choreographyReducer(started, { type: 'fast-forward' })).toEqual(natural);
    expect(choreographyReducer(started, { type: 'settle' })).toEqual(natural);
    expect(choreographyReducer(started, { rarity: 'common', type: 'settle' })).toEqual(
      createChoreographyState('common', 'settled'),
    );
  });

  test('rejects stale completions and supports rarity replacement and reset', () => {
    const started = choreographyReducer(createChoreographyState('common'), {
      rarity: 'uncommon',
      type: 'start',
    });

    expect(choreographyReducer(started, { from: 'hold', type: 'advance' })).toBe(started);
    expect(choreographyReducer(started, { rarity: 'rare', type: 'reset' })).toEqual(
      createChoreographyState('rare'),
    );
  });

  test('publishes deterministic rarity-scaled timelines and easings', () => {
    expect(choreographyTimingFor('celebrate', 'common')).toMatchObject({
      durationMs: 320,
      intensity: 0.35,
    });
    expect(choreographyTimingFor('celebrate', 'chase')).toMatchObject({
      durationMs: 620,
      intensity: 1,
    });
    expect(choreographyTimingFor('reveal', 'common')).toEqual(
      choreographyTimingFor('reveal', 'chase'),
    );

    const timeline = createChoreographyTimeline('rare');
    expect(
      timeline.map(({ beat, endsAtMs, startsAtMs }) => ({ beat, endsAtMs, startsAtMs })),
    ).toEqual([
      { beat: 'anticipation', endsAtMs: 340, startsAtMs: 0 },
      { beat: 'hold', endsAtMs: 520, startsAtMs: 340 },
      { beat: 'reveal', endsAtMs: 1_000, startsAtMs: 520 },
      { beat: 'celebrate', endsAtMs: 1_500, startsAtMs: 1_000 },
    ]);
    expect(createChoreographyTimeline('rare', true).every((entry) => entry.durationMs === 0)).toBe(
      true,
    );
  });

  test('advances a ticker-driven clock across beats and settles excess elapsed time', () => {
    const clock = new ChoreographyClock('uncommon');

    expect(clock.tick(1_000)).toEqual(createChoreographyState('uncommon'));
    expect(clock.start()).toMatchObject({ beat: 'anticipation', rarity: 'uncommon' });
    expect(clock.tick(339).beat).toBe('anticipation');
    expect(clock.tick(1).beat).toBe('hold');
    expect(clock.tick(180).beat).toBe('reveal');
    expect(clock.tick(880)).toEqual(createChoreographyState('uncommon', 'settled'));
    expect(clock.tick(Number.NaN)).toEqual(clock.state);
  });

  test('supports explicit clock interrupt, settle, rarity restart, and reduced motion', () => {
    const interrupted = new ChoreographyClock('common');
    interrupted.start('rare');
    expect(interrupted.interrupt()).toEqual(createChoreographyState('rare', 'settled'));

    const settled = new ChoreographyClock('common');
    settled.start();
    expect(settled.settle()).toEqual(createChoreographyState('common', 'settled'));

    const reduced = new ChoreographyClock('common', true);
    expect(reduced.start('chase')).toEqual(createChoreographyState('chase', 'settled'));
  });
});
