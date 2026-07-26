// biome-ignore-all lint/a11y/noNoninteractiveTabindex: The visual card needs a keyboard focus target for its equivalent foil highlight.
// biome-ignore-all lint/a11y/useSemanticElements: A fieldset is not an appropriate semantic container for this composite card artwork.

'use client';

import Image from 'next/image';
import { type ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import styles from './holo-card.module.css';
import {
  createHoloCardSpringState,
  type HoloCardMotionState,
  holoCardMotionPolicy,
  isHoloCardSpringSettled,
  neutralHoloCardMotion,
  pointerToHoloCardMotion,
  stepHoloCardSpring,
} from './holo-card-motion';
import { type HoloCardRarity, holoCardRarityProfiles } from './holo-card-rarity';

export type HoloCardProps = {
  children?: ReactNode;
  className?: string;
  imageAlt?: string;
  imageUrl: string;
  name: string;
  priority?: boolean;
  rarity: HoloCardRarity;
  value?: string;
};

export function HoloCard({
  children,
  className,
  imageAlt,
  imageUrl,
  name,
  priority = false,
  rarity,
  value,
}: HoloCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const springFrameRef = useRef<number | null>(null);
  const pendingMotionRef = useRef<HoloCardMotionState | null>(null);
  const currentMotionRef = useRef<HoloCardMotionState>({ ...neutralHoloCardMotion });
  const reducedMotionRef = useRef(false);
  const rarityProfile = holoCardRarityProfiles[rarity];

  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => {
      reducedMotionRef.current = motionQuery.matches;
      cardRef.current?.setAttribute('data-motion', motionQuery.matches ? 'reduced' : 'interactive');

      if (motionQuery.matches) {
        cancelAnimationFrame(pointerFrameRef);
        cancelAnimationFrame(springFrameRef);
        applyMotion(cardRef.current, neutralHoloCardMotion);
        currentMotionRef.current = { ...neutralHoloCardMotion };
      }
    };

    updatePreference();
    motionQuery.addEventListener('change', updatePreference);
    return () => {
      motionQuery.removeEventListener('change', updatePreference);
      cancelAnimationFrame(pointerFrameRef);
      cancelAnimationFrame(springFrameRef);
    };
  }, []);

  function queuePointerMotion(event: ReactPointerEvent<HTMLDivElement>) {
    if (!holoCardMotionPolicy(reducedMotionRef.current).pointerTilt) return;
    if (event.pointerType !== 'mouse' && activePointerRef.current !== event.pointerId) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    pendingMotionRef.current = pointerToHoloCardMotion(event.clientX, event.clientY, bounds);
    cancelAnimationFrame(springFrameRef);
    if (pointerFrameRef.current !== null) return;

    pointerFrameRef.current = window.requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      const motion = pendingMotionRef.current;
      if (!motion) return;
      currentMotionRef.current = motion;
      applyMotion(cardRef.current, motion);
      pendingMotionRef.current = null;
    });
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (reducedMotionRef.current || event.pointerType === 'mouse') return;
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    queuePointerMotion(event);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    settleCard();
  }

  function settleCard() {
    pendingMotionRef.current = null;
    cancelAnimationFrame(pointerFrameRef);
    cancelAnimationFrame(springFrameRef);

    if (holoCardMotionPolicy(reducedMotionRef.current).release === 'immediate') {
      currentMotionRef.current = { ...neutralHoloCardMotion };
      applyMotion(cardRef.current, neutralHoloCardMotion);
      return;
    }

    let spring = createHoloCardSpringState(currentMotionRef.current);
    let previousTime: number | null = null;

    const settleFrame = (time: number) => {
      const deltaSeconds = previousTime === null ? 1 / 60 : (time - previousTime) / 1_000;
      previousTime = time;
      spring = stepHoloCardSpring(spring, deltaSeconds);

      if (isHoloCardSpringSettled(spring)) {
        currentMotionRef.current = { ...neutralHoloCardMotion };
        applyMotion(cardRef.current, neutralHoloCardMotion);
        springFrameRef.current = null;
        return;
      }

      currentMotionRef.current = spring.motion;
      applyMotion(cardRef.current, spring.motion);
      springFrameRef.current = window.requestAnimationFrame(settleFrame);
    };

    springFrameRef.current = window.requestAnimationFrame(settleFrame);
  }

  const cardClassName = className ? `${styles.stage} ${className}` : styles.stage;

  return (
    <article className={cardClassName} data-rarity={rarity}>
      <div
        aria-label={`${name}, ${rarityProfile.label} holographic card${value ? `, ${value}` : ''}`}
        className={styles.card}
        data-foil-layers={rarityProfile.foilLayers}
        data-motion="pending"
        data-rarity={rarity}
        data-treatment={rarityProfile.treatment}
        onBlur={settleCard}
        onFocus={settleCard}
        onLostPointerCapture={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={beginDrag}
        onPointerEnter={queuePointerMotion}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') settleCard();
        }}
        onPointerMove={queuePointerMotion}
        onPointerUp={endDrag}
        ref={cardRef}
        role="group"
        tabIndex={0}
      >
        <div className={styles.art}>
          <Image
            alt={imageAlt ?? name}
            className={styles.image}
            fill
            priority={priority}
            sizes="(max-width: 390px) calc(100vw - 32px), 320px"
            src={imageUrl}
          />
        </div>
        <div aria-hidden="true" className={styles.rarityWash} />
        <div aria-hidden="true" className={styles.foil} />
        <div aria-hidden="true" className={styles.sparkles} />
        <div aria-hidden="true" className={styles.glare} />
        <div className={styles.edge} />
        <footer className={styles.caption}>
          <div>
            <span className={styles.rarity}>{rarityProfile.label}</span>
            <strong>{name}</strong>
          </div>
          {value ? <span className={styles.value}>{value}</span> : null}
          {children}
        </footer>
      </div>
    </article>
  );
}

function applyMotion(element: HTMLDivElement | null, motion: HoloCardMotionState) {
  if (!element) return;
  element.style.setProperty('--holo-tilt-x', `${motion.tiltX.toFixed(3)}deg`);
  element.style.setProperty('--holo-tilt-y', `${motion.tiltY.toFixed(3)}deg`);
  element.style.setProperty('--holo-sheen-x', `${motion.sheenX.toFixed(3)}%`);
  element.style.setProperty('--holo-sheen-y', `${motion.sheenY.toFixed(3)}%`);
  element.style.setProperty('--holo-glare', motion.glare.toFixed(3));
}

function cancelAnimationFrame(reference: { current: number | null }) {
  if (reference.current === null) return;
  window.cancelAnimationFrame(reference.current);
  reference.current = null;
}
