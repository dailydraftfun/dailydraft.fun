import type { PullRarity } from '@dailydraft/contracts/pull-rarity';

export type MaybePromise<T> = T | Promise<T>;

export type SceneSize = Readonly<{
  height: number;
  width: number;
}>;

export type SceneViewport = SceneSize &
  Readonly<{
    resolution: number;
  }>;

export type DomFallbackDescriptor = Readonly<{
  id: string;
  label: string;
  preserves: readonly string[];
}>;

export type SceneFallbackContract = Readonly<{
  noWebGL: DomFallbackDescriptor;
  reducedMotion: DomFallbackDescriptor;
}>;

export type SceneFallbackReason = 'loading' | 'no-webgl' | 'reduced-motion' | 'renderer-error';

export type SceneMetadata = Readonly<{
  designSize: SceneSize;
  fallback: SceneFallbackContract;
  id: string;
}>;

export type ScenePresentation = Readonly<{
  rarity: PullRarity;
}>;

export function defineSceneMetadata<const T extends SceneMetadata>(metadata: T): T {
  return metadata;
}
