import { describe, expect, test } from 'bun:test';
import { gameModes, playableGameModes } from './game-catalog';

describe('game catalog', () => {
  test('keeps only capability-backed modes actionable', () => {
    expect(playableGameModes()).toEqual([
      expect.objectContaining({
        availability: 'playable',
        href: '/overview',
        id: 'duels',
      }),
    ]);
  });

  test('keeps Gacha, Tournaments, and Streak visible without executable routes', () => {
    const flip = gameModes.find((mode) => mode.id === 'flip');
    const tournaments = gameModes.find((mode) => mode.id === 'tournaments');
    const crash = gameModes.find((mode) => mode.id === 'crash');

    expect(flip).toMatchObject({ availability: 'preview', href: null });
    expect(tournaments).toMatchObject({ availability: 'gated', href: null });
    expect(crash).toMatchObject({ availability: 'gated', href: null });
  });
});
