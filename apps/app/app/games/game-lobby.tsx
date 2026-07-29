'use client';

import { isPublicGameTaxonomyId } from '@dailydraft/contracts/public-game-taxonomy';
import {
  ArrowRightIcon,
  CardsThreeIcon,
  ChartLineUpIcon,
  LightningIcon,
  LockKeyIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SwordIcon,
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
import { trackGameDiscovery } from './game-discovery-analytics';
import { canonicalRulesHref, type GameRulesMode } from './game-rules';
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

  useEffect(() => {
    trackGameDiscovery({ stage: 'hub-view' });
  }, []);

  const { catalog, freshness } = catalogState;
  const visibleCatalog = gateRuntimeActions(catalog, freshness);
  const publicModes = visibleCatalog.modes.filter((mode) => isPublicGameTaxonomyId(mode.id));
  const runtimeModes = publicModes.filter(
    (mode) => mode.capabilitySource.kind === 'runtime' && mode.availableActions.length > 0,
  );
  const primaryMode =
    runtimeModes.find((mode) => mode.state === 'playable') ?? runtimeModes[0] ?? null;
  const demoModes = publicModes.filter(
    (mode) =>
      mode.capabilitySource.kind === 'fixture' &&
      mode.state === 'playable' &&
      mode.availableActions.length > 0,
  );
  const roadmap = roadmapGameModes({ ...visibleCatalog, modes: publicModes }).filter(
    (mode) => mode.id !== primaryMode?.id,
  );

  return (
    <main className="mx-auto flex min-h-[calc(100svh-7rem)] max-w-[1400px] flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
      <header className="border-b border-border pb-7">
        <div className="max-w-4xl">
          <p className="proof-label flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-lime" aria-hidden="true" />
            DailyDraft Arena
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.055em] text-primary sm:text-6xl">
            Pick a game.
            <span className="block text-lime">Make your move.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-secondary">
            Challenge a rival, rip a pack, or jump into a free instant game.
          </p>
        </div>
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
                    The arena is waiting for a current server capability response. Value-bearing
                    play is withheld, but free games remain playable below without funds or cards.
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
                  onClick={() =>
                    trackGameDiscovery({
                      actionId: action.id,
                      mode: primaryMode.id,
                      stage: 'play-or-preview',
                    })
                  }
                >
                  {action.label}
                  <ArrowRightIcon size={16} weight="bold" />
                </Link>
              ))}
              {primaryMode && hasCanonicalRules(primaryMode.id) ? (
                <Link
                  className="proof-secondary-action gap-2"
                  href={canonicalRulesHref(primaryMode.id)}
                  onClick={() =>
                    trackGameDiscovery({
                      actionId: 'read-rules',
                      mode: primaryMode.id,
                      stage: 'mode-detail',
                    })
                  }
                >
                  Read rules first
                  <ReceiptIcon size={16} />
                </Link>
              ) : null}
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
              {publicModes
                .filter((mode) => mode.capabilitySource.kind === 'runtime')
                .map((mode) => (
                  <RuntimeLane mode={mode} key={mode.id} />
                ))}
            </div>
          </aside>
        </div>
      </section>

      {demoModes.length > 0 ? (
        <section aria-labelledby="demo-games-title">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="proof-label flex items-center gap-2 text-lime">
                <LightningIcon size={15} weight="fill" />
                Instant play
              </p>
              <h2 id="demo-games-title" className="mt-2 text-2xl font-semibold text-primary">
                Play without opening your wallet
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-secondary">
              Full game loops on devnet fixtures. No funds, cards, provider purchases, custody, or
              payouts.
            </p>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {demoModes.map((mode) => (
              <GameModeCard mode={mode} key={mode.id} />
            ))}
          </div>
        </section>
      ) : null}

      {roadmap.length > 0 ? (
        <section aria-labelledby="roadmap-title">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="proof-label">Honest availability</p>
              <h2 id="roadmap-title" className="mt-2 text-2xl font-semibold text-primary">
                See what is gated
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-secondary">
              Preview means a runtime action is gated. Unavailable means its dependency check
              failed.
            </p>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {roadmap.map((mode) => (
              <GameModeCard mode={mode} key={mode.id} />
            ))}
          </div>
        </section>
      ) : null}

      <VerifiedActivity compact />
    </main>
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
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <Link
            className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-lime"
            href={firstAction.href}
            onClick={() =>
              trackGameDiscovery({
                actionId: firstAction.id,
                mode: mode.id,
                stage: 'play-or-preview',
              })
            }
          >
            {firstAction.label}
            <ArrowRightIcon size={13} weight="bold" />
          </Link>
          {hasCanonicalRules(mode.id) ? (
            <Link
              className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-primary"
              href={canonicalRulesHref(mode.id)}
              onClick={() =>
                trackGameDiscovery({
                  actionId: 'read-rules',
                  mode: mode.id,
                  stage: 'mode-detail',
                })
              }
            >
              Read rules
            </Link>
          ) : null}
        </div>
      ) : null}
      {!firstAction && hasCanonicalRules(mode.id) ? (
        <Link
          className="mt-3 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-primary"
          href={canonicalRulesHref(mode.id)}
          onClick={() =>
            trackGameDiscovery({
              actionId: 'read-rules',
              mode: mode.id,
              stage: 'mode-detail',
            })
          }
        >
          Read rules
        </Link>
      ) : null}
    </div>
  );
}

