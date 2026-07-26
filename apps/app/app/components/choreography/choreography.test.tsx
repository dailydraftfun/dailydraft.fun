import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React, { type ReactElement, type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  type ChoreographyController,
  ChoreographyDriver,
  useRevealChoreography as renderRevealChoreography,
  type UseRevealChoreographyOptions,
  useRevealChoreography,
} from './choreography';
import type { ChoreographyEvent, ChoreographyState } from './choreography-motion';

type Effect = () => undefined | (() => void);

type HookDispatcher = {
  useCallback<T>(callback: T): T;
  useEffect(effect: Effect): void;
  useReducer<I>(
    reducer: (state: ChoreographyState, event: ChoreographyEvent) => ChoreographyState,
    initialArg: I,
    initializer: (value: I) => ChoreographyState,
  ): [ChoreographyState, (event: ChoreographyEvent) => void];
  useRef<T>(initialValue: T): RefObject<T>;
  useState<T>(initialValue: T | (() => T)): [T, () => void];
};

type ReactClientInternals = {
  H: HookDispatcher | null;
};

const reactClientInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

describe('reveal choreography React binding', () => {
  test('renders a Motion driver that advances only its completed beat', () => {
    const completed: string[] = [];
    const controller = controllerFor('anticipation', (beat) => completed.push(beat ?? 'missing'));
    const driver = ChoreographyDriver({ controller, sequenceKey: 'fixture' }) as ReactElement<{
      onAnimationComplete(): void;
    }>;

    expect(driver.key).toBe('fixture-anticipation');
    expect(driver.props).toMatchObject({
      animate: { scaleX: 1 },
      'aria-hidden': 'true',
      initial: { scaleX: 0 },
      transition: controller.transition,
    });

    driver.props.onAnimationComplete();
    expect(completed).toEqual(['anticipation']);
    expect(ChoreographyDriver({ controller: controllerFor('settled') })).toBeNull();
  });

  test('keeps the server-rendered binding inspectable before client effects begin', () => {
    const markup = renderToStaticMarkup(<BindingContract />);

    expect(markup).toContain('data-beat="settled"');
    expect(markup).toContain('data-rarity="rare"');
    expect(markup).toContain('data-revealed="true"');
    expect(markup).toContain('data-settled="true"');
    expect(markup).toContain('data-duration="0"');
  });

  test('binds activation, reduced-motion settle, reset, and user controls to reducer events', () => {
    const standard = renderHook({
      active: true,
      rarity: 'uncommon',
      reducedMotion: false,
    });
    standard.effect();
    standard.controller.advance('anticipation');
    standard.controller.fastForward();
    expect(standard.events).toEqual([
      { rarity: 'uncommon', type: 'start' },
      { from: 'anticipation', type: 'advance' },
      { type: 'fast-forward' },
    ]);

    const reduced = renderHook({ active: true, rarity: 'rare', reducedMotion: true });
    reduced.effect();
    expect(reduced.events).toEqual([{ rarity: 'rare', type: 'fast-forward' }]);

    const inactive = renderHook({ active: false, rarity: 'common', reducedMotion: false });
    inactive.effect();
    expect(inactive.events).toEqual([{ rarity: 'common', type: 'reset' }]);

    const alreadySettled = renderHook({
      active: true,
      initiallySettled: true,
      rarity: 'chase',
      reducedMotion: false,
    });
    alreadySettled.effect();
    expect(alreadySettled.controller.settled).toBe(true);
    expect(alreadySettled.events).toEqual([]);
  });

  test('provides a zero-motion CSS fallback with fluid 390px-safe sizing', () => {
    const css = readFileSync(new URL('./choreography.module.css', import.meta.url), 'utf8');

    expect(css).toContain('inline-size: min(100%, 15rem)');
    expect(css).toContain('max-inline-size: calc(100vw - 2rem)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*animation: none;/);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*transition: none;/);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*\.driver\s*\{[^}]*display: none;/s);
  });
});

function BindingContract() {
  const choreography = useRevealChoreography({
    active: true,
    initiallySettled: true,
    rarity: 'rare',
  });

  return (
    <div
      data-beat={choreography.beat}
      data-duration={choreography.transition.duration}
      data-rarity={choreography.rarity}
      data-revealed={choreography.revealed}
      data-settled={choreography.settled}
    />
  );
}

function controllerFor(
  beat: ChoreographyController['beat'],
  advance: ChoreographyController['advance'] = () => undefined,
): ChoreographyController {
  const settled = beat === 'settled';
  return {
    advance,
    beat,
    fastForward: () => undefined,
    intensity: 0.5,
    rarity: 'common',
    revealed: beat === 'reveal' || beat === 'celebrate' || settled,
    settled,
    transition: { duration: 0.34, ease: [0.2, 0.9, 0.3, 1] },
  };
}

function renderHook(options: UseRevealChoreographyOptions): {
  controller: ChoreographyController;
  effect: Effect;
  events: ChoreographyEvent[];
} {
  const effects: Effect[] = [];
  const events: ChoreographyEvent[] = [];
  const previousDispatcher = reactClientInternals.H;
  reactClientInternals.H = {
    useCallback<T>(callback: T) {
      return callback;
    },
    useEffect(effect) {
      effects.push(effect);
    },
    useReducer<I>(
      _reducer: (state: ChoreographyState, event: ChoreographyEvent) => ChoreographyState,
      initialArg: I,
      initializer: (value: I) => ChoreographyState,
    ) {
      return [initializer(initialArg), (event) => events.push(event)];
    },
    useRef<T>(initialValue: T) {
      return { current: initialValue };
    },
    useState<T>(initialValue: T | (() => T)) {
      return [
        typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue,
        () => undefined,
      ];
    },
  };

  try {
    const controller = renderRevealChoreography(options);
    const effect = effects[0];
    if (!effect) throw new Error('Expected choreography lifecycle effect');
    return { controller, effect, events };
  } finally {
    reactClientInternals.H = previousDispatcher;
  }
}
