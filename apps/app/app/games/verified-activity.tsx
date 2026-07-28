'use client';

import type { VerifiedGameActivity, VerifiedGameActivityPage } from '@dailydraft/contracts';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ActivityApiUnavailableError,
  getVerifiedGameActivity,
  readCachedVerifiedGameActivity,
  resolveActivityApiHref,
  writeCachedVerifiedGameActivity,
} from './activity-client';

type ActivityHealth = 'degraded' | 'empty' | 'loading' | 'ready' | 'stale' | 'unavailable';
type ActivityLoader = () => Promise<VerifiedGameActivityPage>;

// Browser lifecycle is covered by the deterministic Playwright journey; Bun's
// server renderer cannot execute effects or sessionStorage.
/* istanbul ignore next */
const loadCompactActivity = () => getVerifiedGameActivity(4);
/* istanbul ignore next */
const loadFullActivity = () => getVerifiedGameActivity(20);

export function VerifiedActivity({
  compact = false,
  initialPage,
  initialState,
  loadActivity,
}: {
  compact?: boolean;
  initialPage?: VerifiedGameActivityPage;
  initialState?: ActivityHealth;
  loadActivity?: ActivityLoader;
}) {
  const activityLoader = loadActivity ?? (compact ? loadCompactActivity : loadFullActivity);
  const [activityState, setActivityState] = useState<{
    health: ActivityHealth;
    page: VerifiedGameActivityPage | null;
  }>(() => ({
    health: initialState ?? healthForPage(initialPage),
    page: initialPage ?? null,
  }));

  /* istanbul ignore next */
  useEffect(() => {
    if (initialState && initialState !== 'loading') return;
    let active = true;
    const cached = readCachedVerifiedGameActivity(window.sessionStorage);
    if (cached && !initialPage) {
      setActivityState({ health: 'loading', page: cached });
    }

    activityLoader()
      .then((page) => {
        if (!active) return;
        writeCachedVerifiedGameActivity(page, window.sessionStorage);
        setActivityState({ health: healthForPage(page), page });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (cached) {
          setActivityState({ health: 'stale', page: cached });
          return;
        }
        setActivityState({
          health: error instanceof ActivityApiUnavailableError ? 'unavailable' : 'degraded',
          page: null,
        });
      });

    return () => {
      active = false;
    };
  }, [activityLoader, initialPage, initialState]);

  const { health, page } = activityState;
  const visibleActivity = page?.data.slice(0, compact ? 3 : 20) ?? [];

  return (
    <section
      aria-labelledby={compact ? 'games-activity-title' : 'activity-title'}
      className={compact ? 'border-t border-border pt-7' : undefined}
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="proof-label flex items-center gap-2">
            <ShieldCheckIcon size={15} weight="fill" />
            Settled proof only
          </p>
          <h2
            className="mt-2 text-2xl font-semibold text-primary"
            id={compact ? 'games-activity-title' : 'activity-title'}
          >
            Verified recent activity
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">
            Completed results are separate from current play availability. Every row resolves to a
            canonical public receipt; unsettled rounds never appear here.
          </p>
        </div>
        <ActivityStatus health={health} page={page} />
      </div>

      {visibleActivity.length > 0 ? (
        <ol className="mt-5 grid gap-3">
          {visibleActivity.map((activity) => (
            <ActivityRow activity={activity} key={activity.activityId} />
          ))}
        </ol>
      ) : (
        <ActivityEmptyState health={health} />
      )}

      {compact ? (
        <Link
          className="mt-5 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:text-lime"
          href="/games/activity"
        >
          Inspect verified activity
          <ArrowRightIcon size={15} weight="bold" />
        </Link>
      ) : null}
    </section>
  );
}

