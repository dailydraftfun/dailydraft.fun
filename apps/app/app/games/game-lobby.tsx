'use client';

import {
  ArrowRightIcon,
  CardsThreeIcon,
  ChartLineUpIcon,
  ClockCounterClockwiseIcon,
  LightningIcon,
  LockKeyIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SwordIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import {
  fallbackGameCatalog,
  type GameCatalog,
  type GameCatalogFreshness,
  type GameCatalogMode,
  gateRuntimeActions,
  roadmapGameModes,
} from './game-catalog';
import { getGameCatalog, readCachedGameCatalog, writeCachedGameCatalog } from './games-client';
import { VerifiedActivity } from './verified-activity';

const gameIcons: Record<GameCatalogMode['id'], ReactNode> = {
  crash: <ChartLineUpIcon size={25} weight="bold" />,
  duel: <SwordIcon size={25} weight="fill" />,
  flip: <CardsThreeIcon size={25} weight="fill" />,
  gacha: <CardsThreeIcon size={25} weight="duotone" />,
};

type CatalogLoader = () => Promise<GameCatalog>;

export function GameLobby({
  initialCatalog,
  loadCatalog = getGameCatalog,
}: {
  initialCatalog?: GameCatalog;
  loadCatalog?: CatalogLoader;
}) {
  const [catalogState, setCatalogState] = useState<{
    catalog: GameCatalog;
    freshness: GameCatalogFreshness;
  }>(() => ({
    catalog: initialCatalog ?? fallbackGameCatalog(),
    freshness: initialCatalog ? 'live' : 'loading',
  }));

  useEffect(() => {
    let active = true;
    let fallback = initialCatalog ?? null;

    if (!fallback) {
      const cached = readCachedGameCatalog(window.sessionStorage);
      if (cached) {
        fallback = cached;
        setCatalogState({ catalog: cached, freshness: 'loading' });
      }
    }

    loadCatalog()
      .then((catalog) => {
        if (!active) return;
        writeCachedGameCatalog(catalog, window.sessionStorage);
        setCatalogState({ catalog, freshness: 'live' });
      })
      .catch(() => {
        if (!active) return;
        setCatalogState(
          fallback
            ? { catalog: fallback, freshness: 'stale' }
            : {
                catalog: fallbackGameCatalog(
                  'Live capability checks are unavailable. No value-bearing action is exposed.',
                ),
                freshness: 'error',
              },
        );
      });

    return () => {
      active = false;
    };
  }, [initialCatalog, loadCatalog]);

  const { catalog, freshness } = catalogState;
  const visibleCatalog = gateRuntimeActions(catalog, freshness);
  const actionableModes = visibleCatalog.modes.filter(
    (mode) => mode.capabilitySource.kind === 'runtime' && mode.availableActions.length > 0,
  );
  const primaryMode =
    actionableModes.find((mode) => mode.state === 'playable') ?? actionableModes[0] ?? null;
  const roadmap = roadmapGameModes(visibleCatalog).filter((mode) => mode.id !== primaryMode?.id);

  return (
    <main className="mx-auto flex min-h-[calc(100svh-7rem)] max-w-[1400px] flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
      <header className="grid gap-6 border-b border-border pb-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div className="max-w-4xl">
          <p className="proof-label flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-lime" aria-hidden="true" />
            DailyDraft game network
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.055em] text-primary sm:text-6xl">
            One arena.
            <span className="block text-lime">Every game tells the truth.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-secondary">
            Runtime checks decide what can be played. Fixture-only modes stay clearly labeled and
            never inherit a value-bearing action.
          </p>
        </div>

        <CatalogStatus catalog={catalog} freshness={freshness} />
      </header>

      <section
        className="overflow-hidden rounded-xl border border-lime/25 bg-[radial-gradient(circle_at_78%_20%,rgba(184,255,90,0.14),transparent_22rem)] bg-elevated"
        aria-labelledby="playable-now-title"
      >
        <div className="grid min-h-[24rem] lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="flex flex-col justify-between p-6 sm:p-8 lg:p-10">
            <div>
              <p className="proof-label flex items-center gap-2 text-lime">
                <LightningIcon size={15} weight="fill" />
                Playable now
              </p>
              {primaryMode ? (
                <>
                  <h2
                    id="playable-now-title"
                    className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-primary sm:text-5xl"
                  >
                    {primaryMode.name}
                  </h2>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-secondary">
                    {primaryMode.description}
                  </p>
                  <p className="mt-5 flex max-w-2xl items-start gap-2 text-sm leading-6 text-primary">
                    <ShieldCheckIcon
                      className="mt-0.5 shrink-0 text-lime"
                      size={18}
                      weight="fill"
                    />
                    {primaryMode.reason}
                  </p>
                </>
              ) : (
                <>
                  <h2
                    id="playable-now-title"
                    className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-primary sm:text-5xl"
                  >
                    No unverified play.
                  </h2>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-secondary">
                    The arena is waiting for a current server capability response. Preview routes
                    remain available below, but they cannot move funds or cards.
                  </p>
                </>
              )}
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              {primaryMode?.availableActions.map((action, index) => (
                <Link
                  className={
                    index === 0 ? 'proof-primary-action gap-2' : 'proof-secondary-action gap-2'
                  }
                  href={action.href}
                  key={action.id}
                >
                  {action.label}
                  <ArrowRightIcon size={16} weight="bold" />
                </Link>
              ))}
              {!primaryMode ? (
                <span
                  className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-tertiary px-4 py-2 text-sm font-semibold text-secondary"
                  role="status"
                >
                  <LockKeyIcon size={16} />
                  Live actions withheld
                </span>
              ) : null}
            </div>
          </div>

          <aside className="border-t border-border bg-primary/45 p-6 sm:p-8 lg:border-t-0 lg:border-l">
            <p className="proof-label">Arena lanes</p>
            <div className="mt-5 grid gap-3">
              {visibleCatalog.modes
                .filter((mode) => mode.capabilitySource.kind === 'runtime')
                .map((mode) => (
                  <RuntimeLane mode={mode} key={mode.id} />
                ))}
            </div>
            <div className="mt-6 border-t border-border pt-5">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-secondary">
                <ReceiptIcon size={15} />
                Capability source
              </p>
              <p className="mt-2 text-xs leading-5 text-secondary">
                Server observed {formatAsOf(catalog.asOf)} · Solana devnet test assets only.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section aria-labelledby="roadmap-title">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="proof-label">Honest roadmap</p>
            <h2 id="roadmap-title" className="mt-2 text-2xl font-semibold text-primary">
              Preview what is gated
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-secondary">
            Preview means fixture-only. Unavailable means the live dependency check did not pass.
          </p>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {roadmap.map((mode) => (
            <RoadmapMode mode={mode} key={mode.id} />
          ))}
        </div>
      </section>

      <VerifiedActivity compact />

      <section
        className="grid overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3"
        aria-labelledby="trust-title"
      >
        <h2 id="trust-title" className="sr-only">
          Shared game contract
        </h2>
        <TrustCard
          icon={<LockKeyIcon size={22} weight="fill" />}
          label="Server decides"
          copy="The browser cannot promote a game from preview to playable."
        />
        <TrustCard
          icon={<ShieldCheckIcon size={22} weight="fill" />}
          label="Routes stay canonical"
          copy="Duel, Gacha, Marketplace Flip, and Card Streak have one stable identity each."
        />
        <TrustCard
          icon={<ReceiptIcon size={22} weight="fill" />}
          label="No fake activity"
          copy="The lobby publishes capability evidence, not invented players, pots, or live counts."
        />
      </section>
    </main>
  );
}

