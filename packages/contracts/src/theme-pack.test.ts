import { describe, expect, test } from 'bun:test';

import {
  THEME_ART_SLOTS,
  THEME_AUDIO_CUES,
  THEME_PACK_SCHEMA_VERSION,
  THEME_RARITIES,
  themePackContractFixtures,
  validateThemePack,
} from './theme-pack.js';

function mutableFixture(): Record<string, unknown> {
  return structuredClone(themePackContractFixtures.devnetDemo) as Record<string, unknown>;
}

describe('versioned theme-pack contract', () => {
  test('keeps the committed fixture aligned with the v1 schema', () => {
    const fixture = themePackContractFixtures.devnetDemo;

    expect(themePackContractFixtures.schemaVersion).toBe(THEME_PACK_SCHEMA_VERSION);
    expect(validateThemePack(fixture)).toEqual({ ok: true, value: fixture });
    expect(Object.keys(fixture).sort()).toEqual([
      'art',
      'audio',
      'id',
      'name',
      'rarity',
      'schemaVersion',
      'source',
      'version',
    ]);
    expect(Object.keys(fixture.art).sort()).toEqual([...THEME_ART_SLOTS].sort());
    expect(Object.keys(fixture.audio.cues).sort()).toEqual([...THEME_AUDIO_CUES].sort());
    expect(Object.keys(fixture.rarity).sort()).toEqual([...THEME_RARITIES].sort());
  });

  test('fails closed on schema or source drift', () => {
    const unsupportedSchema = mutableFixture();
    unsupportedSchema.schemaVersion = 'dailydraft.theme-pack.v2';

    const invalidProvider = mutableFixture();
    invalidProvider.source = {
      contract: 'partner-api',
      kind: 'provider',
      mode: 'collector-crypt-production',
      provider: 'collector-crypt',
    };

    const unknownSource = mutableFixture();
    unknownSource.source = { kind: 'remote' };

    const embeddedProviderData = mutableFixture();
    embeddedProviderData.source = {
      contract: 'pack-provider',
      kind: 'provider',
      mode: 'collector-crypt-sandbox',
      provider: 'collector-crypt',
    };
    embeddedProviderData.metadata = { cardName: 'embedded card' };
    const embeddedArt = embeddedProviderData.art as Record<string, string>;
    embeddedArt.cardFace = 'https://provider.invalid/card-face.png';

    expect(validateThemePack(unsupportedSchema)).toMatchObject({
      issues: [`schemaVersion must be ${THEME_PACK_SCHEMA_VERSION}`],
      ok: false,
    });
    const invalidProviderResult = validateThemePack(invalidProvider);
    expect(invalidProviderResult.ok).toBe(false);
    if (invalidProviderResult.ok) throw new Error('expected invalid provider source');
    expect(invalidProviderResult.issues).toContain(
      'provider source must use the gated Collector Crypt pack-provider contract',
    );
    expect(validateThemePack(unknownSource)).toMatchObject({
      issues: ['source.kind must be bundled or provider'],
      ok: false,
    });
    const embeddedProviderResult = validateThemePack(embeddedProviderData);
    expect(embeddedProviderResult.ok).toBe(false);
    if (embeddedProviderResult.ok) throw new Error('expected embedded provider data to fail');
    expect(embeddedProviderResult.issues).toContain(
      'provider themes must not embed provider metadata',
    );
    expect(embeddedProviderResult.issues).toContain('art.cardFace must be an opaque provider key');
  });

  test('rejects incomplete art, rarity, and audio banks', () => {
    const incomplete = mutableFixture();
    incomplete.art = {};
    incomplete.rarity = {};
    incomplete.audio = {};

    const result = validateThemePack(incomplete);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid theme pack');
    expect(result.issues).toContain('art.cardFace must be a non-empty string');
    expect(result.issues).toContain('rarity.common must define palette and foil');
    expect(result.issues).toContain('audio must define a bankId and cues');
  });

  test('rejects malformed palette, foil, and cue values', () => {
    const malformed = mutableFixture();
    const rarity = malformed.rarity as Record<string, Record<string, Record<string, unknown>>>;
    const commonPalette = rarity.common?.palette;
    const commonFoil = rarity.common?.foil;
    if (!commonPalette || !commonFoil) throw new Error('expected common fixture treatment');
    commonPalette.accent = 'silver';
    commonPalette.surface = ['#FFFFFF'];
    commonFoil.brightness = 2;
    commonFoil.speed = Number.POSITIVE_INFINITY;

    const audio = malformed.audio as {
      cues: Record<string, Record<string, unknown>>;
    };
    if (audio.cues.reveal) audio.cues.reveal.gain = -1;

    const result = validateThemePack(malformed);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid theme pack');
    expect(result.issues).toContain('rarity.common.palette.accent must be a six-digit hex color');
    expect(result.issues).toContain(
      'rarity.common.palette.surface must contain two six-digit hex colors',
    );
    expect(result.issues).toContain('rarity.common.foil.brightness must be between 0 and 1');
    expect(result.issues).toContain('rarity.common.foil.speed must be between 0 and 4');
    expect(result.issues).toContain(
      'audio.cues.reveal must define an assetRef and gain between 0 and 1',
    );
  });

  test('rejects non-object and incomplete identity/source inputs', () => {
    expect(validateThemePack(null)).toEqual({
      issues: ['theme pack must be an object'],
      ok: false,
    });

    const incomplete = mutableFixture();
    incomplete.id = ' ';
    incomplete.source = {};

    const result = validateThemePack(incomplete);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid theme pack');
    expect(result.issues).toContain('id must be a non-empty string');
    expect(result.issues).toContain('source.kind must be bundled or provider');
  });
});
