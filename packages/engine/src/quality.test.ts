import { describe, expect, test } from 'bun:test';

import { FrameBudgetMonitor, lowerQualityTier, QUALITY_BUDGETS, qualityTiers } from './quality.js';

describe('adaptive Pixi quality policy', () => {
  test('publishes bounded, monotonically increasing tier budgets', () => {
    expect(qualityTiers).toEqual(['low', 'medium', 'high']);
    expect(QUALITY_BUDGETS.low).toEqual({
      bloomStrength: 0,
      blurQuality: 0,
      glowStrength: 0,
      maxFps: 30,
      maxParticles: 16,
      resolutionScale: 1,
    });
    expect(QUALITY_BUDGETS.medium.maxParticles).toBeLessThan(QUALITY_BUDGETS.high.maxParticles);
    expect(QUALITY_BUDGETS.medium.resolutionScale).toBeLessThan(
      QUALITY_BUDGETS.high.resolutionScale,
    );
  });

  test('degrades one tier per slow sample window and never below low', () => {
    const monitor = new FrameBudgetMonitor({
      initialTier: 'high',
      sampleSize: 2,
      slowFrameRatio: 0.5,
      tolerance: 1,
    });

    expect(monitor.recordFrame(20)).toBe('high');
    expect(monitor.recordFrame(20)).toBe('medium');
    expect(monitor.recordFrame(30)).toBe('medium');
    expect(monitor.recordFrame(30)).toBe('low');
    expect(monitor.recordFrame(100)).toBe('low');
    expect(lowerQualityTier('high')).toBe('medium');
    expect(lowerQualityTier('medium')).toBe('low');
    expect(lowerQualityTier('low')).toBe('low');
  });

  test('keeps a healthy tier and ignores invalid frame samples', () => {
    const monitor = new FrameBudgetMonitor({ initialTier: 'medium', sampleSize: 2 });

    expect(monitor.recordFrame(Number.NaN)).toBe('medium');
    expect(monitor.recordFrame(0)).toBe('medium');
    expect(monitor.recordFrame(16)).toBe('medium');
    expect(monitor.recordFrame(16)).toBe('medium');
  });

  test('normalizes invalid monitor options to safe defaults', () => {
    const monitor = new FrameBudgetMonitor({
      sampleSize: -1,
      slowFrameRatio: 2,
      tolerance: Number.NaN,
    });

    for (let index = 0; index < 29; index += 1) expect(monitor.recordFrame(100)).toBe('high');
    expect(monitor.recordFrame(100)).toBe('medium');
  });
});
