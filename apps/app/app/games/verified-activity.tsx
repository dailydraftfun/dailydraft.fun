'use client';

import type {
  VerifiedGameActivity,
  VerifiedGameActivityPage,
} from '@dailydraft/contracts/game-lobby';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  ReceiptIcon,
  ShareNetworkIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  UserCircleIcon,
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
import { activityShareText, buildActivityGrowthLinks } from './activity-growth';
import { trackGameDiscovery } from './game-discovery-analytics';

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
            <ShieldCheckIcon aria-hidden="true" size={15} weight="fill" />
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
          <ArrowRightIcon aria-hidden="true" size={15} weight="bold" />
        </Link>
      ) : null}
    </section>
  );
}

function ActivityRow({ activity }: { activity: VerifiedGameActivity }) {
  const links = buildActivityGrowthLinks(activity);
  const [shareStatus, setShareStatus] = useState('');

  async function shareActivity() {
    const url = new URL(links.sharePath, window.location.origin).toString();
    const shareData = { text: activityShareText(activity), title: activity.title, url };
    const nativeShare = Reflect.get(navigator, 'share');
    const canNativeShare = typeof nativeShare === 'function';
    try {
      if (canNativeShare) await nativeShare.call(navigator, shareData);
      else await navigator.clipboard.writeText(url);
      trackGameDiscovery({
        actionId: 'share-result',
        activityId: activity.activityId,
        mode: activity.mode,
        stage: 'referral-share',
      });
      setShareStatus(canNativeShare ? 'Share opened' : 'Referral link copied');
    } catch {
      setShareStatus('Share cancelled');
    }
  }

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
            <span className="sr-only">Settled </span>
            {formatOccurredAt(activity.occurredAt)}
          </time>
        </div>
        <h3 className="mt-2 text-base font-semibold text-primary">{activity.title}</h3>
        <p className="mt-1 text-sm leading-6 text-secondary">{activity.resultSummary}</p>
        <p className="mt-2 font-mono text-xs text-muted">
          {activity.participants.map((participant) => participant.label).join(' · ')}
        </p>
      </div>
      <div className="sm:min-w-52 sm:text-right">
        <p className="text-sm font-semibold text-primary">{formatTier(activity.tier.amount)}</p>
        <div className="mt-3 flex flex-wrap gap-2 sm:justify-end">
          <a
            aria-label={`View verified receipt for ${activity.title} · ${activity.activityId}`}
            className="proof-secondary-action gap-2"
            href={resolveActivityApiHref(links.receiptHref)}
            onClick={() =>
              trackGameDiscovery({
                actionId: 'view-receipt',
                activityId: activity.activityId,
                mode: activity.mode,
                stage: 'result-view',
              })
            }
            rel="noreferrer"
          >
            <ReceiptIcon aria-hidden="true" size={15} />
            View verified receipt
          </a>
          {links.resultHref ? (
            <a
              className="proof-secondary-action gap-2"
              href={resolveActivityApiHref(links.resultHref)}
              onClick={() =>
                trackGameDiscovery({
                  actionId: 'view-result',
                  activityId: activity.activityId,
                  mode: activity.mode,
                  stage: 'result-view',
                })
              }
              rel="noreferrer"
            >
              Result proof
            </a>
          ) : null}
          <Link
            className="proof-secondary-action gap-2"
            href={links.profileHref}
            onClick={() =>
              trackGameDiscovery({
                actionId: 'find-profiles',
                activityId: activity.activityId,
                mode: activity.mode,
                stage: 'profile-view',
              })
            }
          >
            <UserCircleIcon aria-hidden="true" size={15} />
            Find player profiles
          </Link>
          {links.rematchHref ? (
            <Link
              className="proof-primary-action gap-2"
              href={links.rematchHref}
              onClick={() =>
                trackGameDiscovery({
                  actionId: 'rematch',
                  activityId: activity.activityId,
                  mode: activity.mode,
                  stage: 'rematch',
                })
              }
            >
              Run a rematch
              <ArrowRightIcon aria-hidden="true" size={15} weight="bold" />
            </Link>
          ) : (
            <Link
              className="proof-primary-action gap-2"
              href={links.discoverHref}
              onClick={() =>
                trackGameDiscovery({
                  actionId: 'discover-mode',
                  activityId: activity.activityId,
                  mode: activity.mode,
                  stage: 'mode-discovery',
                })
              }
            >
              {links.discoverLabel}
              <ArrowRightIcon aria-hidden="true" size={15} weight="bold" />
            </Link>
          )}
          <button className="proof-secondary-action gap-2" onClick={shareActivity} type="button">
            <ShareNetworkIcon aria-hidden="true" size={15} />
            Share result
          </button>
        </div>
        <p aria-live="polite" className="mt-2 min-h-4 text-xs text-secondary">
          {shareStatus}
        </p>
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
      icon: <WarningCircleIcon aria-hidden="true" size={16} weight="fill" />,
      label: 'Proof service degraded',
      tone: 'text-warning',
    },
    empty: {
      icon: <ReceiptIcon aria-hidden="true" size={16} />,
      label: 'No verified outcomes yet',
      tone: 'text-secondary',
    },
    loading: {
      icon: (
        <SpinnerGapIcon
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
          size={16}
        />
      ),
      label: 'Checking durable outcomes',
      tone: 'text-secondary',
    },
    ready: {
      icon: <ShieldCheckIcon aria-hidden="true" size={16} weight="fill" />,
      label: page ? `Verified snapshot · ${formatAsOf(page.asOf)}` : 'Verified',
      tone: 'text-lime',
    },
    stale: {
      icon: <ClockCounterClockwiseIcon aria-hidden="true" size={16} />,
      label: page ? `Cached snapshot · ${formatAsOf(page.asOf)}` : 'Cached result',
      tone: 'text-warning',
    },
    unavailable: {
      icon: <WarningCircleIcon aria-hidden="true" size={16} weight="fill" />,
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
    gacha: 'Sports Pack Gacha',
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
  return formatUtcTimestamp(value);
}

function formatAsOf(value: string): string {
  return formatUtcTimestamp(value);
}

function formatUtcTimestamp(value: string): string {
  const date = new Date(value);
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} · ${hours}:${minutes} UTC`;
}