function GameModeCard({ mode }: { mode: GameCatalogMode }) {
  const primaryAction = mode.availableActions[0];
  const playableDemo = mode.capabilitySource.kind === 'fixture' && mode.state === 'playable';
  return (
    <article
      className={[
        'flex gap-4 rounded-xl border bg-secondary p-5',
        playableDemo ? 'border-lime/25' : 'border-border',
      ].join(' ')}
    >
      <span
        className={[
          'grid size-11 shrink-0 place-items-center rounded-lg bg-elevated',
          playableDemo ? 'text-lime' : 'text-secondary',
        ].join(' ')}
      >
        {gameIcons[mode.id]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-primary">{mode.name}</h3>
          <StateBadge mode={mode} />
        </div>
        <p className="mt-2 text-sm leading-6 text-secondary">{mode.description}</p>
        <p className="mt-3 text-xs leading-5 text-secondary">{mode.reason}</p>
        {primaryAction ? (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            <Link
              className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-lime"
              href={primaryAction.href}
              onClick={() =>
                trackGameDiscovery({
                  actionId: primaryAction.id,
                  mode: mode.id,
                  stage: 'play-or-preview',
                })
              }
            >
              {primaryAction.label}
              <ArrowRightIcon size={14} weight="bold" />
            </Link>
            {hasCanonicalRules(mode.id) ? (
              <Link
                className="inline-flex min-h-10 items-center text-sm font-semibold text-primary"
                href={canonicalRulesHref(mode.id)}
                onClick={() =>
                  trackGameDiscovery({
                    actionId: 'read-rules',
                    mode: mode.id,
                    stage: 'mode-detail',
                  })
                }
              >
                Rules
              </Link>
            ) : null}
          </div>
        ) : hasCanonicalRules(mode.id) ? (
          <Link
            className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-lime"
            href={canonicalRulesHref(mode.id)}
            onClick={() =>
              trackGameDiscovery({
                actionId: 'read-rules',
                mode: mode.id,
                stage: 'mode-detail',
              })
            }
          >
            Read rules
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
    playable: mode.capabilitySource.kind === 'fixture' ? 'Playable demo' : 'Playable',
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

function hasCanonicalRules(mode: GameCatalogMode['id']): mode is GameRulesMode {
  return mode === 'duel' || mode === 'flip' || mode === 'crash';
}
