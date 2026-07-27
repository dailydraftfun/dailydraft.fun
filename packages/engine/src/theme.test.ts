import { describe, expect, test } from 'bun:test';

import {
  THEME_RARITIES,
  type ThemePack,
  validateThemePack,
} from '@dailydraft/contracts/theme-pack';
import { collectorCryptThemePack, devnetDemoThemePack } from '@dailydraft/themes';

import { applyThemeToScene, resolveThemePack, type SceneThemeStyle } from './theme.js';

function alternateDemoThemePack(): ThemePack {
  return {
    ...devnetDemoThemePack,
    art: {
      ...devnetDemoThemePack.art,
      cardFace: 'theme://alternate-demo/card-face',
      sceneBackground: 'theme://alternate-demo/scene-background',
    },
    id: 'alternate-demo',
    name: 'Alternate Demo',
    rarity: {
      ...devnetDemoThemePack.rarity,
      rare: {
        ...devnetDemoThemePack.rarity.rare,
        palette: {
          ...devnetDemoThemePack.rarity.rare.palette,
          accent: '#F472B6',
        },
      },
    },
    source: {
      kind: 'bundled',
      namespace: 'alternate-demo',
    },
  };
}

describe('theme-pack pipeline', () => {
  test('ships two valid themes keyed to every canonical rarity tier', () => {
    for (const theme of [devnetDemoThemePack, collectorCryptThemePack]) {
      expect(validateThemePack(theme).ok).toBe(true);
      expect(Object.keys(theme.rarity).sort()).toEqual([...THEME_RARITIES].sort());

      for (const rarity of THEME_RARITIES) {
        expect(theme.rarity[rarity].palette.accent).toMatch(/^#[0-9A-F]{6}$/);
        expect(typeof theme.rarity[rarity].foil.brightness).toBe('number');
        expect(typeof theme.rarity[rarity].foil.glare).toBe('number');
        expect(typeof theme.rarity[rarity].foil.iridescence).toBe('number');
      }
    }
    expect(devnetDemoThemePack.id).not.toBe(collectorCryptThemePack.id);
  });

  test('keeps Collector Crypt art keys and card metadata behind the existing provider gate', () => {
    expect(collectorCryptThemePack.source).toEqual({
      contract: 'pack-provider',
      kind: 'provider',
      mode: 'collector-crypt-sandbox',
      provider: 'collector-crypt',
    });
    expect(
      Object.values(collectorCryptThemePack.art).every((reference) => !reference.includes('://')),
    ).toBe(true);
    expect('metadata' in collectorCryptThemePack).toBe(false);
    expect(resolveThemePack(collectorCryptThemePack)).toEqual({
      reason: 'provider-gate-closed',
      status: 'unavailable',
    });
  });

  test('has no client-supplied path around the Collector Crypt HITL dependency', () => {
    expect(resolveThemePack(collectorCryptThemePack)).toEqual({
      reason: 'provider-gate-closed',
      status: 'unavailable',
    });
    expect(resolveThemePack({ schemaVersion: 'unknown' })).toEqual({
      reason: 'invalid-theme-pack',
      status: 'unavailable',
    });
  });

  test('restyles one unchanged scene adapter by swapping only theme data', () => {
    const styles: SceneThemeStyle[] = [];
    const scene = {
      applyTheme(style: SceneThemeStyle) {
        styles.push(style);
      },
    };
    const demo = resolveThemePack(devnetDemoThemePack);
    const alternate = resolveThemePack(alternateDemoThemePack());

    if (demo.status !== 'ready' || alternate.status !== 'ready') {
      throw new Error('expected both theme fixtures to resolve');
    }

    applyThemeToScene(scene, demo.theme, 'rare');
    applyThemeToScene(scene, alternate.theme, 'rare');

    expect(styles).toHaveLength(2);
    expect(styles[0]?.themeId).toBe('dailydraft-demo');
    expect(styles[1]?.themeId).toBe('alternate-demo');
    expect(styles[0]?.art).not.toEqual(styles[1]?.art);
    expect(styles[0]?.treatment).not.toEqual(styles[1]?.treatment);
    expect(styles.every((style) => style.rarity === 'rare')).toBe(true);
  });
});
