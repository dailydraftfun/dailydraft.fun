import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React, { type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChoreographyController } from '../choreography';
import { celebrationEffectProfileFor } from './celebration-effects';
import {
  CelebrationOverlay,
  useCelebrationBurst as renderCelebrationBurst,
} from './celebration-overlay';

type Effect = () => undefined | (() => void);

type HookDispatcher = {
  useEffect(effect: Effect): void;
  useRef<T>(initialValue: T): RefObject<T>;
  useState<T>(initialValue: T): [T, (value: T) => void];
};

type ReactClientInternals = {
  H: HookDispatcher | null;
};

const reactClientInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

describe('celebration overlay binding', () => {
  test('renders canvas only during the celebrate beat', () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay controller={controllerFor('celebrate', 'chase')} valueUsd={600} />,
    );

    expect(markup).toContain('data-celebration-canvas="true"');
    expect(markup).toContain('data-celebration-accent="full"');
    expect(markup).toContain('data-celebration-rarity="chase"');
    expect(markup).not.toContain('data-celebration-static');
    expect(renderToStaticMarkup(<CelebrationOverlay controller={controllerFor('reveal')} />)).toBe(
      '',
    );
  });

  test('replaces motion with a static rarity treatment when settled', () => {
    const markup = renderToStaticMarkup(
      <CelebrationOverlay
        controller={controllerFor('settled', 'rare')}
        reducedMotion
        valueUsd={72.5}
      />,
    );

    expect(markup).not.toContain('<canvas');
    expect(markup).toContain('data-celebration-reduced-motion="true"');
    expect(markup).toContain('data-celebration-static="true"');
    expect(markup).toContain('Rare pull revealed');
  });

  test('hard-suppresses canvas motion and exposes the static CSS fallback', () => {
    const css = readFileSync(new URL('./celebration.module.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.overlay\s*\{[^}]*pointer-events: none;/s);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*\.canvas\s*\{[^}]*display: none;/s);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*\.staticTreatment\s*\{[^}]*display: grid;/s);
  });

  test('latches on celebrate, resets on identity changes, and suppresses reduced motion', () => {
    const celebrating = renderBurstHook({ celebrating: true });
    celebrating.effects[0]?.();
    expect(celebrating.stateUpdates).toEqual([true]);

    const restarted = renderBurstHook({
      previousRarity: 'common',
      rarity: 'rare',
    });
    restarted.effects[0]?.();
    expect(restarted.stateUpdates).toEqual([false]);

    const reduced = renderBurstHook({
      celebrating: true,
      reducedMotion: true,
    });
    reduced.effects[0]?.();
    expect(reduced.stateUpdates).toEqual([false]);

    const unchanged = renderBurstHook({});
    unchanged.effects[0]?.();
    expect(unchanged.stateUpdates).toEqual([]);
  });

  test('sizes, runs, completes, and cleans up a latched canvas independently', () => {
    const browser = installBrowserHarness();
    const rendered = renderBurstHook({ burstActive: true });
    const canvas = createCanvas();
    rendered.canvasRef.current = canvas.element;

    try {
      const cleanup = rendered.effects[1]?.();
      expect(canvas.element.dataset.celebrationSequence).toBe('0');
      expect(canvas.element.width).toBe(450);
      expect(canvas.element.height).toBe(630);
      expect(browser.pending()).toBe(1);

      browser.flush(0);
      browser.flush(600);
      expect(rendered.stateUpdates).toContain(false);
      expect(browser.pending()).toBe(0);
      cleanup?.();
      expect(browser.canceled.length).toBe(0);
    } finally {
      browser.restore();
    }
  });

  test('does not schedule canvas work without an active burst or canvas', () => {
    const inactive = renderBurstHook({});
    expect(inactive.effects[1]?.()).toBeUndefined();

    const activeWithoutCanvas = renderBurstHook({ burstActive: true });
    expect(activeWithoutCanvas.effects[1]?.()).toBeUndefined();
  });
});

function renderBurstHook({
  burstActive = false,
  celebrating = false,
  previousRarity,
  rarity = 'common',
  reducedMotion = false,
}: {
  burstActive?: boolean;
  celebrating?: boolean;
  previousRarity?: ChoreographyController['rarity'];
  rarity?: ChoreographyController['rarity'];
  reducedMotion?: boolean;
}): {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  effects: Effect[];
  stateUpdates: boolean[];
} {
  const effects: Effect[] = [];
  const stateUpdates: boolean[] = [];
  const previousDispatcher = reactClientInternals.H;
  let refIndex = 0;
  reactClientInternals.H = {
    useEffect(effect) {
      effects.push(effect);
    },
    useRef<T>(initialValue: T) {
      refIndex += 1;
      if (refIndex === 2 && previousRarity) {
        return { current: { rarity: previousRarity, sequenceKey: 0 } as T };
      }
      return { current: initialValue };
    },
    useState<T>() {
      return [burstActive as T, (value) => stateUpdates.push(value as boolean)];
    },
  };

  try {
    const result = renderCelebrationBurst({
      celebrating,
      profile: celebrationEffectProfileFor(rarity),
      rarity,
      reducedMotion,
      sequenceKey: 0,
    });
    return { canvasRef: result.canvasRef, effects, stateUpdates };
  } finally {
    reactClientInternals.H = previousDispatcher;
  }
}

function installBrowserHarness() {
  const originalWindow = globalThis.window;
  const callbacks = new Map<number, (timestamp: number) => void>();
  const canceled: number[] = [];
  let nextFrame = 0;
  globalThis.window = {
    cancelAnimationFrame(frameId: number) {
      canceled.push(frameId);
      callbacks.delete(frameId);
    },
    devicePixelRatio: 3,
    requestAnimationFrame(callback: (timestamp: number) => void) {
      nextFrame += 1;
      callbacks.set(nextFrame, callback);
      return nextFrame;
    },
  } as unknown as Window & typeof globalThis;

  return {
    canceled,
    flush(timestamp: number) {
      const entry = callbacks.entries().next().value as
        | [number, (frameTimestamp: number) => void]
        | undefined;
      if (!entry) throw new Error('Expected a pending animation frame');
      callbacks.delete(entry[0]);
      entry[1](timestamp);
    },
    pending: () => callbacks.size,
    restore() {
      globalThis.window = originalWindow;
    },
  };
}

function createCanvas() {
  const context = {
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    arc() {},
    beginPath() {},
    clearRect() {},
    fill() {},
    fillRect() {},
  };
  const element = {
    dataset: {} as DOMStringMap,
    getBoundingClientRect: () => ({
      bottom: 420,
      height: 420,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    getContext: () => context,
    height: 0,
    width: 0,
  } as unknown as HTMLCanvasElement;

  return { element };
}

function controllerFor(
  beat: ChoreographyController['beat'],
  rarity: ChoreographyController['rarity'] = 'common',
): ChoreographyController {
  const settled = beat === 'settled';
  return {
    advance: () => undefined,
    beat,
    fastForward: () => undefined,
    intensity: 0.5,
    rarity,
    revealed: beat === 'reveal' || beat === 'celebrate' || settled,
    settled,
    transition: { duration: 0.34, ease: [0.2, 0.9, 0.3, 1] },
  };
}
