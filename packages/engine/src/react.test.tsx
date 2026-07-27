import { describe, expect, test } from 'bun:test';
import React, { type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PixiScene, type PixiSceneProps, type PixiSceneStatus } from './react.js';
import { definePixiScene, type SceneMount, type SceneMountResult } from './runtime.js';
import { defineSceneMetadata } from './types.js';

type Effect = () => undefined | (() => void);

type HookDispatcher = {
  useEffect(effect: Effect): void;
  useRef<T>(initialValue: T): RefObject<T>;
  useState<T>(initialValue: T | (() => T)): [T, (value: T) => void];
};

type ReactClientInternals = {
  H: HookDispatcher | null;
};

const reactClientInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

const metadata = defineSceneMetadata({
  designSize: { height: 620, width: 390 },
  fallback: {
    noWebGL: {
      id: 'dom-reveal',
      label: 'Card reveal',
      preserves: ['card identity', 'rarity'],
    },
    reducedMotion: {
      id: 'dom-reveal-static',
      label: 'Static card reveal',
      preserves: ['card identity', 'rarity'],
    },
  },
  id: 'pack-open',
});
const scene = definePixiScene<{ cardId: string }>({
  ...metadata,
  create: () => ({
    destroy: () => undefined,
    resize: () => undefined,
  }),
});

describe('lazy Pixi React binding', () => {
  test('server-renders the informative DOM fallback without a canvas', () => {
    const markup = renderToStaticMarkup(
      <PixiScene
        input={{ cardId: 'card-1' }}
        loadScene={async () => scene}
        metadata={metadata}
        renderFallback={(descriptor, reason) => (
          <p data-fallback={descriptor.id} data-reason={reason}>
            {descriptor.label}
          </p>
        )}
      />,
    );

    expect(markup).toContain('data-pixi-scene="pack-open"');
    expect(markup).toContain('data-pixi-status="fallback"');
    expect(markup).toContain('data-fallback="dom-reveal"');
    expect(markup).toContain('data-reason="loading"');
    expect(markup).toContain('Card reveal');
    expect(markup).not.toContain('<canvas');
  });

  test('keeps an informative DOM equivalent available after the canvas mounts', () => {
    const markup = renderBindingMarkup({ type: 'mounted' });

    expect(markup).toContain('data-pixi-status="mounted"');
    expect(markup).toContain('data-pixi-dom-fallback=""');
    expect(markup).toContain('data-reason="assistive"');
    expect(markup).toContain('clip-path:inset(50%)');
    expect(markup).toContain('Card reveal');
  });

  test('settles directly onto the reduced-motion DOM contract without loading Pixi', () => {
    let runtimeLoaded = false;
    let sceneLoaded = false;
    const hook = renderBinding({
      loadRuntime: async () => {
        runtimeLoaded = true;
        return { mountPixiScene: async () => ({ status: 'aborted' }) };
      },
      loadScene: async () => {
        sceneLoaded = true;
        return scene;
      },
      reducedMotion: true,
    });

    const cleanup = hook.effect();
    expect(runtimeLoaded).toBe(false);
    expect(sceneLoaded).toBe(false);
    expect(hook.statuses).toEqual([{ reason: 'reduced-motion', type: 'fallback' }]);
    cleanup?.();
  });

  test('mounts the lazy runtime and destroys it during React cleanup', async () => {
    let destroyCount = 0;
    const mount = sceneMount(() => {
      destroyCount += 1;
    });
    const hook = renderBinding({
      mountResult: { mount, status: 'mounted' },
    });

    const cleanup = hook.effect();
    await flushPromises();

    expect(hook.receivedSignal?.aborted).toBe(false);
    expect(hook.statuses).toEqual([{ reason: 'loading', type: 'fallback' }, { type: 'mounted' }]);
    cleanup?.();
    cleanup?.();
    expect(hook.receivedSignal?.aborted).toBe(true);
    expect(destroyCount).toBe(1);
  });

  test('renders the declared fallback when WebGL or initialization is unavailable', async () => {
    const noWebGL = renderBinding({
      mountResult: { reason: 'no-webgl', status: 'fallback' },
    });
    noWebGL.effect();
    await flushPromises();
    expect(noWebGL.statuses).toEqual([
      { reason: 'loading', type: 'fallback' },
      { reason: 'no-webgl', type: 'fallback' },
    ]);

    const failedLoader = renderBinding({
      loadRuntime: async () => {
        throw new Error('chunk failed');
      },
    });
    failedLoader.effect();
    await flushPromises();
    expect(failedLoader.statuses).toEqual([
      { reason: 'loading', type: 'fallback' },
      { reason: 'renderer-error', type: 'fallback' },
    ]);

    const mismatchedScene = renderBinding({
      loadScene: async () => ({ ...scene, id: 'different-scene' }),
    });
    mismatchedScene.effect();
    await flushPromises();
    expect(mismatchedScene.statuses).toEqual([
      { reason: 'loading', type: 'fallback' },
      { reason: 'renderer-error', type: 'fallback' },
    ]);
  });

  test('destroys a mount that resolves after the component has unmounted', async () => {
    let resolveResult: (result: SceneMountResult) => void = () => undefined;
    const resultPromise = new Promise<SceneMountResult>((resolve) => {
      resolveResult = resolve;
    });
    let destroyCount = 0;
    const hook = renderBinding({
      loadRuntime: async () => ({
        mountPixiScene: async () => resultPromise,
      }),
    });

    const cleanup = hook.effect();
    cleanup?.();
    resolveResult({
      mount: sceneMount(() => {
        destroyCount += 1;
      }),
      status: 'mounted',
    });
    await flushPromises();

    expect(hook.statuses).toEqual([{ reason: 'loading', type: 'fallback' }]);
    expect(destroyCount).toBe(1);
  });

  test('switches to the DOM fallback when an active renderer reports context loss', async () => {
    const hook = renderBinding({
      mountResult: { mount: sceneMount(() => undefined), status: 'mounted' },
    });

    hook.effect();
    await flushPromises();
    hook.reportFallback?.('no-webgl');

    expect(hook.statuses.at(-1)).toEqual({ reason: 'no-webgl', type: 'fallback' });
  });

  test('subscribes to live reduced-motion changes and removes the listener on cleanup', () => {
    const hook = renderBinding();
    const cleanup = hook.effect();

    expect(hook.motionListenerCount).toBe(1);
    cleanup?.();
    expect(hook.motionListenerCount).toBe(0);
  });
});