function CatalogStatus({
  catalog,
  freshness,
}: {
  catalog: GameCatalog;
  freshness: GameCatalogFreshness;
}) {
  const state = {
    error: {
      copy: 'Server catalog unavailable · live actions withheld',
      icon: <WarningCircleIcon size={21} weight="fill" />,
      label: 'Unavailable',
    },
    live: {
      copy: `Verified ${formatAsOf(catalog.asOf)}`,
      icon: <ShieldCheckIcon size={21} weight="fill" />,
      label: 'Live capability',
    },
    loading: {
      copy: 'Checking the server-owned game catalog',
      icon: <ClockCounterClockwiseIcon size={21} />,
      label: 'Refreshing',
    },
    stale: {
      copy: `Last verified ${formatAsOf(catalog.asOf)} · refresh failed`,
      icon: <ClockCounterClockwiseIcon size={21} />,
      label: 'Stale capability',
    },
  }[freshness];

  return (
    <aside
      className="rounded-xl border border-lime/20 bg-lime/5 p-5"
      aria-label="Game catalog status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-lime/15 text-lime">
          {state.icon}
        </span>
        <div>
          <p className="proof-label">{state.label}</p>
          <p className="mt-1 text-sm font-semibold text-primary">{state.copy}</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-secondary">
        Devnet · test assets only. Failed or stale checks never create a playable action.
      </p>
    </aside>
  );
}

