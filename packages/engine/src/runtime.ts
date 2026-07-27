import {
  Application,
  type ApplicationOptions,
  type Container,
  isWebGLSupported,
  type Ticker,
} from 'pixi.js';

import {
  FrameBudgetMonitor,
  QUALITY_BUDGETS,
  type QualityBudget,
  type QualityTier,
} from './quality.js';
import type { MaybePromise, SceneMetadata, SceneViewport } from './types.js';

export type PixiSceneContext<Props> = Readonly<{
  application: Application;
  budget: QualityBudget;
  props: Props;
  quality: QualityTier;
  stage: Container;
  viewport: SceneViewport;
}>;

export type PixiSceneInstance = Readonly<{
  destroy(): void;
  resize(viewport: SceneViewport): void;
  setQuality?(tier: QualityTier, budget: QualityBudget): void;
}>;

export type PixiSceneDefinition<Props> = SceneMetadata &
  Readonly<{
    create(context: PixiSceneContext<Props>): MaybePromise<PixiSceneInstance>;
  }>;

export function definePixiScene<Props>(
  definition: PixiSceneDefinition<Props>,
): PixiSceneDefinition<Props> {
  return definition;
}

export type SceneMount = Readonly<{
  destroy(): void;
  readonly quality: QualityTier;
  resize(): void;
  readonly viewport: SceneViewport;
}>;

export type SceneMountResult =
  | { mount: SceneMount; status: 'mounted' }
  | { reason: 'no-webgl' | 'renderer-error'; status: 'fallback' }
  | { status: 'aborted' };

type ResizeObserverLike = Readonly<{
  disconnect(): void;
  observe(target: Element): void;
}>;

export type PixiRuntimeDependencies = Readonly<{
  createApplication(): Application;
  createResizeObserver(callback: () => void): ResizeObserverLike | null;
  devicePixelRatio(): number;
  supportsWebGL(): boolean;
}>;

export type MountPixiSceneOptions<Props> = Readonly<{
  dependencies?: Partial<PixiRuntimeDependencies>;
  host: HTMLElement;
  initialQuality?: QualityTier;
  onError?: (error: unknown) => void;
  onQualityChange?: (tier: QualityTier, budget: QualityBudget) => void;
  props: Props;
  scene: PixiSceneDefinition<Props>;
  signal?: AbortSignal;
}>;

const defaultDependencies: PixiRuntimeDependencies = {
  createApplication: () => new Application(),
  createResizeObserver: (callback) =>
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(callback),
  devicePixelRatio: () =>
    typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1),
  supportsWebGL: () => isWebGLSupported(true),
};

export async function mountPixiScene<Props>({
  dependencies: dependencyOverrides,
  host,
  initialQuality = 'high',
  onError,
  onQualityChange,
  props,
  scene,
  signal,
}: MountPixiSceneOptions<Props>): Promise<SceneMountResult> {
  if (signal?.aborted) return { status: 'aborted' };

  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  let application: Application;
  try {
    if (!dependencies.supportsWebGL()) {
      return { reason: 'no-webgl', status: 'fallback' };
    }
    application = dependencies.createApplication();
  } catch (error) {
    onError?.(error);
    return { reason: 'renderer-error', status: 'fallback' };
  }

  let applicationDestroyed = false;
  let instance: PixiSceneInstance | undefined;
  let resizeObserver: ResizeObserverLike | null = null;
  let tickerListener: ((ticker: Ticker) => void) | undefined;

  const destroyResources = (): void => {
    attemptCleanup(() => resizeObserver?.disconnect());
    resizeObserver = null;
    if (tickerListener) {
      const listener = tickerListener;
      attemptCleanup(() => application.ticker.remove(listener));
    }
    tickerListener = undefined;
    const mountedInstance = instance;
    instance = undefined;
    if (mountedInstance) attemptCleanup(() => mountedInstance.destroy());
    if (applicationDestroyed) return;
    applicationDestroyed = true;
    attemptCleanup(() => {
      application.destroy({ removeView: true }, { children: true });
    });
  };

  const attemptCleanup = (cleanup: () => void): void => {
    try {
      cleanup();
    } catch (error) {
      onError?.(error);
    }
  };

  try {
    let quality = initialQuality;
    let budget = QUALITY_BUDGETS[quality];
    let viewport = viewportFor(host, scene, dependencies.devicePixelRatio(), budget);
    const applicationOptions = {
      antialias: quality !== 'low',
      autoDensity: true,
      backgroundAlpha: 0,
      failIfMajorPerformanceCaveat: true,
      height: viewport.height,
      powerPreference: 'high-performance',
      preference: ['webgl'],
      resolution: viewport.resolution,
      width: viewport.width,
    } satisfies Partial<ApplicationOptions>;

    await application.init(applicationOptions);
    if (signal?.aborted) {
      destroyResources();
      return { status: 'aborted' };
    }

    application.ticker.maxFPS = budget.maxFps;
    instance = await scene.create({
      application,
      budget,
      props,
      quality,
      stage: application.stage,
      viewport,
    });
    if (signal?.aborted) {
      destroyResources();
      return { status: 'aborted' };
    }

    const canvas = application.canvas;
    canvas.style.blockSize = '100%';
    canvas.style.display = 'block';
    canvas.style.inlineSize = '100%';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    const qualityMonitor = new FrameBudgetMonitor({ initialTier: quality });
    const resize = (): void => {
      viewport = viewportFor(host, scene, dependencies.devicePixelRatio(), budget);
      application.renderer.resize(viewport.width, viewport.height, viewport.resolution);
      instance?.resize(viewport);
    };

    tickerListener = (ticker): void => {
      const nextQuality = qualityMonitor.recordFrame(ticker.elapsedMS);
      if (nextQuality === quality) return;

      quality = nextQuality;
      budget = QUALITY_BUDGETS[quality];
      application.ticker.maxFPS = budget.maxFps;
      resize();
      instance?.setQuality?.(quality, budget);
      onQualityChange?.(quality, budget);
    };
    application.ticker.add(tickerListener);
    resizeObserver = dependencies.createResizeObserver(resize);
    resizeObserver?.observe(host);
    resize();

    let destroyed = false;
    return {
      mount: {
        destroy() {
          if (destroyed) return;
          destroyed = true;
          destroyResources();
        },
        get quality() {
          return quality;
        },
        resize,
        get viewport() {
          return viewport;
        },
      },
      status: 'mounted',
    };
  } catch (error) {
    destroyResources();
    onError?.(error);
    return signal?.aborted
      ? { status: 'aborted' }
      : { reason: 'renderer-error', status: 'fallback' };
  }
}

function viewportFor(
  host: HTMLElement,
  scene: SceneMetadata,
  devicePixelRatio: number,
  budget: QualityBudget,
): SceneViewport {
  const bounds = host.getBoundingClientRect();
  const width = positiveDimension(bounds.width, scene.designSize.width);
  const fallbackHeight = (width * scene.designSize.height) / scene.designSize.width;
  const height = positiveDimension(bounds.height, fallbackHeight);
  const safeDevicePixelRatio = positiveDimension(devicePixelRatio, 1);

  return {
    height,
    resolution: Math.min(safeDevicePixelRatio, budget.resolutionScale),
    width,
  };
}

function positiveDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
