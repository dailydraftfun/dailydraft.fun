'use client';

import {
  ArrowRightIcon,
  CheckCircleIcon,
  FlaskIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { type ActivityItem, activityForProof } from './game-preview-data';

export function ActivityPreview({
  initialHealth = 'ready',
  initialProof = 'receipt',
}: {
  initialHealth?: 'degraded' | 'empty' | 'loading' | 'ready';
  initialProof?: 'all' | ActivityItem['proof'];
}) {
  const [health, setHealth] = useState(initialHealth);
  const [proof, setProof] = useState<'all' | ActivityItem['proof']>(initialProof);
  const activity = activityForProof(proof);

  return (
    <main className="mx-auto flex min-h-[calc(100svh-7rem)] max-w-6xl flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
      <header className="grid gap-5 border-b border-border pb-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div>
          <p className="proof-label">Activity lab · fixture-safe</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-primary sm:text-5xl">
            Proof makes the lobby feel alive.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-secondary">
            Receipt examples demonstrate how durable outcomes will read. Fixture rows show the
            planned Flip and Crash presentation without claiming live participation, purchase,
            transfer, or payout.
          </p>
        </div>
        <div className="rounded-xl border border-lime/20 bg-lime/5 p-5">
          <div className="flex items-center gap-3 text-lime">
            <ShieldCheckIcon size={22} weight="fill" />
            <strong className="text-sm">No fabricated live counts</strong>
          </div>
          <p className="mt-3 text-xs leading-5 text-secondary">
            Every real row must resolve to a public result or receipt. Empty and degraded states
            stay honest.
          </p>
        </div>
      </header>

      <section aria-labelledby="state-title" className="proof-panel">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="proof-label">Resilience states</p>
            <h2 id="state-title" className="mt-2 text-xl font-semibold text-primary">
              Capability state simulator
            </h2>
          </div>
          <div className="flex w-fit flex-wrap rounded-lg border border-border bg-secondary p-1">
            {(['ready', 'loading', 'degraded', 'empty'] as const).map((state) => (
              <FilterButton active={health === state} key={state} onClick={() => setHealth(state)}>
                {state}
              </FilterButton>
            ))}
          </div>
        </div>
        <CapabilityState health={health} />
      </section>

      <section aria-labelledby="activity-title">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="proof-label">Recent outcomes</p>
            <h2 id="activity-title" className="mt-2 text-2xl font-semibold text-primary">
              Lobby activity
            </h2>
          </div>
          <div className="inline-flex w-fit rounded-lg border border-border bg-secondary p-1">
            <FilterButton active={proof === 'receipt'} onClick={() => setProof('receipt')}>
              Receipt examples
            </FilterButton>
            <FilterButton active={proof === 'all'} onClick={() => setProof('all')}>
              Include fixtures
            </FilterButton>
          </div>
        </div>

        <ol className="mt-5 grid gap-3">
          {activity.map((item) => (
            <li
              className="grid gap-4 rounded-xl border border-border bg-secondary p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
              key={item.id}
            >
              <span
                className={[
                  'grid size-11 place-items-center rounded-lg',
                  item.proof === 'receipt' ? 'bg-lime/10 text-lime' : 'bg-violet/10 text-violet',
                ].join(' ')}
                aria-hidden="true"
              >
                {item.proof === 'receipt' ? (
                  <CheckCircleIcon size={22} weight="fill" />
                ) : (
                  <FlaskIcon size={22} weight="fill" />
                )}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="proof-label">{item.badge}</span>
                  <span className="text-xs text-muted">{item.time}</span>
                </div>
                <h3 className="mt-2 text-base font-semibold text-primary">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-secondary">{item.detail}</p>
                <p className="mt-2 font-mono text-xs text-muted">{item.player}</p>
              </div>
              <div className="sm:min-w-40 sm:text-right">
                <p className="text-sm font-semibold text-primary">{item.amount}</p>
                <Link className="proof-secondary-action mt-3 gap-2" href={item.href}>
                  <ReceiptIcon size={15} />
                  {item.proof === 'receipt' ? 'Open leaderboard model' : 'Open preview'}
                </Link>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link className="proof-primary-action gap-2" href="/games">
          Back to games
          <ArrowRightIcon size={15} />
        </Link>
        <Link className="proof-secondary-action" href="/games/house">
          Preview instant House
        </Link>
      </div>
    </main>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={[
        'rounded-md px-3 py-2 text-xs font-semibold transition-colors',
        active ? 'bg-elevated text-primary' : 'text-secondary hover:text-primary',
      ].join(' ')}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function CapabilityState({ health }: { health: 'degraded' | 'empty' | 'loading' | 'ready' }) {
  const states = {
    ready: {
      copy: 'Receipt examples and game capability fixtures are available.',
      icon: <ShieldCheckIcon size={20} weight="fill" />,
      label: 'All preview systems ready',
      tone: 'border-lime/20 bg-lime/5 text-lime',
    },
    loading: {
      copy: 'Refreshing durable outcomes without showing stale counts as live.',
      icon: <SpinnerGapIcon className="animate-spin" size={20} />,
      label: 'Checking activity projection',
      tone: 'border-border bg-tertiary text-secondary',
    },
    degraded: {
      copy: 'Recent proof is temporarily unavailable. Game discovery remains accessible.',
      icon: <WarningCircleIcon size={20} weight="fill" />,
      label: 'Activity service degraded',
      tone: 'border-warning/25 bg-warning/5 text-warning',
    },
    empty: {
      copy: 'No verified outcomes yet. The lobby does not invent participation or volume.',
      icon: <ReceiptIcon size={20} />,
      label: 'No activity to show',
      tone: 'border-border bg-tertiary text-secondary',
    },
  } as const;
  const state = states[health];

  return (
    <div
      className={`mt-5 flex items-start gap-3 rounded-xl border p-5 ${state.tone}`}
      role="status"
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {state.icon}
      </span>
      <div>
        <strong className="text-sm">{state.label}</strong>
        <p className="mt-1 text-xs leading-5 text-secondary">{state.copy}</p>
      </div>
    </div>
  );
}
