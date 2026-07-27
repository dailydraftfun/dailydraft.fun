import { describe, expect, test } from 'bun:test';
import {
  buildGameModes,
  type FlipCapabilities,
  flipDevnetCapabilities,
  playableGameModes,
  resolveFlipAvailability,
} from './game-catalog';

// Flip's lobby row now moves with NEXT_PUBLIC_PROVIDER_MODE, so every assertion
// below builds the catalog from explicit gates. Reading the ambient default
// would make these tests pass or fail on whether the machine happens to carry an
// apps/app/.env, which Bun would auto-load.
const CLOSED: FlipCapabilities = {
  acquisition: false,
  odds: false,
  provider: false,
  settlement: false,
};

const OPEN: FlipCapabilities = { acquisition: true, odds: true, provider: true, settlement: true };

describe('game catalog', () => {
  test('keeps only capability-backed modes actionable', () => {
    expect(playableGameModes(buildGameModes(CLOSED))).toEqual([
      expect.objectContaining({
        availability: 'playable',
        href: '/overview',
        id: 'duels',
      }),
    ]);
  });

  test('keeps Gacha, Tournaments, and Streak visible without value-bearing routes', () => {
    const modes = buildGameModes(CLOSED);
    const flip = modes.find((mode) => mode.id === 'flip');
    const tournaments = modes.find((mode) => mode.id === 'tournaments');
    const crash = modes.find((mode) => mode.id === 'crash');

    expect(flip).toMatchObject({
      availability: 'preview',
      detailsHref: '/games/flip',
      eyebrow: 'Collector Crypt · next',
      href: null,
    });
    expect(crash).toMatchObject({
      availability: 'gated',
      detailsHref: '/games/crash',
      href: null,
    });
    // Fantasy Tournaments has no fixture preview yet, so it must expose no
    // details route at all rather than pointing at one that would 404.
    expect(tournaments).toMatchObject({ availability: 'gated', href: null });
    expect(tournaments?.detailsHref).toBeUndefined();
  });

  test('opens the Flip row and drops the Collector Crypt promise on devnet', () => {
    const modes = buildGameModes(OPEN);
    const flip = modes.find((mode) => mode.id === 'flip');

    expect(playableGameModes(modes).map((mode) => mode.id)).toEqual(['duels', 'flip']);
    // Devnet inventory is DailyDraft's own, so the gated copy naming Collector
    // Crypt would be inaccurate in the other direction once the row goes live.
    expect(flip).toMatchObject({
      availability: 'playable',
      eyebrow: 'Live devnet mode',
      href: '/games/flip',
      trustContract: 'Committed odds, sealed inventory, and a verified deposit before any reveal.',
    });
  });

  test('mirrors the API capability gates off the provider mode', () => {
    expect(flipDevnetCapabilities('dailydraft-devnet')).toEqual(OPEN);
  });

  test('leaves every gate closed for any provider mode but devnet', () => {
    for (const providerMode of ['', 'mock', 'collector-crypt', 'collector-crypt-sandbox']) {
      expect(flipDevnetCapabilities(providerMode)).toEqual(CLOSED);
    }
  });

  test('promotes Flip only when every runtime capability gate passes', () => {
    expect(resolveFlipAvailability(OPEN)).toMatchObject({
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