function renderBinding({
  loadScene,
  loadRuntime,
  mountResult = { status: 'aborted' },
  reducedMotion = false,
}: {
  loadScene?: PixiSceneProps<{ cardId: string }>['loadScene'];
  loadRuntime?: PixiSceneProps<{ cardId: string }>['loadRuntime'];
  mountResult?: SceneMountResult;
  reducedMotion?: boolean;
} = {}) {
  const effects: Effect[] = [];
  const statuses: PixiSceneStatus[] = [];
  const host = {} as HTMLDivElement;
  let refIndex = 0;
  let receivedSignal: AbortSignal | undefined;
  let reportFallback: ((reason: 'no-webgl' | 'renderer-error') => void) | undefined;
  const motionListeners = new Set<EventListenerOrEventListenerObject>();
  const matchMedia = () => ({
    addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
      motionListeners.add(listener);
    },
    matches: reducedMotion,
    removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
      motionListeners.delete(listener);
    },
  });
  const previousDispatcher = reactClientInternals.H;
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      matchMedia,
    },
  });
  reactClientInternals.H = {
    useEffect(effect) {
      effects.push(effect);
    },
    useRef<T>(initialValue: T) {
      refIndex += 1;
      return { current: (refIndex === 1 ? host : initialValue) as T };
    },
    useState<T>(initialValue: T | (() => T)) {
      return [
        typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue,
        (value) => statuses.push(value as PixiSceneStatus),
      ];
    },
  };

  try {
    PixiScene({
      input: { cardId: 'card-1' },
      loadRuntime:
        loadRuntime ??
        (async () => ({
          mountPixiScene: async (options) => {
            receivedSignal = options.signal;
            reportFallback = options.onFallback;
            return mountResult;
          },
        })),
      loadScene: loadScene ?? (async () => scene),
      metadata,
      onStatusChange: (status) => statuses.push(status),
      renderFallback: () => null,
    });
    const effect = effects[0];
    if (!effect) throw new Error('Expected Pixi scene lifecycle effect');
    return {
      effect() {
        const activeWindow = globalThis.window;
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: {
            matchMedia,
          },
        });
        try {
          return effect();
        } finally {
          Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: activeWindow,
          });
        }
      },
      get receivedSignal() {
        return receivedSignal;
      },
      get reportFallback() {
        return reportFallback;
      },
      get motionListenerCount() {
        return motionListeners.size;
      },
      get statuses() {
        return statuses.filter((_status, index) => index % 2 === 1);
      },
    };
  } finally {
    reactClientInternals.H = previousDispatcher;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
}

function sceneMount(destroy: () => void): SceneMount {
  return {
    destroy,
    quality: 'high',
    resize: () => undefined,
    viewport: { height: 620, resolution: 2, width: 390 },
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function renderBindingMarkup(status: PixiSceneStatus): string {
  const previousDispatcher = reactClientInternals.H;
  let stateIndex = 0;
  reactClientInternals.H = {
    useEffect: () => undefined,
    useRef: <T,>(initialValue: T) => ({ current: initialValue }),
    useState<T>(initialValue: T | (() => T)) {
      stateIndex += 1;
      const resolved =
        stateIndex === 1
          ? status
          : typeof initialValue === 'function'
            ? (initialValue as () => T)()
            : initialValue;
      return [resolved as T, () => undefined];
    },
  };

  try {
    return renderToStaticMarkup(
      PixiScene({
        input: { cardId: 'card-1' },
        loadScene: async () => scene,
        metadata,
        renderFallback: (descriptor, reason) => (
          <p data-fallback={descriptor.id} data-reason={reason}>
            {descriptor.label}
          </p>
        ),
      }),
    );
  } finally {
    reactClientInternals.H = previousDispatcher;
  }
}
