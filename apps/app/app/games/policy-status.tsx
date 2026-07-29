'use client';

import {
  LockKeyIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import type { GameCatalog } from './game-catalog';
import { getGameCatalog } from './games-client';

export type PolicySurfaceState =
  | { status: 'denied'; reason: string }
  | { status: 'enabled'; reason: string }
  | { status: 'loading'; reason: string }
  | { status: 'malformed'; reason: string };

export function resolvePolicySurface(catalog: GameCatalog): PolicySurfaceState {
  const runtimeModes = catalog.modes.filter(
    ({ capabilitySource }) => capabilitySource.kind === 'runtime',
  );
  const actionable = runtimeModes.filter(({ availableActions }) => availableActions.length > 0);
  if (actionable.length === 0) {
    return {
      reason:
        runtimeModes.find(({ reason }) => reason.trim().length > 0)?.reason ??
        'Value-bearing play is unavailable under the current policy.',
      status: 'denied',
    };
  }
  return {
    reason:
      'Devnet test assets only. Availability does not imply legal, provider, or mainnet approval.',
    status: 'enabled',
  };
}

export function PolicyStatusBadge({
  initialState = {
    reason: 'Checking the current server-owned capability policy.',
    status: 'loading',
  },
  loadCatalog = getGameCatalog,
}: {
  initialState?: PolicySurfaceState;
  loadCatalog?: () => Promise<GameCatalog>;
}) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    let active = true;
    loadCatalog().then(
      (catalog) => {
        if (active) setState(resolvePolicySurface(catalog));
      },
      () => {
        if (active) {
          setState({
            reason:
              'Capability evidence is unavailable or malformed. Value-bearing play is withheld.',
            status: 'malformed',
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [loadCatalog]);

  return <PolicyStatusSurface state={state} />;
}

export function PolicyStatusSurface({ state }: { state: PolicySurfaceState }) {
  const presentation = {
    denied: {
      icon: <LockKeyIcon size={15} weight="bold" />,
      label: 'Unavailable by policy',
    },
    enabled: {
      icon: <ShieldCheckIcon size={15} weight="fill" />,
      label: 'Devnet capability',
    },
    loading: {
      icon: <SpinnerGapIcon size={15} />,
      label: 'Checking policy',
    },
    malformed: {
      icon: <WarningCircleIcon size={15} weight="fill" />,
      label: 'Policy unavailable',
    },
  }[state.status];

  return (
    <aside
      aria-disabled={state.status === 'denied' || state.status === 'malformed' ? 'true' : undefined}
      aria-live="polite"
      className="fixed right-4 bottom-4 z-40 max-w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-elevated/95 px-3 py-2 shadow-lg backdrop-blur"
      data-policy-state={state.status}
      role="status"
    >
      <details>
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-xs font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime">
          <span className={state.status === 'enabled' ? 'text-lime' : 'text-secondary'} aria-hidden>
            {presentation.icon}
          </span>
          {presentation.label}
        </summary>
        <p className="max-w-sm pb-2 text-xs leading-5 text-secondary">{state.reason}</p>
      </details>
    </aside>
  );
}
