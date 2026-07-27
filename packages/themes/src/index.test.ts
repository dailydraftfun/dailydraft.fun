import { describe, expect, test } from 'bun:test';

import { THEME_RARITIES, validateThemePack } from '@dailydraft/contracts/theme-pack';

import { collectorCryptThemePack, devnetDemoThemePack } from './index.js';

describe('theme packs', () => {
  test('ships two valid, independent theme-pack fixtures', () => {
    for (const theme of [devnetDemoThemePack, collectorCryptThemePack]) {
      expect(validateThemePack(theme).ok).toBe(true);
      expect(Object.keys(theme.rarity).sort()).toEqual([...THEME_RARITIES].sort());
    }
    expect(devnetDemoThemePack.id).not.toBe(collectorCryptThemePack.id);
  });

  test('keeps Collector Crypt art and metadata behind the provider boundary', () => {
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
  });
});
