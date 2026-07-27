import { describe, expect, test } from 'bun:test';

import { defineSceneMetadata } from './types.js';

describe('scene fallback contract', () => {
  test('preserves required reduced-motion and no-WebGL DOM equivalents', () => {
    const metadata = defineSceneMetadata({
      designSize: { height: 620, width: 390 },
      fallback: {
        noWebGL: {
          id: 'dom-pack-reveal',
          label: 'Card reveal',
          preserves: ['card identity', 'rarity', 'settlement'],
        },
        reducedMotion: {
          id: 'dom-pack-reveal-static',
          label: 'Card reveal without motion',
          preserves: ['card identity', 'rarity', 'settlement'],
        },
      },
      id: 'pack-open',
    });

    expect(metadata.fallback.noWebGL.preserves).toEqual(['card identity', 'rarity', 'settlement']);
    expect(metadata.fallback.reducedMotion.id).toBe('dom-pack-reveal-static');
  });
});