function RuntimeLane({ mode }: { mode: GameCatalogMode }) {
  const actionable = mode.availableActions.length > 0;
  const firstAction = mode.availableActions[0];
  return (
    <div className="rounded-lg border border-border bg-secondary p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={actionable ? 'text-lime' : 'text-secondary'} aria-hidden="true">
          {gameIcons[mode.id]}
        </span>
        <StateBadge mode={mode} />
      </div>
      <p className="mt-4 text-base font-semibold text-primary">{mode.name}</p>
      <p className="mt-2 text-xs leading-5 text-secondary">{mode.reason}</p>
      {firstAction ? (
        <Link
          className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-lime"
          href={firstAction.href}
        >
          {firstAction.label}
          <ArrowRightIcon size={13} weight="bold" />
        </Link>
      ) : null}
    </div>
  );
}

function RoadmapMode({ mode }: { mode: GameCatalogMode }) {
  const previewAction = mode.availableActions.find((action) => action.id === 'view-preview');
  return (
    <article className="flex gap-4 rounded-xl border border-border bg-secondary p-5">
      <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-elevated text-secondary">
        {gameIcons[mode.id]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-primary">{mode.name}</h3>
          <StateBadge mode={mode} />
        </div>
        <p className="mt-2 text-sm leading-6 text-secondary">{mode.description}</p>
        <p className="mt-3 text-xs leading-5 text-secondary">{mode.reason}</p>
        {previewAction ? (
          <Link
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-lime"
            href={previewAction.href}
          >
            {previewAction.label}
            <ArrowRightIcon size={14} weight="bold" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function StateBadge({ mode }: { mode: GameCatalogMode }) {
  const { state } = mode;
  const label = {
    degraded: 'Degraded',
    playable: 'Playable',
    preview: mode.capabilitySource.kind === 'fixture' ? 'Fixture preview' : 'Capability gated',
    unavailable: 'Unavailable',
  }[state];
  return (
    <span
      className={[
        'rounded-sm border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]',
        state === 'playable'
          ? 'border-lime/30 bg-lime/10 text-lime'
          : 'border-border-strong bg-tertiary text-secondary',
      ].join(' ')}
    >
      {label}
    </span>
  );
}

function TrustCard({ copy, icon, label }: { copy: string; icon: ReactNode; label: string }) {
  return (
    <article className="bg-secondary p-5 sm:p-6">
      <span className="text-lime" aria-hidden="true">
        {icon}
      </span>
      <h3 className="mt-4 text-base font-semibold text-primary">{label}</h3>
      <p className="mt-2 text-sm leading-6 text-secondary">{copy}</p>
    </article>
  );
}

function formatAsOf(asOf: string): string {
  if (asOf === new Date(0).toISOString()) return 'not yet';
  const date = new Date(asOf);
  if (Number.isNaN(date.getTime())) return 'unknown';
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
