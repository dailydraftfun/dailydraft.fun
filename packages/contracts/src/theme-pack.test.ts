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

function mutableProviderFixture(): Record<string, unknown> {
  const fixture = mutableFixture();
  fixture.source = {
    contract: 'pack-provider',
    kind: 'provider',
    mode: 'collector-crypt-sandbox',
    provider: 'collector-crypt',
  };
  fixture.art = {
    cardBack: 'theme.card.back',
    cardFace: 'theme.card.face',
    cardFrame: 'theme.card.frame',
    pack: 'theme.pack.closed',
    sceneBackground: 'theme.scene.background',
  };
  return fixture;
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

    const embeddedProviderData = mutableProviderFixture();
    embeddedProviderData.cardMetadata = { cardName: 'embedded card' };
    embeddedProviderData.cards = [{ cardName: 'embedded card' }];
    const embeddedArt = embeddedProviderData.art as Record<string, unknown>;
    embeddedArt.cardName = 'embedded card';

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
    expect(embeddedProviderResult.issues).toContain('themePack.cardMetadata is not allowed');
    expect(embeddedProviderResult.issues).toContain('themePack.cards is not allowed');
    expect(embeddedProviderResult.issues).toContain('art.cardName is not allowed');
  });

  test('accepts only positive opaque keys for provider art', () => {
    for (const directReference of [
      'data:image/png;base64,fixture',
      'blob:fixture',
      '//provider.invalid/card.png',
      '/assets/card.png',
      'https://provider.invalid/card.png',
    ]) {
      const fixture = mutableProviderFixture();
      const art = fixture.art as Record<string, string>;
      art.cardFace = directReference;

      const result = validateThemePack(fixture);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected direct provider art to fail');
      expect(result.issues).toContain('art.cardFace must be an opaque provider key');
    }
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
