import { describe, expect, test } from 'bun:test';
import React, { type RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PixiScene, type PixiSceneProps, type PixiSceneStatus } from './react.js';
import { definePixiScene, type SceneMount, type SceneMountResult } from './runtime.js';

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

const scene = definePixiScene<{ cardId: string }>({
  create: () => ({
    destroy: () => undefined,
    resize: () => undefined,
  }),
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

describe('lazy Pixi React binding', () => {
  test('server-renders the informative DOM fallback without a canvas', () => {
    const markup = renderToStaticMarkup(
      <PixiScene
        input={{ cardId: 'card-1' }}
        renderFallback={(descriptor, reason) => (
          <p data-fallback={descriptor.id} data-reason={reason}>
            {descriptor.label}
          </p>
        )}
        scene={scene}
      />,
    );

    expect(markup).toContain('data-pixi-scene="pack-open"');
    expect(markup).toContain('data-pixi-status="fallback"');
    expect(markup).toContain('data-fallback="dom-reveal"');
    expect(markup).toContain('data-reason="loading"');
    expect(markup).toContain('Card reveal');
    expect(markup).not.toContain('<canvas');
  });

  test('settles directly onto the reduced-motion DOM contract without loading Pixi', () => {
    let runtimeLoaded = false;
    const hook = renderBinding({
      loadRuntime: async () => {
        runtimeLoaded = true;
        return { mountPixiScene: async () => ({ status: 'aborted' }) };
      },
      reducedMotion: true,
    });

    const cleanup = hook.effect();
    expect(runtimeLoaded).toBe(false);
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
    expect(hook.statuses).toEqual([{ type: 'mounted' }]);
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
    expect(noWebGL.statuses).toEqual([{ reason: 'no-webgl', type: 'fallback' }]);

    const failedLoader = renderBinding({
      loadRuntime: async () => {
        throw new Error('chunk failed');
      },
    });
    failedLoader.effect();
    await flushPromises();
    expect(failedLoader.statuses).toEqual([{ reason: 'renderer-error', type: 'fallback' }]);
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

    expect(hook.statuses).toEqual([]);
    expect(destroyCount).toBe(1);
  });
});

function renderBinding({
  loadRuntime,
  mountResult = { status: 'aborted' },
  reducedMotion = false,
}: {
  loadRuntime?: PixiSceneProps<{ cardId: string }>['loadRuntime'];
  mountResult?: SceneMountResult;
  reducedMotion?: boolean;
}) {
  const effects: Effect[] = [];
  const statuses: PixiSceneStatus[] = [];
  const host = {} as HTMLDivElement;
  let refIndex = 0;
  let receivedSignal: AbortSignal | undefined;
  const previousDispatcher = reactClientInternals.H;
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      matchMedia: () => ({ matches: reducedMotion }),
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
            return mountResult;
          },
        })),
      onStatusChange: (status) => statuses.push(status),
      renderFallback: () => null,
      scene,
    });
    const effect = effects[0];
    if (!effect) throw new Error('Expected Pixi scene lifecycle effect');
    return {
      effect() {
        const activeWindow = globalThis.window;
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: {
            matchMedia: () => ({ matches: reducedMotion }),
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
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
