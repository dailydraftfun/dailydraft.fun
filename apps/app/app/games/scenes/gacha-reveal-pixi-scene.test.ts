import { describe, expect, test } from 'bun:test';

import { gachaRevealSceneMetadata } from './gacha-reveal-contract';

describe('gacha reveal Pixi scene definition', () => {
  test('loads as a scene matching the lazy binding contract', async () => {
    const { gachaRevealPixiScene } = await import('./gacha-reveal-pixi-scene');

    expect(gachaRevealPixiScene.id).toBe(gachaRevealSceneMetadata.id);
    expect(gachaRevealPixiScene.designSize).toEqual({ height: 560, width: 720 });
    expect(gachaRevealPixiScene.create).toBeFunction();
  });
});
