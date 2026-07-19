import { describe, expect, test } from 'bun:test';

import {
  parseStoredRevealTimeline,
  type RevealPresentation,
  recoverRevealStartedAt,
  revealPresentationAt,
  revealSideResolution,
} from './reveal-presentation';

describe('reveal presentation', () => {
  test('sequences countdown, both pulls, and resolution without exposing the margin early', () => {
    expect(revealPresentationAt(0)).toMatchObject({ countdown: 3, phase: 'countdown' });
    expect(revealPresentationAt(900)).toMatchObject({ countdown: 2, phase: 'countdown' });
    expect(revealPresentationAt(1_800)).toMatchObject({ countdown: 1, phase: 'countdown' });
    expect(revealPresentationAt(2_700)).toMatchObject({
      phase: 'first_reveal',
      showLeft: true,
      showResolution: false,
      showRight: false,
    });
    expect(revealPresentationAt(4_100)).toMatchObject({
      phase: 'second_reveal',
      showLeft: true,
      showResolution: false,
      showRight: true,
    });
    expect(revealPresentationAt(5_500)).toMatchObject({
      isComplete: true,
      phase: 'resolution',
      showResolution: true,
    });
  });

  test('uses an immediate staged disclosure when reduced motion is enabled', () => {
    expect(revealPresentationAt(0, true).phase).toBe('first_reveal');
    expect(revealPresentationAt(600, true).phase).toBe('second_reveal');
    expect(revealPresentationAt(1_200, true).phase).toBe('resolution');
  });

  test('recovers a mid-sequence reload and safely completes an elapsed sequence', () => {
    const stored = parseStoredRevealTimeline(
      JSON.stringify({ resultKey: 'result_hash', startedAt: 1_000 }),
    );
    const resumedAt = recoverRevealStartedAt(stored, 'result_hash', 3_500);

    expect(resumedAt).toBe(1_000);
    expect(revealPresentationAt(3_500 - resumedAt)).toMatchObject({
      countdown: 1,
      phase: 'countdown',
    });
    expect(revealPresentationAt(7_000 - resumedAt).phase).toBe('resolution');
    expect(recoverRevealStartedAt(stored, 'different_result', 3_500)).toBe(3_500);
    expect(
      recoverRevealStartedAt({ resultKey: 'result_hash', startedAt: -1 }, 'result_hash', 3_500),
    ).toBe(3_500);
    expect(
      recoverRevealStartedAt({ resultKey: 'result_hash', startedAt: 4_000 }, 'result_hash', 3_500),
    ).toBe(3_500);
    expect(parseStoredRevealTimeline(null)).toBeNull();
    expect(parseStoredRevealTimeline('{"resultKey":1,"startedAt":"now"}')).toBeNull();
    expect(parseStoredRevealTimeline('{not-json')).toBeNull();
  });

  test('labels winner, loser, and tie states from the viewer-oriented result', () => {
    expect(revealSideResolution('you', 'you')).toBe('winner');
    expect(revealSideResolution('you', 'opponent')).toBe('loser');
    expect(revealSideResolution('opponent', 'you')).toBe('loser');
    expect(revealSideResolution('tie', 'you')).toBe('tie');
    expect(revealSideResolution('tie', 'opponent')).toBe('tie');
    expect(revealSideResolution(null, 'you')).toBeNull();
  });

  test('snapshots countdown, first pull, second pull, winner, loser, and tie compositions', () => {
    expect(visualSnapshot(revealPresentationAt(0), 'you')).toMatchInlineSnapshot(`
      "phase=countdown
      countdown=3
      you=sealed
      opponent=sealed
      resolution=hidden"
    `);
    expect(visualSnapshot(revealPresentationAt(2_700), 'you')).toMatchInlineSnapshot(`
      "phase=first_reveal
      countdown=off
      you=revealed
      opponent=sealed
      resolution=hidden"
    `);
    expect(visualSnapshot(revealPresentationAt(4_100), 'you')).toMatchInlineSnapshot(`
      "phase=second_reveal
      countdown=off
      you=revealed
      opponent=revealed
      resolution=hidden"
    `);
    expect(visualSnapshot(revealPresentationAt(5_500), 'you')).toMatchInlineSnapshot(`
      "phase=resolution
      countdown=off
      you=winner
      opponent=loser
      resolution=visible"
    `);
    expect(visualSnapshot(revealPresentationAt(5_500), 'opponent')).toMatchInlineSnapshot(`
      "phase=resolution
      countdown=off
      you=loser
      opponent=winner
      resolution=visible"
    `);
    expect(visualSnapshot(revealPresentationAt(5_500), 'tie')).toMatchInlineSnapshot(`
      "phase=resolution
      countdown=off
      you=tie
      opponent=tie
      resolution=visible"
    `);
  });
});

function visualSnapshot(
  presentation: RevealPresentation,
  winner: 'opponent' | 'tie' | 'you',
): string {
  const sideState = (side: 'opponent' | 'you', visible: boolean) => {
    if (!visible) return 'sealed';
    return presentation.showResolution ? revealSideResolution(winner, side) : 'revealed';
  };

  return [
    `phase=${presentation.phase}`,
    `countdown=${presentation.countdown ?? 'off'}`,
    `you=${sideState('you', presentation.showLeft)}`,
    `opponent=${sideState('opponent', presentation.showRight)}`,
    `resolution=${presentation.showResolution ? 'visible' : 'hidden'}`,
  ].join('\n');
}
