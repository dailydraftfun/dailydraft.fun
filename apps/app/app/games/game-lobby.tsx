'use client';

import {
  ArrowRightIcon,
  CardsThreeIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  CrosshairIcon,
  CubeIcon,
  LightningIcon,
  LockKeyIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SparkleIcon,
  SwordIcon,
  TrophyIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { type GameMode, gameModes } from './game-catalog';

const gameIcons: Record<GameMode['id'], ReactNode> = {
  crash: <ChartLineUpIcon size={27} weight="bold" />,
  duels: <SwordIcon size={27} weight="fill" />,
  flip: <CardsThreeIcon size={27} weight="fill" />,
  tournaments: <TrophyIcon size={27} weight="fill" />,
};

export function GameLobby() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-7rem)] max-w-[1400px] flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="grid gap-6 border-b border-border pb-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
        <div className="max-w-4xl">
          <p className="proof-label flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-lime" aria-hidden="true" />
            Verified sports card games
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.055em] text-primary sm:text-6xl">
            Four sports loops.
            <span className="block text-lime">One honest arena.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-secondary">
            Duel other collectors, rip a real Collector Crypt sports pack, field a fantasy squad, or
            build a streak. Every mode commits its rules before play and keeps a durable receipt
            after it.
          </p>
        </div>

        <aside className="rounded-xl border border-lime/20 bg-lime/5 p-5" aria-label="Game status">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-lime/15 text-lime">
              <ShieldCheckIcon size={22} weight="fill" />
            </span>
            <div>
              <p className="proof-label">Current environment</p>
              <p className="mt-1 text-sm font-semibold text-primary">Devnet · test assets only</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-secondary">
            A mode becomes playable only when its provider, treasury, custody, and settlement checks
            pass.
          </p>
        </aside>
      </header>

      <section aria-labelledby="game-modes-title">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="proof-label">Choose your loop</p>
            <h2 id="game-modes-title" className="mt-2 text-2xl font-semibold text-primary">
              Card games
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-secondary">
            Playable actions are live. Preview and gated modes stay visible without pretending they
            can move funds or cards.
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {gameModes.map((game) => (
            <GameModeCard game={game} key={game.id} />
          ))}
        </div>
      </section>

      <section
        className="grid overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3"
        aria-labelledby="trust-title"
      >
        <h2 id="trust-title" className="sr-only">
          Shared game contract
        </h2>
        <TrustCard
          icon={<LockKeyIcon size={22} weight="fill" />}
          label="Commit first"
          copy="Rules, inventory, and relevant values are versioned before the outcome."
        />
        <TrustCard
          icon={<SparkleIcon size={22} weight="fill" />}
          label="Reveal the card"
          copy="The game distinguishes a selected outcome from purchased or transferred ownership."
        />
        <TrustCard
          icon={<ReceiptIcon size={22} weight="fill" />}
          label="Keep the proof"
          copy="Decisions, transactions, recovery events, and finality remain inspectable."
        />
      </section>

      <section
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
        aria-labelledby="roadmap-title"
      >
        <div className="proof-panel">
          <p className="proof-label">Build sequence</p>
          <h2 id="roadmap-title" className="mt-2 text-2xl font-semibold text-primary">
            Grow from the loop that already works
          </h2>
          <ol className="mt-6 grid gap-3">
            <RoadmapItem
              icon={<CheckCircleIcon size={20} weight="fill" />}
              label="Card Duels"
              status="Playable devnet foundation"
              tone="live"
            />
            <RoadmapItem
              icon={<CubeIcon size={20} weight="fill" />}
              label="Sports Pack Gacha"
              status="Wire Collector Crypt inventory and on-chain acquisition"
            />
            <RoadmapItem
              icon={<TrophyIcon size={20} weight="fill" />}
              label="Fantasy Tournaments"
              status="Build the match-data oracle, kickoff snapshot, and payout math"
            />
            <RoadmapItem
              icon={<CrosshairIcon size={20} weight="fill" />}
              label="Card Streak"
              status="Lock the card-stage rules and custody contract"
            />
          </ol>
        </div>

        <aside className="proof-panel flex flex-col justify-between">
          <div>
            <p className="proof-label">Start now</p>
            <h2 className="mt-2 text-xl font-semibold text-primary">The arena is ready.</h2>
            <p className="mt-3 text-sm leading-6 text-secondary">
              Challenge a wallet, enter matchmaking, or use an enabled house tier.
            </p>
          </div>
          <Link className="proof-primary-action mt-6 w-full gap-2" href="/overview">
            Play Card Duels
            <ArrowRightIcon size={16} weight="bold" />
          </Link>
        </aside>
      </section>
    </main>
  );
}

function GameModeCard({ game }: { game: GameMode }) {
  const href = game.availability === 'playable' ? game.href : null;
  const playable = href !== null;
  const statusLabel =
    game.availability === 'playable'
      ? 'Playable'
      : game.availability === 'preview'
        ? 'In development'
        : 'Decision gate';

  return (
    <article
      className={[
        'flex min-h-[29rem] flex-col rounded-xl border p-5 sm:p-6',
        playable
          ? 'border-lime/35 bg-[radial-gradient(circle_at_top_right,rgba(184,255,90,0.11),transparent_16rem)] bg-elevated'
          : 'border-border bg-secondary',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <span
          className={[
            'grid size-12 place-items-center rounded-lg',
            playable ? 'bg-lime text-accent-foreground' : 'bg-elevated text-secondary',
          ].join(' ')}
          aria-hidden="true"
        >
          {gameIcons[game.id]}
        </span>
        <span
          className={[
            'rounded-sm border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]',
            playable
              ? 'border-lime/30 bg-lime/10 text-lime'
              : 'border-border-strong bg-tertiary text-secondary',
          ].join(' ')}
        >
          {statusLabel}
        </span>
      </div>

      <p className="proof-label mt-7">{game.eyebrow}</p>
      <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-primary">{game.name}</h3>
      <p className="mt-3 text-sm leading-6 text-secondary">{game.description}</p>

      <div className="mt-6 border-y border-border py-4">
        <p className="proof-label">Player loop</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-primary">{game.playerLoop}</p>
      </div>

      <div className="mt-4 flex gap-3">
        <ShieldCheckIcon className="mt-0.5 shrink-0 text-secondary" size={17} />
        <p className="text-xs leading-5 text-secondary">{game.trustContract}</p>
      </div>

      <div className="mt-auto pt-7">
        {playable ? (
          <Link className="proof-primary-action w-full gap-2" href={href}>
            <LightningIcon size={16} weight="fill" />
            {game.actionLabel}
          </Link>
        ) : (
          <div
            className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-tertiary px-4 py-2 text-center text-xs font-semibold text-secondary"
            role="status"
          >
            <LockKeyIcon size={15} />
            {game.actionLabel}
          </div>
        )}
      </div>
    </article>
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

function RoadmapItem({
  icon,
  label,
  status,
  tone = 'pending',
}: {
  icon: ReactNode;
  label: string;
  status: string;
  tone?: 'live' | 'pending';
}) {
  return (
    <li className="flex items-center gap-4 rounded-lg border border-border bg-primary p-4">
      <span
        className={tone === 'live' ? 'shrink-0 text-lime' : 'shrink-0 text-secondary'}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-primary">{label}</p>
        <p className="mt-1 text-xs leading-5 text-secondary">{status}</p>
      </div>
    </li>
  );
}
