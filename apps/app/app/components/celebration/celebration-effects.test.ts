import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import {
  celebrationEffectProfileFor,
  celebrationStaticLabel,
  particleOpacity,
  spawnCelebrationParticles,
  stepCelebrationParticle,
} from './celebration-effects';

const rarities = ['common', 'uncommon', 'rare', 'chase'] as const satisfies PullRarity[];

describe('celebration effect profiles', () => {
  test('scales effects monotonically across the canonical rarity tiers', () => {
    const profiles = rarities.map((rarity) => celebrationEffectProfileFor(rarity));

    expect(profiles.map(({ particleCount }) => particleCount)).toEqual([12, 28, 52, 84]);
    expect(profiles.map(({ durationMs }) => durationMs)).toEqual([280, 360, 470, 600]);
    expect(profiles.map(({ glowIntensity }) => glowIntensity)).toEqual([0.18, 0.42, 0.72, 1]);
    expect(profiles.map(({ screenAccent }) => screenAccent)).toEqual([
      'none',
      'edge',
      'edge',
      'full',
    ]);
    expect(profiles[0]?.burstCount).toBe(1);
    expect(profiles[3]?.burstCount).toBe(2);
  });

  test('adds a bounded within-tier value bonus and fails closed for invalid values', () => {
    const baseRare = celebrationEffectProfileFor('rare');
    const floorRare = celebrationEffectProfileFor('rare', 50);
    const highRare = celebrationEffectProfileFor('rare', 150);
    const aboveRare = celebrationEffectProfileFor('rare', 10_000);

    expect(floorRare).toEqual(baseRare);
    expect(highRare.particleCount).toBe(65);
    expect(aboveRare).toEqual(highRare);
    expect(celebrationEffectProfileFor('rare', Number.NaN)).toEqual(baseRare);
    expect(celebrationEffectProfileFor('rare', -1)).toEqual(baseRare);
    expect(celebrationEffectProfileFor('common', 9).particleCount).toBe(15);
    expect(celebrationEffectProfileFor('chase', 600).particleCount).toBe(105);
  });

  test('spawns deterministic bounded particles and advances their lifecycle', () => {
    const profile = celebrationEffectProfileFor('chase');
    const particle = spawnCelebrationParticles(profile, () => 0.5)[1];
    if (!particle) throw new Error('Expected the chase profile to create a second particle');

    expect(particle).toMatchObject({
      color: '#73fbd3',
      delayMs: 144,
      x: 0.5,
      y: 0.54,
    });
    expect(particleOpacity(particle, profile.durationMs)).toBe(0);

    stepCelebrationParticle(particle, 100);
    expect(particle.delayMs).toBe(44);
    stepCelebrationParticle(particle, 100);
    expect(particle.delayMs).toBe(0);
    stepCelebrationParticle(particle, 16);
    expect(particle.x).toBeLessThan(0.5);
    expect(particleOpacity(particle, profile.durationMs)).toBeGreaterThan(0);

    particle.lifeMs = 0;
    expect(particleOpacity(particle, profile.durationMs)).toBe(0);
    expect(particleOpacity({ ...particle, lifeMs: 60 }, 0)).toBe(1);
  });

  test('keeps the pure effect module browser- and React-free', () => {
    const source = readFileSync(new URL('./celebration-effects.ts', import.meta.url), 'utf8');

    expect(source).toContain("from '@dailydraft/contracts/pull-rarity'");
    expect(source).not.toMatch(/from '@dailydraft\/contracts';/);
    expect(source).not.toMatch(/\b(?:document|window|react)\b/i);
    expect(celebrationStaticLabel('chase')).toBe('Chase pull revealed');
  });
});
