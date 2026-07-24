import { describe, expect, test } from 'bun:test';
import { gameModes, playableGameModes, resolveFlipAvailability } from './game-catalog';

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

  test('keeps Flip and Crash visible without executable routes', () => {
    const flip = gameModes.find((mode) => mode.id === 'flip');
    const crash = gameModes.find((mode) => mode.id === 'crash');

    expect(flip).toMatchObject({ availability: 'preview', href: null });
    expect(crash).toMatchObject({ availability: 'gated', href: null });
  });

  test('promotes Flip only when every runtime capability gate passes', () => {
    expect(
      resolveFlipAvailability({
        acquisition: true,
        odds: true,
        provider: true,
        settlement: true,
      }),
    ).toMatchObject({
      availability: 'playable',
      href: '/games/flip',
    });
  });

  test('keeps Flip in preview when any single runtime gate is unavailable', () => {
    const gates = ['provider', 'odds', 'acquisition', 'settlement'] as const;

    for (const gate of gates) {
      expect(
        resolveFlipAvailability({
          acquisition: gate !== 'acquisition',
          odds: gate !== 'odds',
          provider: gate !== 'provider',
          settlement: gate !== 'settlement',
        }),
      ).toMatchObject({ availability: 'preview', href: null });
    }
  });
});
