import { describe, expect, spyOn, test } from 'bun:test';
import { themePackContractFixtures } from '@dailydraft/contracts/theme-pack';
import { resolveThemePack } from '@dailydraft/engine';
import { Assets, Container, Texture, type Ticker } from '@dailydraft/engine/pixi';

import { gachaRevealSceneMetadata } from './gacha-reveal-contract';
import { gachaRevealPixiScene } from './gacha-reveal-pixi-scene';

describe('gacha reveal Pixi scene definition', () => {
  test('loads as a scene matching the lazy binding contract', async () => {
    expect(gachaRevealPixiScene.id).toBe(gachaRevealSceneMetadata.id);
    expect(gachaRevealPixiScene.designSize).toEqual({ height: 560, width: 720 });
    expect(gachaRevealPixiScene.create).toBeFunction();
  });

  test('stages only the supplied settled result and owns its full renderer lifecycle', async () => {
    const load = spyOn(Assets, 'load').mockResolvedValue(Texture.WHITE as never);
    const stage = new Container();
    let tick = (_ticker: Ticker): void => {
      throw new Error('Expected the scene to register a ticker callback');
    };
    let removeCount = 0;
    const application = {
      ticker: {
        add(callback: (ticker: Ticker) => void) {
          tick = callback;
        },
        remove(callback: (ticker: Ticker) => void) {
          if (callback === tick) removeCount += 1;
        },
      },
    };

    const instance = await gachaRevealPixiScene.create({
      application,
      budget: {},
      props: {
        cardImageUrl: 'https://images.pokemontcg.io/base1-4.png',
        displayName: 'Charizard Holo',
        rarity: 'rare',
        revealId: 'settled-rip-1',
        themeId: 'dailydraft-demo',
        themeVersion: '1.0.0',
      },
      quality: 'high',
      stage,
      viewport: { height: 560, resolution: 2, width: 720 },
    } as never);

    expect(load).toHaveBeenCalledWith('https://images.pokemontcg.io/base1-4.png');
    expect(stage.children).toHaveLength(1);
    expect(stage.children[0]?.label).toBe('server-settled-gacha-settled-rip-1');

    tick({ elapsedMS: Number.NaN } as Ticker);
    for (let frame = 0; frame < 120; frame += 1) {
      tick({ elapsedMS: 50 } as Ticker);
    }

    const theme = resolveThemePack(themePackContractFixtures.devnetDemo);
    if (theme.status !== 'ready') throw new Error('Expected the bundled theme to resolve');
    instance.applyTheme?.({
      art: theme.theme.art,
      audio: theme.theme.audio,
      rarity: 'chase',
      themeId: theme.theme.id,
      treatment: theme.theme.rarity.chase,
    });
    instance.resize({ height: 280, resolution: 1, width: 360 });
    instance.setQuality?.('low', {} as never);
    instance.destroy();
    instance.destroy();

    expect(removeCount).toBe(1);
    expect(stage.children).toHaveLength(0);
    load.mockRestore();
  });

  test('fails before presentation for an unavailable theme or aborted art load', async () => {
    const load = spyOn(Assets, 'load').mockResolvedValue(Texture.WHITE as never);
    const baseContext = {
      application: { ticker: { add: () => undefined, remove: () => undefined } },
      budget: {},
      props: {
        cardImageUrl: 'https://images.pokemontcg.io/base1-4.png',
        displayName: 'Charizard Holo',
        rarity: 'rare',
        revealId: 'settled-rip-1',
        themeId: 'untrusted-theme',
        themeVersion: '1.0.0',
      },
      quality: 'high',
      stage: new Container(),
      viewport: { height: 560, resolution: 2, width: 720 },
    } as const;

    await expect(gachaRevealPixiScene.create(baseContext as never)).rejects.toThrow(
      'not an available bundled version',
    );

    const abortController = new AbortController();
    abortController.abort();
    await expect(
      gachaRevealPixiScene.create({
        ...baseContext,
        props: {
          ...baseContext.props,
          themeId: 'dailydraft-demo',
        },
        signal: abortController.signal,
      } as never),
    ).rejects.toMatchObject({ name: 'AbortError' });
    load.mockRestore();
  });
});
