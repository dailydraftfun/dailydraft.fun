import type { PullRarity } from './pull-rarity.js';

export const THEME_PACK_SCHEMA_VERSION = 'dailydraft.theme-pack.v1' as const;

export const THEME_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'chase',
] as const satisfies readonly PullRarity[];
export const THEME_ART_SLOTS = [
  'cardBack',
  'cardFace',
  'cardFrame',
  'pack',
  'sceneBackground',
] as const;
export const THEME_AUDIO_CUES = ['anticipation', 'reveal', 'celebration'] as const;

const THEME_PACK_FIELDS = [
  'art',
  'audio',
  'id',
  'name',
  'rarity',
  'schemaVersion',
  'source',
  'version',
] as const;
const RARITY_TREATMENT_FIELDS = ['foil', 'palette'] as const;
const PALETTE_FIELDS = ['accent', 'glow', 'shadow', 'surface'] as const;
const FOIL_FIELDS = ['brightness', 'chroma', 'glare', 'grain', 'iridescence', 'speed'] as const;
const OPAQUE_PROVIDER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export type ThemeArtSlot = (typeof THEME_ART_SLOTS)[number];
export type ThemeAudioCue = (typeof THEME_AUDIO_CUES)[number];

export type ThemeArtReferences = Readonly<Record<ThemeArtSlot, string>>;

export type ThemeRarityPalette = Readonly<{
  accent: string;
  glow: string;
  shadow: string;
  surface: readonly [string, string];
}>;

export type ThemeFoilParameters = Readonly<{
  brightness: number;
  chroma: number;
  glare: number;
  grain: number;
  iridescence: number;
  speed: number;
}>;

export type ThemeRarityTreatment = Readonly<{
  foil: ThemeFoilParameters;
  palette: ThemeRarityPalette;
}>;

export type ThemeAudioBank = Readonly<{
  bankId: string;
  cues: Readonly<
    Record<
      ThemeAudioCue,
      Readonly<{
        assetRef: string;
        gain: number;
      }>
    >
  >;
}>;

export type ThemePackSource =
  | Readonly<{
      kind: 'bundled';
      namespace: string;
    }>
  | Readonly<{
      contract: 'pack-provider';
      kind: 'provider';
      mode: 'collector-crypt-sandbox';
      provider: 'collector-crypt';
    }>;

export type ThemePack = Readonly<{
  art: ThemeArtReferences;
  audio: ThemeAudioBank;
  id: string;
  name: string;
  rarity: Readonly<Record<PullRarity, ThemeRarityTreatment>>;
  schemaVersion: typeof THEME_PACK_SCHEMA_VERSION;
  source: ThemePackSource;
  version: string;
}>;

export type ThemePackValidation =
  | Readonly<{ ok: true; value: ThemePack }>
  | Readonly<{ issues: readonly string[]; ok: false }>;

const demoRarity = {
  chase: {
    foil: {
      brightness: 0.9,
      chroma: 0.9,
      glare: 0.95,
      grain: 0.2,
      iridescence: 1,
      speed: 1.4,
    },
    palette: {
      accent: '#F8D568',
      glow: '#A855F7',
      shadow: '#22123D',
      surface: ['#4C1D95', '#F8D568'],
    },
  },
  common: {
    foil: {
      brightness: 0.3,
      chroma: 0.2,
      glare: 0.15,
      grain: 0.08,
      iridescence: 0.08,
      speed: 0.35,
    },
    palette: {
      accent: '#94A3B8',
      glow: '#64748B',
      shadow: '#0F172A',
      surface: ['#1E293B', '#475569'],
    },
  },
  rare: {
    foil: {
      brightness: 0.7,
      chroma: 0.65,
      glare: 0.7,
      grain: 0.14,
      iridescence: 0.72,
      speed: 0.95,
    },
    palette: {
      accent: '#67E8F9',
      glow: '#3B82F6',
      shadow: '#172554',
      surface: ['#1D4ED8', '#67E8F9'],
    },
  },
  uncommon: {
    foil: {
      brightness: 0.5,
      chroma: 0.4,
      glare: 0.4,
      grain: 0.1,
      iridescence: 0.35,
      speed: 0.6,
    },
    palette: {
      accent: '#86EFAC',
      glow: '#22C55E',
      shadow: '#052E16',
      surface: ['#166534', '#86EFAC'],
    },
  },
} as const satisfies Readonly<Record<PullRarity, ThemeRarityTreatment>>;

export const themePackContractFixtures = {
  devnetDemo: {
    art: {
      cardBack: 'theme://dailydraft-demo/card-back',
      cardFace: 'theme://dailydraft-demo/card-face',
      cardFrame: 'theme://dailydraft-demo/card-frame',
      pack: 'theme://dailydraft-demo/pack',
      sceneBackground: 'theme://dailydraft-demo/scene-background',
    },
    audio: {
      bankId: 'dailydraft-demo',
      cues: {
        anticipation: {
          assetRef: 'theme://dailydraft-demo/audio/anticipation',
          gain: 0.45,
        },
        celebration: {
          assetRef: 'theme://dailydraft-demo/audio/celebration',
          gain: 0.7,
        },
        reveal: {
          assetRef: 'theme://dailydraft-demo/audio/reveal',
          gain: 0.6,
        },
      },
    },
    id: 'dailydraft-demo',
    name: 'DailyDraft Demo',
    rarity: demoRarity,
    schemaVersion: THEME_PACK_SCHEMA_VERSION,
    source: {
      kind: 'bundled',
      namespace: 'dailydraft-demo',
    },
    version: '1.0.0',
  },
  schemaVersion: THEME_PACK_SCHEMA_VERSION,
} as const satisfies Readonly<{
  devnetDemo: ThemePack;
  schemaVersion: typeof THEME_PACK_SCHEMA_VERSION;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  issues: string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`${path}.${key} is not allowed`);
  }
}

