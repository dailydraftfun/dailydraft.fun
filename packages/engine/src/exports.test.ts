import { describe, expect, test } from 'bun:test';

import * as engine from './index.js';
import * as pixi from './pixi.js';

describe('engine package entrypoints', () => {
  test('keep pure contracts separate from the Pixi-specific surface', () => {
    expect(engine).toMatchObject({
      ChoreographyClock: expect.any(Function),
      FrameBudgetMonitor: expect.any(Function),
      createChoreographyTimeline: expect.any(Function),
      defineSceneMetadata: expect.any(Function),
    });
    expect(pixi).toMatchObject({
      ParticleEmitter: expect.any(Function),
      createBloomFilter: expect.any(Function),
      createGlowFilter: expect.any(Function),
      definePixiScene: expect.any(Function),
      mountPixiScene: expect.any(Function),
    });
    expect('mountPixiScene' in engine).toBe(false);
  });
});
