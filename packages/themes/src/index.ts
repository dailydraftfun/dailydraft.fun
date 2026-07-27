import {
  THEME_PACK_SCHEMA_VERSION,
  type ThemePack,
  themePackContractFixtures,
} from '@dailydraft/contracts/theme-pack';

export const devnetDemoThemePack = themePackContractFixtures.devnetDemo;

export const collectorCryptThemePack = {
  art: {
    cardBack: 'theme.card.back',
    cardFace: 'theme.card.face',
    cardFrame: 'theme.card.frame',
    pack: 'theme.pack.closed',
    sceneBackground: 'theme.scene.background',
  },
  audio: {
    bankId: 'collector-crypt',
    cues: {
      anticipation: {
        assetRef: 'theme://collector-crypt/audio/anticipation',
        gain: 0.5,
      },
      celebration: {
        assetRef: 'theme://collector-crypt/audio/celebration',
        gain: 0.8,
      },
      reveal: {
        assetRef: 'theme://collector-crypt/audio/reveal',
        gain: 0.65,
      },
    },
  },
  id: 'collector-crypt',
  name: 'Collector Crypt',
  rarity: {
    chase: {
      foil: {
        brightness: 1,
        chroma: 0.9,
        glare: 1,
        grain: 0.22,
        iridescence: 1,
        speed: 1.5,
      },
      palette: {
        accent: '#F9E79F',
        glow: '#C084FC',
        shadow: '#160B2A',
        surface: ['#3B0764', '#F9E79F'],
      },
    },
    common: {
      foil: {
        brightness: 0.25,
        chroma: 0.12,
        glare: 0.12,
        grain: 0.08,
        iridescence: 0.05,
        speed: 0.3,
      },
      palette: {
        accent: '#A8A29E',
        glow: '#78716C',
        shadow: '#1C1917',
        surface: ['#292524', '#57534E'],
      },
    },
    rare: {
      foil: {
        brightness: 0.72,
        chroma: 0.62,
        glare: 0.75,
        grain: 0.15,
        iridescence: 0.76,
        speed: 1,
      },
      palette: {
        accent: '#7DD3FC',
        glow: '#2563EB',
        shadow: '#172554',
        surface: ['#1E3A8A', '#7DD3FC'],
      },
    },
    uncommon: {
      foil: {
        brightness: 0.48,
        chroma: 0.38,
        glare: 0.42,
        grain: 0.11,
        iridescence: 0.32,
        speed: 0.65,
      },
      palette: {
        accent: '#6EE7B7',
        glow: '#059669',
        shadow: '#022C22',
        surface: ['#064E3B', '#6EE7B7'],
      },
    },
  },
  schemaVersion: THEME_PACK_SCHEMA_VERSION,
  source: {
    contract: 'pack-provider',
    kind: 'provider',
    mode: 'collector-crypt-sandbox',
    provider: 'collector-crypt',
  },
  version: '1.0.0',
} as const satisfies ThemePack;
