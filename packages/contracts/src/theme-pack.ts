import type { PullRarity } from './pull-rarity.js';

export const THEME_PACK_SCHEMA_VERSION = 'dailydraft.theme-pack.v1' as const;
export const THEME_PROVIDER_SOURCE_SCHEMA_VERSION = 'dailydraft.theme-provider-source.v1' as const;

export const themeArtSlots = [
  'background',
  'cardBack',
  'cardFrame',
  'cardImage',
  'packBack',
  'packFront',
] as const;
export type ThemeArtSlot = (typeof themeArtSlots)[number];

export const themeAudioCues = ['anticipation', 'celebrate', 'reveal'] as const;
export type ThemeAudioCue = (typeof themeAudioCues)[number];

export const themeRarities = [
  'common',
  'uncommon',
  'rare',
  'chase',
] as const satisfies readonly PullRarity[];

export type ThemeBundledAssetReference = Readonly<{
  kind: 'bundled';
  uri: string;
}>;

export type ThemeProviderAssetReference = Readonly<{
  field: ThemeArtSlot;
  kind: 'provider';
}>;

export type ThemeAssetReference = ThemeBundledAssetReference | ThemeProviderAssetReference;

export type ThemeFoilParameters = Readonly<{
  enabled: boolean;
  intensity: number;
  refraction: number;
  speed: number;
}>;

export type ThemeRarityPalette = Readonly<{
  accent: string;
  background: string;
  foil: ThemeFoilParameters;
  glow: string;
}>;

export type ThemePackSource =
  | Readonly<{
      kind: 'bundled';
      providerMode: 'dailydraft-devnet' | 'fixture';
    }>
  | Readonly<{
      gate: 'hitl-required';
      kind: 'gated-provider';
      provider: 'collector-crypt';
      providerMode: 'collector-crypt-production';
    }>;

export type ThemePackDefinition = Readonly<{
  art: Readonly<Record<ThemeArtSlot, ThemeAssetReference>>;
  audio: Readonly<Record<ThemeAudioCue, ThemeBundledAssetReference | null>>;
  displayName: string;
  id: string;
  rarities: Readonly<Record<PullRarity, ThemeRarityPalette>>;
  schemaVersion: typeof THEME_PACK_SCHEMA_VERSION;
  source: ThemePackSource;
}>;

export type ThemeProviderSource = Readonly<{
  approvalReference: string;
  art: Readonly<Record<ThemeArtSlot, string>>;
  contractVersion: string;
  displayName: string;
  insuredValue: Readonly<{
    amount: string;
    currency: 'USDC';
    decimals: number;
  }>;
  policyHash: string;
  policyVersion: string;
  provider: 'collector-crypt';
  providerMode: 'collector-crypt-production';
  providerReference: string;
  rollbackReference: string;
  schemaVersion: typeof THEME_PROVIDER_SOURCE_SCHEMA_VERSION;
  sourceTimestamp: string;
}>;

export function defineThemePack<const T extends ThemePackDefinition>(definition: T): T {
  assertThemePackDefinition(definition);
  return definition;
}

export function assertThemePackDefinition(value: unknown): asserts value is ThemePackDefinition {
  const errors = themePackValidationErrors(value);
  if (errors.length > 0) throw new Error(`Invalid theme pack: ${errors.join('; ')}`);
}

export function themePackValidationErrors(value: unknown): string[] {
  if (!isRecord(value)) return ['definition must be an object'];

  const errors: string[] = [];
  if (value.schemaVersion !== THEME_PACK_SCHEMA_VERSION) {
    errors.push('schemaVersion is unsupported');
  }
  if (!isIdentifier(value.id)) errors.push('id must be a versioned identifier');
  if (!isNonEmpty(value.displayName)) errors.push('displayName must not be empty');

  const source = value.source;
  let expectedAssetKind: ThemeAssetReference['kind'] | null = null;
  if (!isRecord(source)) {
    errors.push('source must be an object');
  } else if (source.kind === 'bundled') {
    expectedAssetKind = 'bundled';
    if (source.providerMode !== 'dailydraft-devnet' && source.providerMode !== 'fixture') {
      errors.push('bundled source providerMode is unsupported');
    }
  } else if (source.kind === 'gated-provider') {
    expectedAssetKind = 'provider';
    if (
      source.provider !== 'collector-crypt' ||
      source.providerMode !== 'collector-crypt-production' ||
      source.gate !== 'hitl-required'
    ) {
      errors.push('gated provider source must remain Collector Crypt HITL production');
    }
  } else {
    errors.push('source kind is unsupported');
  }

  validateArt(value.art, expectedAssetKind, errors);
  validateAudio(value.audio, errors);
  validateRarities(value.rarities, errors);
  return errors;
}

