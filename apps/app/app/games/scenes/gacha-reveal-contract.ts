import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import { defineSceneMetadata } from '@dailydraft/engine';

export type GachaRevealSceneInput = Readonly<{
  cardImageUrl: string;
  displayName: string;
  rarity: PullRarity;
  revealId: string;
  themeId: string;
  themeVersion: string;
}>;

export const gachaRevealSceneMetadata = defineSceneMetadata({
  designSize: { height: 560, width: 720 },
  fallback: {
    noWebGL: {
      id: 'gacha-reveal-dom',
      label: 'Settled card reveal',
      preserves: ['card identity', 'card artwork', 'committed rarity'],
    },
    reducedMotion: {
      id: 'gacha-reveal-static',
      label: 'Static settled card reveal',
      preserves: ['card identity', 'card artwork', 'committed rarity'],
    },
  },
  id: 'sports-pack-gacha-reveal',
});
