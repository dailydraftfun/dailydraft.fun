import { describe, expect, test } from 'bun:test';
import { type BlurFilter, type BlurFilterOptions, Container } from 'pixi.js';

import {
  createBloomFilter,
  createGlowFilter,
  ParticleEmitter,
  type ParticleSpawn,
} from './effects.js';

describe('tiered Pixi effect building blocks', () => {
  test('bounds bursts to the current quality budget', () => {
    const stage = new Container<Container>();
    const emitter = new ParticleEmitter(stage, 'low');

    expect(emitter.emitBurst(100, particleFactory())).toBe(16);
    expect(emitter.activeCount).toBe(16);
    expect(stage.children).toHaveLength(16);
    expect(emitter.emitBurst(1, particleFactory())).toBe(0);
  });

  test('updates particle motion, fade, scale, spin, and expiry deterministically', () => {
    const stage = new Container<Container>();
    const display = new Container();
    const emitter = new ParticleEmitter(stage);

    emitter.emitBurst(1, () => ({
      display,
      endScale: 2,
      lifetimeMs: 1_000,
      spinRadiansPerSecond: 2,
      startScale: 1,
      velocityX: 100,
      velocityY: -50,
    }));
    emitter.update(500);

    expect(display.x).toBe(50);
    expect(display.y).toBe(-25);
    expect(display.rotation).toBe(1);
    expect(display.alpha).toBe(0.5);
    expect(display.scale.x).toBe(1.5);
    expect(display.scale.y).toBe(1.5);

    emitter.update(500);
    expect(emitter.activeCount).toBe(0);
    expect(stage.children).toHaveLength(0);
    expect(display.destroyed).toBe(true);
  });

  test('trims active particles on downgrade and clears owned display objects', () => {
    const stage = new Container<Container>();
    const displays: Container[] = [];
    const emitter = new ParticleEmitter(stage, 'high');

    emitter.emitBurst(20, (index) => {
      const display = new Container();
      displays[index] = display;
      return {
        display,
        lifetimeMs: 1_000,
        velocityX: 0,
        velocityY: 0,
      };
    });
    emitter.setQuality('low');

    expect(emitter.activeCount).toBe(16);
    expect(stage.children).toHaveLength(16);
    expect(displays.slice(16).every((display) => display.destroyed)).toBe(true);

    emitter.clear();
    emitter.clear();
    expect(emitter.activeCount).toBe(0);
    expect(stage.children).toHaveLength(0);
  });

  test('ignores invalid updates and particle requests', () => {
    const stage = new Container<Container>();
    const emitter = new ParticleEmitter(stage);

    expect(emitter.emitBurst(-1, particleFactory())).toBe(0);
    expect(
      emitter.emitBurst(1, () => ({
        display: new Container(),
        lifetimeMs: Number.NaN,
        velocityX: 0,
        velocityY: 0,
      })),
    ).toBe(0);
    emitter.update(Number.NaN);
    emitter.update(0);
    expect(emitter.activeCount).toBe(0);
  });

  test('creates glow and bloom filters only inside the tier budget', () => {
    const options: BlurFilterOptions[] = [];
    const createFilter = (filterOptions: BlurFilterOptions): BlurFilter => {
      options.push(filterOptions);
      return {
        quality: filterOptions.quality,
        strength: filterOptions.strength,
      } as unknown as BlurFilter;
    };
    const highGlow = createGlowFilter('high', createFilter);
    const mediumBloom = createBloomFilter('medium', createFilter);

    expect(highGlow?.strength).toBe(12);
    expect(highGlow?.quality).toBe(3);
    expect(mediumBloom?.strength).toBe(6);
    expect(mediumBloom?.quality).toBe(2);
    expect(createGlowFilter('low', createFilter)).toBeNull();
    expect(createBloomFilter('low', createFilter)).toBeNull();
    expect(options).toEqual([
      { kernelSize: 9, quality: 3, strength: 12 },
      { kernelSize: 5, quality: 2, strength: 6 },
    ]);
  });
});

function particleFactory(): (index: number) => ParticleSpawn<Container> {
  return () => ({
    display: new Container(),
    lifetimeMs: 1_000,
    velocityX: 0,
    velocityY: 0,
  });
}
