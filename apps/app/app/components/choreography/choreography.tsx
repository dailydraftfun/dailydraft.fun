'use client';

import type { PullRarity } from '@dailydraft/contracts';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import styles from './choreography.module.css';
import {
  type ChoreographyBeat,
  type ChoreographyState,
  choreographyReducer,
  choreographyTimingFor,
  createChoreographyState,
  isAnimatedChoreographyBeat,
} from './choreography-motion';

export type ChoreographyController = ChoreographyState & {
  advance(completedBeat?: ChoreographyBeat): void;
  fastForward(): void;
  intensity: number;
  transition: {
    duration: number;
    ease: [number, number, number, number];
  };
};

export type UseRevealChoreographyOptions = {
  active: boolean;
  initiallySettled?: boolean;
  rarity: PullRarity;
  reducedMotion?: boolean;
  sequenceKey?: number | string;
};

export function useRevealChoreography({
  active,
  initiallySettled = false,
  rarity,
  reducedMotion: reducedMotionOverride,
  sequenceKey = 0,
}: UseRevealChoreographyOptions): ChoreographyController {
  const motionPreference = useReducedMotion();
  const reducedMotion = reducedMotionOverride ?? motionPreference ?? false;
  const [state, dispatch] = useReducer(choreographyReducer, undefined, () =>
    createChoreographyState(rarity, active && initiallySettled ? 'settled' : 'idle'),
  );
  const previous = useRef({ active, rarity, sequenceKey });
  const mounted = useRef(false);

  useEffect(() => {
    const firstRender = !mounted.current;
    const restarted =
      previous.current.sequenceKey !== sequenceKey || previous.current.rarity !== rarity;
    const becameActive = !previous.current.active && active;

    if (!active) {
      dispatch({ rarity, type: 'reset' });
    } else if (reducedMotion) {
      dispatch({ rarity, type: 'fast-forward' });
    } else if (becameActive || restarted || (firstRender && !initiallySettled)) {
      dispatch({ rarity, type: 'start' });
    }

    mounted.current = true;
    previous.current = { active, rarity, sequenceKey };
  }, [active, initiallySettled, rarity, reducedMotion, sequenceKey]);

  const advance = useCallback((completedBeat?: ChoreographyBeat) => {
    dispatch({ from: completedBeat, type: 'advance' });
  }, []);
  const fastForward = useCallback(() => dispatch({ type: 'fast-forward' }), []);
  const timing = choreographyTimingFor(state.beat, state.rarity, reducedMotion);

  return {
    ...state,
    advance,
    fastForward,
    intensity: timing.intensity,
    transition: {
      duration: timing.durationMs / 1_000,
      ease: [...timing.easing],
    },
  };
}

export function ChoreographyDriver({
  controller,
  sequenceKey = 0,
}: {
  controller: ChoreographyController;
  sequenceKey?: number | string;
}) {
  if (!isAnimatedChoreographyBeat(controller.beat)) return null;

  const completedBeat = controller.beat;
  return (
    <motion.span
      animate={{ scaleX: 1 }}
      aria-hidden="true"
      className={styles.driver}
      initial={{ scaleX: 0 }}
      key={`${sequenceKey}-${completedBeat}`}
      onAnimationComplete={() => controller.advance(completedBeat)}
      transition={controller.transition}
    />
  );
}

export function ChoreographyCelebration({
  className,
  controller,
}: {
  className: string;
  controller: ChoreographyController;
}) {
  if (controller.beat !== 'celebrate') return null;

  return (
    <motion.div
      animate={{ opacity: [0, 1, 0], scale: [0.92, 1, 1.06] }}
      aria-hidden="true"
      className={className}
      initial={{ opacity: 0, scale: 0.92 }}
      transition={controller.transition}
    />
  );
}

export function ChoreographySkipControl({
  className,
  controller,
  label,
}: {
  className: string;
  controller: ChoreographyController;
  label: string;
}) {
  return (
    <button
      className={className}
      disabled={controller.settled}
      onClick={controller.fastForward}
      type="button"
    >
      {label}
    </button>
  );
}
