import {
  defineThemePack,
  THEME_PACK_SCHEMA_VERSION,
  type ThemeArtSlot,
} from '@dailydraft/contracts/theme-pack';

const colors: Record<ThemeArtSlot, readonly [string, string]> = {
  background: ['#07151E', '#13394D'],
  cardBack: ['#0E2534', '#2D809E'],
  cardFrame: ['#4DC5E8', '#D8F7FF'],
  cardImage: ['#143747', '#6AE5C1'],
  packBack: ['#102D3D', '#194C64'],
  packFront: ['#164359', '#64D9F5'],
};

export const DEVNET_DEMO_THEME = defineThemePack({
  art: {
    background: bundledSvg('DailyDraft demo background', colors.background),
    cardBack: bundledSvg('DailyDraft demo card back', colors.cardBack),
    cardFrame: bundledSvg('DailyDraft demo card frame', colors.cardFrame),
    cardImage: bundledSvg('DailyDraft demo collectible', colors.cardImage),
    packBack: bundledSvg('DailyDraft demo pack back', colors.packBack),
    packFront: bundledSvg('DailyDraft demo pack front', colors.packFront),
  },
  audio: {
    anticipation: null,
    celebrate: null,
    reveal: null,
  },
  displayName: 'DailyDraft Devnet',
  id: 'dailydraft-devnet.v1',
  rarities: {
    chase: {
      accent: '#FFE37B',
      background: '#1C2838',
      foil: { enabled: true, intensity: 0.92, refraction: 0.82, speed: 0.74 },
      glow: '#FFF3B5',
    },
    common: {
      accent: '#64D9F5',
      background: '#07151E',
      foil: { enabled: false, intensity: 0, refraction: 0, speed: 0 },
      glow: '#B5F3FF',
    },
    rare: {
      accent: '#9F8CFF',
      background: '#151C35',
      foil: { enabled: true, intensity: 0.66, refraction: 0.58, speed: 0.5 },
      glow: '#D1C8FF',
    },
    uncommon: {
      accent: '#6AE5C1',
      background: '#0C2422',
      foil: { enabled: true, intensity: 0.3, refraction: 0.26, speed: 0.24 },
      glow: '#B1FFE7',
    },
  },
  schemaVersion: THEME_PACK_SCHEMA_VERSION,
  source: {
    kind: 'bundled',
    providerMode: 'dailydraft-devnet',
  },
});

function bundledSvg(label: string, [from, to]: readonly [string, string]) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 620">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`,
    '</linearGradient></defs>',
    '<rect width="390" height="620" rx="32" fill="url(#g)"/>',
    `<title>${label}</title></svg>`,
  ].join('');
  return { kind: 'bundled', uri: `data:image/svg+xml,${encodeURIComponent(svg)}` } as const;
}
