import { describe, expect, test } from 'bun:test';
import { type Application, type ApplicationOptions, Container, type Ticker } from 'pixi.js';
import type { QualityBudget, QualityTier } from './quality.js';
import { definePixiScene, mountPixiScene, type PixiSceneInstance } from './runtime.js';
import type { SceneViewport } from './types.js';

describe('Pixi scene lifecycle', () => {
  test('fails closed before allocating a renderer when WebGL is unavailable', async () => {
    const result = await mountPixiScene({
      dependencies: {
        createApplication: () => {
          throw new Error('application should not be created');
        },
        supportsWebGL: () => false,
      },
      host: hostHarness().host,
      props: { cardId: 'card-1' },
      scene: sceneHarness().scene,
    });

    expect(result).toEqual({ reason: 'no-webgl', status: 'fallback' });
  });

  test('fails closed when the capability probe itself is unavailable', async () => {
    const observedErrors: unknown[] = [];
    const result = await mountPixiScene({
      dependencies: {
        supportsWebGL: () => {
          throw new Error('capability probe failed');
        },
      },
      host: hostHarness().host,
      onError: (error) => observedErrors.push(error),
      props: { cardId: 'card-1' },
      scene: sceneHarness().scene,
    });

    expect(result).toEqual({ reason: 'renderer-error', status: 'fallback' });
    expect(observedErrors).toHaveLength(1);
  });

  test('mounts, resizes, degrades quality, and tears down exactly once', async () => {
    const application = applicationHarness();
    const host = hostHarness();
    const scene = sceneHarness();
    const observer = resizeObserverHarness();
    const qualityChanges: QualityTier[] = [];
    const result = await mountPixiScene({
      dependencies: {
        createApplication: () => application.application,
        createResizeObserver: observer.create,
        devicePixelRatio: () => 3,
        supportsWebGL: () => true,
      },
      host: host.host,
      onQualityChange: (tier) => qualityChanges.push(tier),
      props: { cardId: 'card-1' },
      scene: scene.scene,
    });

    expect(result.status).toBe('mounted');
    if (result.status !== 'mounted') throw new Error('Expected mounted scene');

    expect(application.initOptions).toMatchObject({
      antialias: true,
      autoDensity: true,
      failIfMajorPerformanceCaveat: true,
      height: 620,
      preference: ['webgl'],
      resolution: 2,
      width: 390,
    });
    expect(scene.createdWith).toMatchObject({
      props: { cardId: 'card-1' },
      quality: 'high',
      viewport: { height: 620, resolution: 2, width: 390 },
    });
    expect(host.appended).toEqual([application.canvas]);
    expect(application.attributes).toEqual({ 'aria-hidden': 'true' });
    expect(application.canvas.style).toMatchObject({
      blockSize: '100%',
      display: 'block',
      inlineSize: '100%',
    });
    expect(observer.observed).toEqual([host.host]);

    host.bounds = { height: 300, width: 200 };
    observer.trigger();
    expect(application.resizeCalls.at(-1)).toEqual([200, 300, 2]);
    expect(scene.resizeCalls.at(-1)).toEqual({ height: 300, resolution: 2, width: 200 });

    application.tick(30, 30);
    expect(result.mount.quality).toBe('medium');
    expect(application.maxFps).toBe(45);
    expect(application.resizeCalls.at(-1)).toEqual([200, 300, 1.5]);

    application.tick(40, 30);
    expect(result.mount.quality).toBe('low');
    expect(application.maxFps).toBe(30);
    expect(application.resizeCalls.at(-1)).toEqual([200, 300, 1]);
    expect(qualityChanges).toEqual(['medium', 'low']);
    expect(scene.qualityCalls.map(([tier]) => tier)).toEqual(['medium', 'low']);
    expect(result.mount.viewport).toEqual({ height: 300, resolution: 1, width: 200 });

    result.mount.resize();
    result.mount.destroy();
    result.mount.destroy();
    expect(observer.disconnectCount).toBe(1);
    expect(application.listenerCount).toBe(0);
    expect(scene.destroyCount).toBe(1);
    expect(application.destroyCount).toBe(1);
  });

  test('uses the design aspect ratio when the host has no measured height', async () => {
    const application = applicationHarness();
    const host = hostHarness({ height: 0, width: 195 });
    const result = await mountPixiScene({
      dependencies: {
        createApplication: () => application.application,
        createResizeObserver: () => null,
        devicePixelRatio: () => Number.NaN,
        supportsWebGL: () => true,
      },
      host: host.host,
      initialQuality: 'low',
      props: { cardId: 'card-1' },
      scene: sceneHarness().scene,
    });

    expect(result.status).toBe('mounted');
    expect(application.initOptions).toMatchObject({
      antialias: false,
      height: 310,
      resolution: 1,
      width: 195,
    });
    if (result.status === 'mounted') result.mount.destroy();
  });

  test('destroys a renderer that resolves after navigation aborts', async () => {
    const application = applicationHarness({ deferredInit: true });
    const scene = sceneHarness();
    const abortController = new AbortController();
    const resultPromise = mountPixiScene({
      dependencies: {
        createApplication: () => application.application,
        supportsWebGL: () => true,
      },
      host: hostHarness().host,
      props: { cardId: 'card-1' },
      scene: scene.scene,
      signal: abortController.signal,
    });

    abortController.abort();
    application.resolveInit();
    expect(await resultPromise).toEqual({ status: 'aborted' });
    expect(application.destroyCount).toBe(1);
    expect(scene.createCount).toBe(0);
  });

  test('returns an aborted result without probing capabilities when already cancelled', async () => {
    const abortController = new AbortController();
    abortController.abort();

    const result = await mountPixiScene({
      dependencies: {
        supportsWebGL: () => {
          throw new Error('capability probe should not run');
        },
      },
      host: hostHarness().host,
      props: { cardId: 'card-1' },
      scene: sceneHarness().scene,
      signal: abortController.signal,
    });

    expect(result).toEqual({ status: 'aborted' });
  });

  test('fails closed and reports scene initialization errors after cleanup', async () => {
    const application = applicationHarness();
    const observedErrors: unknown[] = [];
    const brokenScene = sceneHarness({
      create: () => {
        throw new Error('scene failed');
      },
    });
    const result = await mountPixiScene({
      dependencies: {
        createApplication: () => application.application,
        supportsWebGL: () => true,
      },
      host: hostHarness().host,
      onError: (error) => observedErrors.push(error),
      props: { cardId: 'card-1' },
      scene: brokenScene.scene,
    });

    expect(result).toEqual({ reason: 'renderer-error', status: 'fallback' });
    expect(observedErrors).toHaveLength(1);
    expect(application.destroyCount).toBe(1);
  });

  test('continues renderer teardown when scene-owned cleanup throws', async () => {
    const application = applicationHarness();
    const observedErrors: unknown[] = [];
    const result = await mountPixiScene({
      dependencies: {
        createApplication: () => application.application,
        supportsWebGL: () => true,
      },
      host: hostHarness().host,
      onError: (error) => observedErrors.push(error),
      props: { cardId: 'card-1' },
      scene: sceneHarness({
        create: () => ({
          destroy() {
            throw new Error('scene cleanup failed');
          },
          resize: () => undefined,
        }),
      }).scene,
    });

    expect(result.status).toBe('mounted');
    if (result.status !== 'mounted') throw new Error('Expected mounted scene');
    expect(() => result.mount.destroy()).not.toThrow();
    expect(observedErrors).toHaveLength(1);
    expect(application.destroyCount).toBe(1);
  });
});