export const themePackCompatibilityFixtures = {
  collectorCrypt: {
    art: {
      background: { field: 'background', kind: 'provider' },
      cardBack: { field: 'cardBack', kind: 'provider' },
      cardFrame: { field: 'cardFrame', kind: 'provider' },
      cardImage: { field: 'cardImage', kind: 'provider' },
      packBack: { field: 'packBack', kind: 'provider' },
      packFront: { field: 'packFront', kind: 'provider' },
    },
    audio: {
      anticipation: null,
      celebrate: null,
      reveal: null,
    },
    displayName: 'Collector Crypt',
    id: 'collector-crypt.v1',
    rarities: fixtureRarities(),
    schemaVersion: THEME_PACK_SCHEMA_VERSION,
    source: {
      gate: 'hitl-required',
      kind: 'gated-provider',
      provider: 'collector-crypt',
      providerMode: 'collector-crypt-production',
    },
  },
  devnetDemo: {
    art: {
      background: { kind: 'bundled', uri: 'data:image/svg+xml,background' },
      cardBack: { kind: 'bundled', uri: 'data:image/svg+xml,cardBack' },
      cardFrame: { kind: 'bundled', uri: 'data:image/svg+xml,cardFrame' },
      cardImage: { kind: 'bundled', uri: 'data:image/svg+xml,cardImage' },
      packBack: { kind: 'bundled', uri: 'data:image/svg+xml,packBack' },
      packFront: { kind: 'bundled', uri: 'data:image/svg+xml,packFront' },
    },
    audio: {
      anticipation: null,
      celebrate: null,
      reveal: null,
    },
    displayName: 'DailyDraft Devnet',
    id: 'dailydraft-devnet.v1',
    rarities: fixtureRarities(),
    schemaVersion: THEME_PACK_SCHEMA_VERSION,
    source: {
      kind: 'bundled',
      providerMode: 'dailydraft-devnet',
    },
  },
  schemaVersion: THEME_PACK_SCHEMA_VERSION,
} as const satisfies Readonly<{
  collectorCrypt: ThemePackDefinition;
  devnetDemo: ThemePackDefinition;
  schemaVersion: typeof THEME_PACK_SCHEMA_VERSION;
}>;

function validateArt(
  value: unknown,
  expectedKind: ThemeAssetReference['kind'] | null,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push('art must be an object');
    return;
  }
  for (const slot of themeArtSlots) {
    const asset = value[slot];
    if (!isRecord(asset)) {
      errors.push(`art.${slot} must be an asset reference`);
      continue;
    }
    if (asset.kind !== expectedKind) {
      errors.push(`art.${slot} must use ${expectedKind ?? 'a supported'} assets`);
      continue;
    }
    if (asset.kind === 'bundled' && !isAssetUri(asset.uri)) {
      errors.push(`art.${slot}.uri must be a bundled asset URI`);
    }
    if (asset.kind === 'provider' && asset.field !== slot) {
      errors.push(`art.${slot}.field must equal ${slot}`);
    }
  }
}

function validateAudio(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('audio must be an object');
    return;
  }
  for (const cue of themeAudioCues) {
    const asset = value[cue];
    if (asset === null) continue;
    if (!isRecord(asset) || asset.kind !== 'bundled' || !isAssetUri(asset.uri)) {
      errors.push(`audio.${cue} must be null or a bundled asset URI`);
    }
  }
}

function validateRarities(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('rarities must be an object');
    return;
  }
  for (const rarity of themeRarities) {
    const palette = value[rarity];
    if (!isRecord(palette)) {
      errors.push(`rarities.${rarity} must be a palette`);
      continue;
    }
    for (const color of ['accent', 'background', 'glow'] as const) {
      if (!isHexColor(palette[color])) {
        errors.push(`rarities.${rarity}.${color} must be a hex color`);
      }
    }
    const foil = palette.foil;
    if (
      !isRecord(foil) ||
      typeof foil.enabled !== 'boolean' ||
      !isUnitInterval(foil.intensity) ||
      !isUnitInterval(foil.refraction) ||
      !isUnitInterval(foil.speed)
    ) {
      errors.push(`rarities.${rarity}.foil must use bounded parameters`);
    }
  }
}

function fixtureRarities(): Record<PullRarity, ThemeRarityPalette> {
  return {
    chase: {
      accent: '#F8D66D',
      background: '#241B35',
      foil: { enabled: true, intensity: 1, refraction: 0.9, speed: 0.8 },
      glow: '#FFF2B3',
    },
    common: {
      accent: '#AEB8C8',
      background: '#151922',
      foil: { enabled: false, intensity: 0, refraction: 0, speed: 0 },
      glow: '#D7DEE9',
    },
    rare: {
      accent: '#B79CFF',
      background: '#1C1733',
      foil: { enabled: true, intensity: 0.7, refraction: 0.65, speed: 0.55 },
      glow: '#D3C5FF',
    },
    uncommon: {
      accent: '#68D5B5',
      background: '#10241F',
      foil: { enabled: true, intensity: 0.35, refraction: 0.3, speed: 0.3 },
      glow: '#A2F3DA',
    },
  };
}

function isAssetUri(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('/') || value.startsWith('data:image/') || value.startsWith('data:audio/'))
  );
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[A-Fa-f0-9]{6}$/.test(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*\.v[1-9][0-9]*$/.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
