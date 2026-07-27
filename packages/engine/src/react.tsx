'use client';

import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useRef, useState } from 'react';

import type { QualityTier } from './quality';
import type { mountPixiScene as MountPixiScene, PixiSceneDefinition, SceneMount } from './runtime';
import type {
  DomFallbackDescriptor,
  SceneFallbackContract,
  SceneFallbackReason,
  SceneMetadata,
} from './types';

export type PixiSceneStatus =
  | { reason: SceneFallbackReason; type: 'fallback' }
  | { type: 'mounted' };

export type PixiSceneProps<Props> = Omit<ComponentPropsWithoutRef<'div'>, 'children'> &
  Readonly<{
    initialQuality?: QualityTier;
    input: Props;
    loadScene: () => Promise<PixiSceneDefinition<Props>>;
    loadRuntime?: () => Promise<{ mountPixiScene: typeof MountPixiScene }>;
    metadata: SceneMetadata;
    onStatusChange?: (status: PixiSceneStatus) => void;
    renderFallback(descriptor: DomFallbackDescriptor, reason: SceneFallbackReason): ReactNode;
    sceneKey?: number | string;
  }>;

export function PixiScene<Props>({
  className,
  initialQuality = 'high',
  input,
  loadScene,
  loadRuntime = defaultRuntimeLoader,
  metadata,
  onStatusChange,
  renderFallback,
  sceneKey = 0,
  ...containerProps
}: PixiSceneProps<Props>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const mountRef = useRef<SceneMount | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const [status, setStatus] = useState<PixiSceneStatus>({
    reason: 'loading',
    type: 'fallback',
  });
  const [motionRevision, setMotionRevision] = useState(0);

  useEffect(() => {
    void motionRevision;
    void sceneKey;
    const host = hostRef.current;
    if (!host) return;

    let active = true;
    const abortController = new AbortController();
    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const handleMotionChange = (): void => setMotionRevision((revision) => revision + 1);
    motionQuery?.addEventListener('change', handleMotionChange);

    const updateStatus = (nextStatus: PixiSceneStatus): void => {
      if (!active) return;
      setStatus(nextStatus);
      onStatusChangeRef.current?.(nextStatus);
    };

    if (motionQuery?.matches) {
      updateStatus({ reason: 'reduced-motion', type: 'fallback' });
      return () => {
        active = false;
        abortController.abort();
        motionQuery.removeEventListener('change', handleMotionChange);
      };
    }

    updateStatus({ reason: 'loading', type: 'fallback' });
    void Promise.all([loadRuntime(), loadScene()])
      .then(([{ mountPixiScene }, scene]) => {
        if (scene.id !== metadata.id) {
          throw new Error(
            `Loaded Pixi scene "${scene.id}" does not match metadata "${metadata.id}"`,
          );
        }
        return mountPixiScene({
          host,
          initialQuality,
          onFallback: (reason) => updateStatus({ reason, type: 'fallback' }),
          props: inputRef.current,
          scene,
          signal: abortController.signal,
        });
      })
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
      motionQuery?.removeEventListener('change', handleMotionChange);
    };
  }, [initialQuality, loadRuntime, loadScene, metadata.id, motionRevision, sceneKey]);

  const fallbackReason = status.type === 'mounted' ? 'assistive' : status.reason;
  const fallback = renderFallback(fallbackFor(metadata.fallback, fallbackReason), fallbackReason);

  return (
    <div
      {...containerProps}
      className={className}
      data-pixi-scene={metadata.id}
      data-pixi-status={status.type}
    >
      <div aria-hidden="true" data-pixi-canvas-host="" ref={hostRef} />
      <div
        aria-live="polite"
        data-pixi-dom-fallback=""
        style={status.type === 'mounted' ? visuallyHiddenStyle : undefined}
      >
        {fallback}
      </div>
    </div>
  );
}

function defaultRuntimeLoader(): Promise<{ mountPixiScene: typeof MountPixiScene }> {
  return import('./runtime');
}

function fallbackFor(
  fallback: SceneFallbackContract,
  reason: SceneFallbackReason,
): DomFallbackDescriptor {
  return reason === 'reduced-motion' ? fallback.reducedMotion : fallback.noWebGL;
}

const visuallyHiddenStyle = {
  blockSize: 1,
  clipPath: 'inset(50%)',
  inlineSize: 1,
  overflow: 'hidden',
  position: 'absolute',
  whiteSpace: 'nowrap',
} as const;
