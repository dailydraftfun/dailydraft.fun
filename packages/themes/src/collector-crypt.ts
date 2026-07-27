import {
  defineThemePack,
  THEME_PACK_SCHEMA_VERSION,
  type ThemePackDefinition,
  themeArtSlots,
} from '@dailydraft/contracts/theme-pack';

const providerArt = Object.fromEntries(
  themeArtSlots.map((field) => [field, { field, kind: 'provider' }]),
) as ThemePackDefinition['art'];

export const COLLECTOR_CRYPT_THEME = defineThemePack({
  art: providerArt,
  audio: {
    anticipation: null,
    celebrate: null,
    reveal: null,
  },
  displayName: 'Collector Crypt',
  id: 'collector-crypt.v1',
  rarities: {
    chase: {
      accent: '#FFD86B',
      background: '#24162F',
      foil: { enabled: true, intensity: 1, refraction: 0.92, speed: 0.82 },
      glow: '#FFF0A8',
    },
    common: {
      accent: '#A8B1C2',
      background: '#141821',
      foil: { enabled: false, intensity: 0, refraction: 0, speed: 0 },
      glow: '#D8DEE9',
    },
    rare: {
      accent: '#BFA4FF',
      background: '#1D1731',
      foil: { enabled: true, intensity: 0.72, refraction: 0.68, speed: 0.56 },
      glow: '#DACBFF',
    },
    uncommon: {
      accent: '#65D9B5',
      background: '#11231E',
      foil: { enabled: true, intensity: 0.36, refraction: 0.32, speed: 0.3 },
      glow: '#9EF2D6',
    },
  },
  schemaVersion: THEME_PACK_SCHEMA_VERSION,
  source: {
    gate: 'hitl-required',
    kind: 'gated-provider',
    provider: 'collector-crypt',
    providerMode: 'collector-crypt-production',
  },
});
