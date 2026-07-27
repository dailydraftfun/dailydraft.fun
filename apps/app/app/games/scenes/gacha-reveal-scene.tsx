'use client';

import type { PullRarity } from '@dailydraft/contracts/pull-rarity';
import { themePackContractFixtures } from '@dailydraft/contracts/theme-pack';
import type { SceneFallbackReason } from '@dailydraft/engine';
import { PixiScene } from '@dailydraft/engine/react';
import Image from 'next/image';

import { type GachaRevealSceneInput, gachaRevealSceneMetadata } from './gacha-reveal-contract';
import styles from './gacha-reveal-scene.module.css';

export { gachaRevealSceneMetadata } from './gacha-reveal-contract';

export type GachaRevealSceneProps = Readonly<{
  cardImageUrl: string;
  displayName: string;
  rarity: PullRarity;
  revealId: string;
}>;

const BUNDLED_THEME = themePackContractFixtures.devnetDemo;
const loadGachaRevealScene = async () =>
  (await import('./gacha-reveal-pixi-scene')).gachaRevealPixiScene;

type GachaRevealFallbackProps = Pick<
  GachaRevealSceneProps,
  'cardImageUrl' | 'displayName' | 'rarity'
> &
  Readonly<{
    descriptorId: string;
    reason: SceneFallbackReason;
  }>;

export function GachaRevealFallback({
  cardImageUrl,
  descriptorId,
  displayName,
  rarity,
  reason,
}: GachaRevealFallbackProps) {
  if (reason === 'loading') {
    return (
      <div className={styles.fallback} data-fallback={descriptorId} data-fallback-reason={reason}>
        <div className={styles.sealedPack}>
          <span className={styles.sealedEyebrow}>DailyDraft</span>
          <strong>Sealed sports pack</strong>
          <span className={styles.sealedStatus}>Loading reveal engine</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.fallback} data-fallback={descriptorId} data-fallback-reason={reason}>
      <div className={styles.fallbackFrame}>
        <span className={styles.fallbackBadge}>{rarity}</span>
        <Image
          alt={displayName}
          className={styles.fallbackImage}
          fill
          priority
          sizes="(min-width: 640px) 150px, 42vw"
          src={cardImageUrl}
        />
      </div>
    </div>
  );
}

/**
 * Progressive enhancement for one already-settled gacha result.
 *
 * The DOM card remains the semantic and reduced-motion source of truth. Pixi
 * receives the exact same server-derived identity, art URL, and committed rarity
 * and has no API for choosing another outcome.
 */
export function GachaRevealScene({
  cardImageUrl,
  displayName,
  rarity,
  revealId,
}: GachaRevealSceneProps) {
  const input: GachaRevealSceneInput = {
    cardImageUrl,
    displayName,
    rarity,
    revealId,
    themeId: BUNDLED_THEME.id,
    themeVersion: BUNDLED_THEME.version,
  };

  return (
    <PixiScene
      aria-label="Sports pack reveal"
      className={styles.scene}
      data-theme={`${input.themeId}@${input.themeVersion}`}
      input={input}
      loadScene={loadGachaRevealScene}
      metadata={gachaRevealSceneMetadata}
      renderFallback={(descriptor, reason) => (
        <GachaRevealFallback
          cardImageUrl={cardImageUrl}
          descriptorId={descriptor.id}
          displayName={displayName}
          rarity={rarity}
          reason={reason}
        />
      )}
      sceneKey={revealId}
    />
  );
}
