import { describe, expect, test } from 'bun:test';

import {
  assertThemePackDefinition,
  defineThemePack,
  THEME_PACK_SCHEMA_VERSION,
  themeArtSlots,
  themeAudioCues,
  themePackCompatibilityFixtures,
  themePackValidationErrors,
  themeRarities,
} from './theme-pack.js';

describe('versioned theme-pack contract', () => {
  test('publishes stable Collector Crypt and devnet compatibility fixtures', () => {
    expect(themePackCompatibilityFixtures.schemaVersion).toBe(THEME_PACK_SCHEMA_VERSION);
    expect(themePackValidationErrors(themePackCompatibilityFixtures.collectorCrypt)).toEqual([]);
    expect(themePackValidationErrors(themePackCompatibilityFixtures.devnetDemo)).toEqual([]);
    expect(themeArtSlots).toEqual([
      'background',
      'cardBack',
      'cardFrame',
      'cardImage',
      'packBack',
      'packFront',
    ]);
    expect(themeAudioCues).toEqual(['anticipation', 'celebrate', 'reveal']);
    expect(themeRarities).toEqual(['common', 'uncommon', 'rare', 'chase']);
  });

  test('keeps Collector Crypt art provider-owned and HITL-gated', () => {
    const fixture = themePackCompatibilityFixtures.collectorCrypt;

    expect(fixture.source).toEqual({
      gate: 'hitl-required',
      kind: 'gated-provider',
      provider: 'collector-crypt',
      providerMode: 'collector-crypt-production',
    });
    expect(Object.values(fixture.art).every((asset) => asset.kind === 'provider')).toBe(true);
    expect(JSON.stringify(fixture)).not.toContain('https://');
    expect(JSON.stringify(fixture)).not.toContain('insuredValue');
  });

  test('defines valid packs without changing their literal type', () => {
    const fixture = themePackCompatibilityFixtures.devnetDemo;
    const defined = defineThemePack(fixture);

    expect(defined).toBe(fixture);
    expect(defined.source.providerMode).toBe('dailydraft-devnet');
  });

  test('rejects unsupported versions, malformed sources, and mixed art ownership', () => {
    const fixture = themePackCompatibilityFixtures.collectorCrypt;
    const errors = themePackValidationErrors({
      ...fixture,
      art: {
        ...fixture.art,
        background: { kind: 'bundled', uri: '/unsafe-fallback.svg' },
        cardImage: { field: 'cardFrame', kind: 'provider' },
      },
      id: 'not-versioned',
      schemaVersion: 'dailydraft.theme-pack.v2',
      source: {
        gate: 'bypassed',
        kind: 'gated-provider',
        provider: 'collector-crypt',
        providerMode: 'collector-crypt-production',
      },
    });

    expect(errors).toContain('schemaVersion is unsupported');
    expect(errors).toContain('id must be a versioned identifier');
    expect(errors).toContain('gated provider source must remain Collector Crypt HITL production');
    expect(errors).toContain('art.background must use provider assets');
    expect(errors).toContain('art.cardImage.field must equal cardImage');
  });

  test('reports malformed top-level, audio, palette, and bundled references', () => {
    expect(themePackValidationErrors(null)).toEqual(['definition must be an object']);

    const fixture = themePackCompatibilityFixtures.devnetDemo;
    const errors = themePackValidationErrors({
      ...fixture,
      art: {
        ...fixture.art,
        packFront: { kind: 'bundled', uri: 'https://untrusted.example/pack.svg' },
      },
      audio: { anticipation: { kind: 'provider' }, celebrate: null, reveal: null },
      displayName: '  ',
      rarities: {
        ...fixture.rarities,
        common: {
          ...fixture.rarities.common,
          accent: 'silver',
          foil: { enabled: true, intensity: 2, refraction: 0, speed: 0 },
        },
      },
      source: { kind: 'bundled', providerMode: 'production' },
    });

    expect(errors).toContain('displayName must not be empty');
    expect(errors).toContain('bundled source providerMode is unsupported');
    expect(errors).toContain('art.packFront.uri must be a bundled asset URI');
    expect(errors).toContain('audio.anticipation must be null or a bundled asset URI');
    expect(errors).toContain('rarities.common.accent must be a hex color');
    expect(errors).toContain('rarities.common.foil must use bounded parameters');
    expect(() => assertThemePackDefinition({})).toThrow('Invalid theme pack:');
  });
});
