'use client';

import { useReducedMotion } from 'motion/react';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { ChoreographyController } from '../choreography';
import styles from './celebration.module.css';
import { createCelebrationCanvasLoop } from './celebration-canvas';
import {
  type CelebrationEffectProfile,
  celebrationEffectProfileFor,
  celebrationStaticLabel,
} from './celebration-effects';

export function CelebrationOverlay({
  controller,
  reducedMotion: reducedMotionOverride,
  sequenceKey = 0,
  valueUsd,
}: {
  controller: ChoreographyController;
  reducedMotion?: boolean;
  sequenceKey?: number | string;
  valueUsd?: number | null;
}) {
  const motionPreference = useReducedMotion();
  const reducedMotion = reducedMotionOverride ?? motionPreference ?? false;
  const profile = useMemo(
    () => celebrationEffectProfileFor(controller.rarity, valueUsd),
    [controller.rarity, valueUsd],
  );
  const celebrating = controller.beat === 'celebrate';
  const { canvasRef, showCanvas } = useCelebrationBurst({
    celebrating,
    profile,
    rarity: controller.rarity,
    reducedMotion,
    sequenceKey,
  });

  if (!showCanvas && !controller.settled) return null;

  return (
    <span
      aria-hidden="true"
      className={styles.overlay}
      data-celebration-accent={profile.screenAccent}
      data-celebration-rarity={controller.rarity}
      data-celebration-reduced-motion={reducedMotion}
      suppressHydrationWarning
      style={
        {
          '--celebration-glow': profile.glowIntensity,
        } as CSSProperties
      }
    >
      {showCanvas ? (
        <canvas className={styles.canvas} data-celebration-canvas="true" ref={canvasRef} />
      ) : null}
      {controller.settled ? (
        <span className={styles.staticTreatment} data-celebration-static="true">
          {celebrationStaticLabel(controller.rarity)}
        </span>
      ) : null}
    </span>
  );
}

export function useCelebrationBurst({
  celebrating,
  profile,
  rarity,
  reducedMotion,
  sequenceKey,
}: {
  celebrating: boolean;
  profile: CelebrationEffectProfile;
  rarity: ChoreographyController['rarity'];
  reducedMotion: boolean;
  sequenceKey: number | string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [burstActive, setBurstActive] = useState(false);
  const previousBurst = useRef({ rarity, sequenceKey });

  useEffect(() => {
    const restarted =
      previousBurst.current.rarity !== rarity || previousBurst.current.sequenceKey !== sequenceKey;
    previousBurst.current = { rarity, sequenceKey };

    if (reducedMotion) {
      setBurstActive(false);
    } else if (celebrating) {
      setBurstActive(true);
    } else if (restarted) {
      setBurstActive(false);
    }
  }, [celebrating, rarity, reducedMotion, sequenceKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!burstActive || reducedMotion || !canvas) return;

    canvas.dataset.celebrationSequence = String(sequenceKey);
    const bounds = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));

    const loop = createCelebrationCanvasLoop({
      canvas,
      onComplete: () => setBurstActive(false),
      pixelRatio,
      profile,
      scheduler: {
        cancel: (frameId) => window.cancelAnimationFrame(frameId),
        request: (callback) => window.requestAnimationFrame(callback),
      },
    });
    loop.start();
    return loop.stop;
  }, [burstActive, profile, reducedMotion, sequenceKey]);

  return {
    canvasRef,
    showCanvas: (celebrating || burstActive) && !reducedMotion,
  };
}
