import { describe, expect, test } from 'bun:test';

import {
  THEME_PROVIDER_ASSET_SCHEMA_VERSION,
  THEME_RARITIES,
  type ThemeProviderAssetSnapshot,
  validateThemePack,
} from '@dailydraft/contracts/theme-pack';
import { collectorCryptThemePack, devnetDemoThemePack } from '@dailydraft/themes';

import { applyThemeToScene, resolveThemePack, type SceneThemeStyle } from './theme.js';

function collectorSnapshot(): ThemeProviderAssetSnapshot {
  return {
    assets: Object.fromEntries(
      Object.values(collectorCryptThemePack.art).map((key) => [
        key,
        `https://provider.invalid/assets/${key}`,
      ]),
    ),
    metadata: {
      attribution: 'Collector Crypt sandbox',
      cardName: 'Provider-owned fixture',
    },
    provider: 'collector-crypt',
    providerMode: 'collector-crypt-sandbox',
    schemaVersion: THEME_PROVIDER_ASSET_SCHEMA_VERSION,
    themeId: collectorCryptThemePack.id,
    themeVersion: collectorCryptThemePack.version,
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

  test('keeps Collector Crypt art keys and card metadata behind the provider snapshot', () => {
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

  test('fails closed for malformed, mismatched, or incomplete provider snapshots', () => {
    const mismatch = {
      ...collectorSnapshot(),
      themeVersion: '2.0.0',
    };
    const incomplete = {
      ...collectorSnapshot(),
      assets: {},
    };

    expect(resolveThemePack(collectorCryptThemePack, null)).toEqual({
      reason: 'invalid-provider-snapshot',
      status: 'unavailable',
    });
    expect(resolveThemePack(collectorCryptThemePack, mismatch)).toEqual({
      reason: 'provider-snapshot-mismatch',
      status: 'unavailable',
    });
    expect(resolveThemePack(collectorCryptThemePack, incomplete)).toEqual({
      reason: 'provider-assets-incomplete',
      status: 'unavailable',
    });
    expect(resolveThemePack({ schemaVersion: 'unknown' })).toEqual({
      reason: 'invalid-theme-pack',
      status: 'unavailable',
    });
  });

  test('resolves Collector Crypt art and metadata only from a gated normalized snapshot', () => {
    const snapshot = collectorSnapshot();
    const resolution = resolveThemePack(collectorCryptThemePack, snapshot);

    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') throw new Error('expected ready theme');
    const expectedCardFace = snapshot.assets[collectorCryptThemePack.art.cardFace];
    if (!expectedCardFace) throw new Error('expected card-face fixture asset');
    expect(resolution.theme.art.cardFace).toBe(expectedCardFace);
    expect(resolution.theme.metadata).toEqual(snapshot.metadata);
  });

  test('restyles one unchanged scene adapter by swapping only theme data', () => {
    const styles: SceneThemeStyle[] = [];
    const scene = {
      applyTheme(style: SceneThemeStyle) {
        styles.push(style);
      },
    };
    const demo = resolveThemePack(devnetDemoThemePack);
    const collector = resolveThemePack(collectorCryptThemePack, collectorSnapshot());

    if (demo.status !== 'ready' || collector.status !== 'ready') {
      throw new Error('expected both theme fixtures to resolve');
    }

    applyThemeToScene(scene, demo.theme, 'rare');
    applyThemeToScene(scene, collector.theme, 'rare');

    expect(styles).toHaveLength(2);
    expect(styles[0]?.themeId).toBe('dailydraft-demo');
    expect(styles[1]?.themeId).toBe('collector-crypt');
    expect(styles[0]?.art).not.toEqual(styles[1]?.art);
    expect(styles[0]?.treatment).not.toEqual(styles[1]?.treatment);
    expect(styles.every((style) => style.rarity === 'rare')).toBe(true);
  });
});