type Input = { cardId: string };

function sceneHarness(
  overrides: Partial<{
    create(): PixiSceneInstance;
  }> = {},
) {
  let createCount = 0;
  let destroyCount = 0;
  const resizeCalls: SceneViewport[] = [];
  const qualityCalls: Array<[QualityTier, QualityBudget]> = [];
  let createdWith: unknown;
  const instance: PixiSceneInstance = {
    destroy() {
      destroyCount += 1;
    },
    resize(viewport) {
      resizeCalls.push(viewport);
    },
    setQuality(tier, budget) {
      qualityCalls.push([tier, budget]);
    },
  };
  const scene = definePixiScene<Input>({
    create(context) {
      createCount += 1;
      createdWith = context;
      return overrides.create?.() ?? instance;
    },
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

  return {
    get createCount() {
      return createCount;
    },
    get createdWith() {
      return createdWith;
    },
    get destroyCount() {
      return destroyCount;
    },
    qualityCalls,
    resizeCalls,
    scene,
  };
}

function applicationHarness(options: { deferredInit?: boolean } = {}) {
  const listeners = new Set<(ticker: Ticker) => void>();
  const resizeCalls: Array<[number, number, number | undefined]> = [];
  const attributes: Record<string, string> = {};
  const canvas = {
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
    style: {},
  } as unknown as HTMLCanvasElement;
  let destroyCount = 0;
  let initOptions: Partial<ApplicationOptions> | undefined;
  let maxFps = 0;
  let resolveInit: () => void = () => undefined;
  const initPromise = options.deferredInit
    ? new Promise<void>((resolve) => {
        resolveInit = resolve;
      })
    : Promise.resolve();
  const ticker = {
    add(listener: (ticker: Ticker) => void) {
      listeners.add(listener);
    },
    get maxFPS() {
      return maxFps;
    },
    remove(listener: (ticker: Ticker) => void) {
      listeners.delete(listener);
    },
    set maxFPS(value: number) {
      maxFps = value;
    },
  };
  const application = {
    canvas,
    destroy() {
      destroyCount += 1;
    },
    async init(receivedOptions: Partial<ApplicationOptions>) {
      initOptions = receivedOptions;
      await initPromise;
    },
    renderer: {
      resize(width: number, height: number, resolution?: number) {
        resizeCalls.push([width, height, resolution]);
      },
    },
    stage: new Container(),
    ticker,
  } as unknown as Application;

  return {
    application,
    attributes,
    canvas,
    get destroyCount() {
      return destroyCount;
    },
    get initOptions() {
      return initOptions;
    },
    get listenerCount() {
      return listeners.size;
    },
    get maxFps() {
      return maxFps;
    },
    resizeCalls,
    resolveInit,
    tick(elapsedMS: number, count = 1) {
      for (let index = 0; index < count; index += 1) {
        for (const listener of listeners) listener({ elapsedMS } as Ticker);
      }
    },
  };
}

function hostHarness(initialBounds = { height: 620, width: 390 }) {
  const appended: unknown[] = [];
  const harness = {
    appended,
    bounds: initialBounds,
    host: {
      appendChild(child: unknown) {
        appended.push(child);
        return child;
      },
      getBoundingClientRect() {
        return harness.bounds;
      },
    } as unknown as HTMLElement,
  };
  return harness;
}

function resizeObserverHarness() {
  let callback: () => void = () => undefined;
  let disconnectCount = 0;
  const observed: Element[] = [];

  return {
    create(receivedCallback: () => void) {
      callback = receivedCallback;
      return {
        disconnect() {
          disconnectCount += 1;
        },
        observe(target: Element) {
          observed.push(target);
        },
      };
    },
    get disconnectCount() {
      return disconnectCount;
    },
    observed,
    trigger() {
      callback();
    },
  };
}
