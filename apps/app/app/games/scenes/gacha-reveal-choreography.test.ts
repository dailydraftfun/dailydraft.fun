import { describe, expect, test } from 'bun:test';

import {
  engineRarityForGachaBand,
  gachaRevealDurationMs,
  gachaRevealFrameAt,
  gachaRevealParticle,
  particleBurstCount,
} from './gacha-reveal-choreography';

describe('gacha reveal choreography', () => {
  test('maps only the server-committed gacha band to an engine rarity', () => {
    expect(engineRarityForGachaBand('base')).toBe('common');
    expect(engineRarityForGachaBand('plus')).toBe('uncommon');
    expect(engineRarityForGachaBand('premium')).toBe('rare');
    expect(engineRarityForGachaBand('chase')).toBe('chase');
  });

  test('moves from a sealed pack to the settled server result', () => {
    const sealed = gachaRevealFrameAt('rare', 0);
    const settled = gachaRevealFrameAt('rare', gachaRevealDurationMs('rare') + 1);

    expect(sealed).toMatchObject({
      beat: 'anticipation',
      cardAlpha: 0,
      packAlpha: 1,
      settled: false,
    });
    expect(settled).toMatchObject({
      beat: 'settled',
      cardAlpha: 1,
      packAlpha: 0,
      settled: true,
    });
  });

  test('scales celebration density by committed rarity', () => {
    expect(particleBurstCount('common')).toBeLessThan(particleBurstCount('uncommon'));
    expect(particleBurstCount('uncommon')).toBeLessThan(particleBurstCount('rare'));
    expect(particleBurstCount('rare')).toBeLessThan(particleBurstCount('chase'));
  });

  test('generates stable decorative particles without outcome randomness', () => {
    expect(gachaRevealParticle(7, 42, 'rare')).toEqual(gachaRevealParticle(7, 42, 'rare'));
    expect(gachaRevealParticle(7, 42, 'rare')).not.toEqual(gachaRevealParticle(8, 42, 'rare'));
  });
});