function ActivityRow({ activity }: { activity: VerifiedGameActivity }) {
  return (
    <li className="grid gap-4 rounded-xl border border-border bg-secondary p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <span
        className="grid size-11 place-items-center rounded-lg bg-lime/10 text-lime"
        aria-hidden="true"
      >
        <CheckCircleIcon size={22} weight="fill" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="proof-label">{modeLabel(activity.mode)}</span>
          <span className="rounded-full border border-lime/20 bg-lime/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime">
            {resultLabel(activity)}
          </span>
          <time className="text-xs text-muted" dateTime={activity.occurredAt}>
            {formatOccurredAt(activity.occurredAt)}
          </time>
        </div>
        <h3 className="mt-2 text-base font-semibold text-primary">{activity.title}</h3>
        <p className="mt-1 text-sm leading-6 text-secondary">{activity.resultSummary}</p>
        <p className="mt-2 font-mono text-xs text-muted">
          {activity.participants.map((participant) => participant.label).join(' · ')}
        </p>
      </div>
      <div className="sm:min-w-40 sm:text-right">
        <p className="text-sm font-semibold text-primary">{formatTier(activity.tier.amount)}</p>
        <a
          className="proof-secondary-action mt-3 gap-2"
          href={resolveActivityApiHref(activity.receiptHref)}
          rel="noreferrer"
        >
          <ReceiptIcon size={15} />
          View verified receipt
        </a>
      </div>
    </li>
  );
}

function ActivityStatus({
  health,
  page,
}: {
  health: ActivityHealth;
  page: VerifiedGameActivityPage | null;
}) {
  const status = {
    degraded: {
      icon: <WarningCircleIcon size={16} weight="fill" />,
      label: 'Proof service degraded',
      tone: 'text-warning',
    },
    empty: {
      icon: <ReceiptIcon size={16} />,
      label: 'No verified outcomes yet',
      tone: 'text-secondary',
    },
    loading: {
      icon: <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" size={16} />,
      label: 'Checking durable outcomes',
      tone: 'text-secondary',
    },
    ready: {
      icon: <ShieldCheckIcon size={16} weight="fill" />,
      label: page ? `Verified ${formatAsOf(page.asOf)}` : 'Verified',
      tone: 'text-lime',
    },
    stale: {
      icon: <ClockCounterClockwiseIcon size={16} />,
      label: page ? `Cached ${formatAsOf(page.asOf)}` : 'Cached result',
      tone: 'text-warning',
    },
    unavailable: {
      icon: <WarningCircleIcon size={16} weight="fill" />,
      label: 'Proof service unavailable',
      tone: 'text-secondary',
    },
  } as const;
  const current = status[health];
  return (
    <p
      aria-live="polite"
      className={`flex min-h-10 w-fit items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-semibold ${current.tone}`}
      role="status"
    >
      {current.icon}
      {current.label}
    </p>
  );
}

function ActivityEmptyState({ health }: { health: ActivityHealth }) {
  const copy = {
    degraded:
      'Recent proof could not be refreshed. Game discovery remains available without inferred participation.',
    empty:
      'No settled proof is available yet. DailyDraft does not invent players, wins, or volume.',
    loading:
      'Refreshing the verified projection. No activity is shown until its receipt validates.',
    ready:
      'No settled proof is available yet. DailyDraft does not invent players, wins, or volume.',
    stale: 'The last verified snapshot is empty and could not be refreshed.',
    unavailable:
      'The public proof service is not configured. No activity or participation is inferred.',
  } as const;
  return (
    <div className="mt-5 rounded-xl border border-border bg-secondary p-5" role="status">
      <p className="text-sm font-semibold text-primary">No verified activity shown</p>
      <p className="mt-2 text-sm leading-6 text-secondary">{copy[health]}</p>
    </div>
  );
}

function healthForPage(page: VerifiedGameActivityPage | undefined): ActivityHealth {
  if (!page) return 'loading';
  return page.data.length > 0 ? 'ready' : 'empty';
}

function resultLabel(activity: VerifiedGameActivity): string {
  return activity.result === 'winner-verified' ? 'Verified win' : 'Completed';
}

function modeLabel(mode: VerifiedGameActivity['mode']): string {
  return {
    crash: 'Card Streak',
    duel: 'Duel',
    flip: 'Marketplace Flip',
  }[mode];
}

function formatTier(amount: string): string {
  const minor = BigInt(amount);
  const whole = minor / 1_000_000n;
  const fraction = (minor % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  const major = `${new Intl.NumberFormat('en-US').format(whole)}${fraction ? `.${fraction}` : ''}`;
  return `${major} USDC tier`;
}

function formatOccurredAt(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

function formatAsOf(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value));
}
