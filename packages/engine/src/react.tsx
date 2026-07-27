'use client';

import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useRef, useState } from 'react';

import type { QualityTier } from './quality.js';
import type {
  mountPixiScene as MountPixiScene,
  PixiSceneDefinition,
  SceneMount,
} from './runtime.js';
import type { DomFallbackDescriptor, SceneFallbackContract, SceneFallbackReason } from './types.js';

export type PixiSceneStatus =
  | { reason: SceneFallbackReason; type: 'fallback' }
  | { type: 'mounted' };

export type PixiSceneProps<Props> = Omit<ComponentPropsWithoutRef<'div'>, 'children'> &
  Readonly<{
    initialQuality?: QualityTier;
    input: Props;
    loadRuntime?: () => Promise<{ mountPixiScene: typeof MountPixiScene }>;
    onStatusChange?: (status: PixiSceneStatus) => void;
    renderFallback(descriptor: DomFallbackDescriptor, reason: SceneFallbackReason): ReactNode;
    scene: PixiSceneDefinition<Props>;
  }>;

export function PixiScene<Props>({
  className,
  initialQuality = 'high',
  input,
  loadRuntime = defaultRuntimeLoader,
  onStatusChange,
  renderFallback,
  scene,
  ...containerProps
}: PixiSceneProps<Props>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<SceneMount | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const [status, setStatus] = useState<PixiSceneStatus>({
    reason: 'loading',
    type: 'fallback',
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let active = true;
    const abortController = new AbortController();
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const updateStatus = (nextStatus: PixiSceneStatus): void => {
      if (!active) return;
      setStatus(nextStatus);
      onStatusChangeRef.current?.(nextStatus);
    };

    if (reducedMotion) {
      updateStatus({ reason: 'reduced-motion', type: 'fallback' });
      return () => {
        active = false;
        abortController.abort();
      };
    }

    void loadRuntime()
      .then(({ mountPixiScene }) =>
        mountPixiScene({
          host,
          initialQuality,
          props: input,
          scene,
          signal: abortController.signal,
        }),
      )
      .then((result) => {
        if (!active || result.status === 'aborted') {
          if (result.status === 'mounted') result.mount.destroy();
          return;
        }
        if (result.status === 'fallback') {
          updateStatus({ reason: result.reason, type: 'fallback' });
          return;
        }

        mountRef.current = result.mount;
        updateStatus({ type: 'mounted' });
      })
      .catch(() => {
        updateStatus({ reason: 'renderer-error', type: 'fallback' });
      });

    return () => {
      active = false;
      abortController.abort();
      mountRef.current?.destroy();
      mountRef.current = null;
    };
  }, [initialQuality, input, loadRuntime, scene]);

  const fallback =
    status.type === 'fallback'
      ? renderFallback(fallbackFor(scene.fallback, status.reason), status.reason)
      : null;

  return (
    <div
      {...containerProps}
      className={className}
      data-pixi-scene={scene.id}
      data-pixi-status={status.type}
    >
      <div aria-hidden="true" data-pixi-canvas-host="" ref={hostRef} />
      {fallback}
    </div>
  );
}

function defaultRuntimeLoader(): Promise<{ mountPixiScene: typeof MountPixiScene }> {
  return import('./runtime.js');
}

function fallbackFor(
  fallback: SceneFallbackContract,
  reason: SceneFallbackReason,
): DomFallbackDescriptor {
  return reason === 'reduced-motion' ? fallback.reducedMotion : fallback.noWebGL;
}