export function validateThemePack(value: unknown): ThemePackValidation {
  const issues: string[] = [];

  if (!isRecord(value)) {
    return { issues: ['theme pack must be an object'], ok: false };
  }
  rejectUnknownKeys(value, THEME_PACK_FIELDS, 'themePack', issues);
  if (value.schemaVersion !== THEME_PACK_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${THEME_PACK_SCHEMA_VERSION}`);
  }
  for (const field of ['id', 'name', 'version'] as const) {
    if (!isNonEmptyString(value[field])) issues.push(`${field} must be a non-empty string`);
  }

  const source = value.source;
  if (!isRecord(source)) {
    issues.push('source must be an object');
  } else if (source.kind === 'bundled') {
    rejectUnknownKeys(source, ['kind', 'namespace'], 'source', issues);
    if (!isNonEmptyString(source.namespace)) {
      issues.push('source.namespace must be a non-empty string');
    }
  } else if (source.kind === 'provider') {
    rejectUnknownKeys(source, ['contract', 'kind', 'mode', 'provider'], 'source', issues);
    if (
      source.provider !== 'collector-crypt' ||
      source.mode !== 'collector-crypt-sandbox' ||
      source.contract !== 'pack-provider'
    ) {
      issues.push('provider source must use the gated Collector Crypt pack-provider contract');
    }
  } else {
    issues.push('source.kind must be bundled or provider');
  }

  const art = value.art;
  if (!isRecord(art)) {
    issues.push('art must be an object');
  } else {
    rejectUnknownKeys(art, THEME_ART_SLOTS, 'art', issues);
    for (const slot of THEME_ART_SLOTS) {
      if (!isNonEmptyString(art[slot])) issues.push(`art.${slot} must be a non-empty string`);
      if (
        isRecord(source) &&
        source.kind === 'provider' &&
        typeof art[slot] === 'string' &&
        !OPAQUE_PROVIDER_KEY_PATTERN.test(art[slot])
      ) {
        issues.push(`art.${slot} must be an opaque provider key`);
      }
    }
  }

  const rarity = value.rarity;
  if (!isRecord(rarity)) {
    issues.push('rarity must be an object');
  } else {
    rejectUnknownKeys(rarity, THEME_RARITIES, 'rarity', issues);
    for (const tier of THEME_RARITIES) {
      const treatment = rarity[tier];
      if (!isRecord(treatment) || !isRecord(treatment.palette) || !isRecord(treatment.foil)) {
        issues.push(`rarity.${tier} must define palette and foil`);
        continue;
      }
      const { palette, foil } = treatment;
      rejectUnknownKeys(treatment, RARITY_TREATMENT_FIELDS, `rarity.${tier}`, issues);
      rejectUnknownKeys(palette, PALETTE_FIELDS, `rarity.${tier}.palette`, issues);
      rejectUnknownKeys(foil, FOIL_FIELDS, `rarity.${tier}.foil`, issues);
      for (const color of ['accent', 'glow', 'shadow'] as const) {
        if (!isHexColor(palette[color])) {
          issues.push(`rarity.${tier}.palette.${color} must be a six-digit hex color`);
        }
      }
      if (
        !Array.isArray(palette.surface) ||
        palette.surface.length !== 2 ||
        !palette.surface.every(isHexColor)
      ) {
        issues.push(`rarity.${tier}.palette.surface must contain two six-digit hex colors`);
      }
      for (const parameter of ['brightness', 'chroma', 'glare', 'grain', 'iridescence'] as const) {
        if (!isUnitInterval(foil[parameter])) {
          issues.push(`rarity.${tier}.foil.${parameter} must be between 0 and 1`);
        }
      }
      if (
        typeof foil.speed !== 'number' ||
        !Number.isFinite(foil.speed) ||
        foil.speed < 0 ||
        foil.speed > 4
      ) {
        issues.push(`rarity.${tier}.foil.speed must be between 0 and 4`);
      }
    }
  }

  const audio = value.audio;
  if (!isRecord(audio) || !isNonEmptyString(audio.bankId) || !isRecord(audio.cues)) {
    issues.push('audio must define a bankId and cues');
  } else {
    rejectUnknownKeys(audio, ['bankId', 'cues'], 'audio', issues);
    rejectUnknownKeys(audio.cues, THEME_AUDIO_CUES, 'audio.cues', issues);
    for (const cue of THEME_AUDIO_CUES) {
      const definition = audio.cues[cue];
      if (
        !isRecord(definition) ||
        !isNonEmptyString(definition.assetRef) ||
        !isUnitInterval(definition.gain)
      ) {
        issues.push(`audio.cues.${cue} must define an assetRef and gain between 0 and 1`);
      } else {
        rejectUnknownKeys(definition, ['assetRef', 'gain'], `audio.cues.${cue}`, issues);
      }
    }
  }

  return issues.length === 0 ? { ok: true, value: value as ThemePack } : { issues, ok: false };
}
