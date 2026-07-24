'use client';

import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  BankIcon,
  CardsThreeIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  FlaskIcon,
  LockKeyIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SparkleIcon,
  SwordIcon,
  TrendUpIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import {
  type PreviewCard,
  type PreviewMode,
  previewCards,
  previewModeTitles,
} from './game-preview-data';

const modeCopy: Record<
  PreviewMode,
  { eyebrow: string; icon: ReactNode; summary: string; title: string }
> = {
  crash: {
    eyebrow: 'Card-stage retention loop',
    icon: <ChartLineUpIcon size={22} weight="bold" />,
    summary:
      'Continue through committed card stages or cash out the fixture pot before the next stage busts.',
    title: previewModeTitles.crash,
  },
  flip: {
    eyebrow: 'Solo acquisition loop',
    icon: <CardsThreeIcon size={22} weight="fill" />,
    summary:
      'Choose an eligible inventory pool, commit its probability band, reveal a selected card, then inspect acquisition finality.',
    title: previewModeTitles.flip,
  },
  house: {
    eyebrow: 'Instant duel liquidity',
    icon: <SwordIcon size={22} weight="fill" />,
    summary:
      'Accept a disclosed house opponent whose pack path is committed before either result can be observed.',
    title: previewModeTitles.house,
  },
};

export type GamePreviewFixtureState = {
  crashStage?: number;
  crashStatus?: 'active' | 'busted' | 'cashed';
  flipStep?: number;
  houseStep?: number;
};

export function GameModePreview({
  fixtureState = {},
  mode,
}: {
  fixtureState?: GamePreviewFixtureState;
  mode: PreviewMode;
}) {
  const copy = modeCopy[mode];
  return (
    <main className="mx-auto flex min-h-[calc(100svh-7rem)] max-w-[1280px] flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
      <header className="grid gap-6 border-b border-border pb-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div>
          <p className="proof-label flex items-center gap-2">
            <FlaskIcon size={15} weight="fill" />
            Full UX preview · no funds or assets
          </p>
          <h1 className="mt-3 flex items-center gap-3 text-3xl font-semibold tracking-[-0.045em] text-primary sm:text-5xl">
            <span className="text-lime" aria-hidden="true">
              {copy.icon}
            </span>
            {copy.title}
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-secondary">{copy.summary}</p>
        </div>
        <aside className="rounded-xl border border-warning/25 bg-warning/5 p-5">
          <div className="flex items-center gap-3 text-warning">
            <WarningCircleIcon size={21} weight="fill" />
            <strong className="text-sm">Fixture-safe interaction</strong>
          </div>
          <p className="mt-3 text-xs leading-5 text-secondary">
            Buttons exercise presentation and state transitions only. Provider purchase, custody,
            transfer, and payout remain disabled.
          </p>
        </aside>
      </header>

      <nav
        aria-label="Game preview modes"
        className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-secondary p-2"
      >
        {(['flip', 'crash', 'house'] as const).map((candidate) => (
          <Link
            aria-current={candidate === mode ? 'page' : undefined}
            className={[
              'flex min-h-12 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors sm:text-sm',
              candidate === mode
                ? 'bg-elevated text-primary'
                : 'text-secondary hover:bg-tertiary hover:text-primary',
            ].join(' ')}
            href={`/games/${candidate}`}
            key={candidate}
          >
            <span className={candidate === mode ? 'text-lime' : undefined} aria-hidden="true">
              {modeCopy[candidate].icon}
            </span>
            {modeCopy[candidate].title}
          </Link>
        ))}
      </nav>

      {mode === 'flip' ? <FlipPreview initialStep={fixtureState.flipStep} /> : null}
      {mode === 'crash' ? (
        <CrashPreview
          initialStage={fixtureState.crashStage}
          initialStatus={fixtureState.crashStatus}
        />
      ) : null}
      {mode === 'house' ? <HousePreview initialStep={fixtureState.houseStep} /> : null}

      <div className="flex flex-wrap gap-3">
        <Link className="proof-secondary-action" href="/games">
          Back to games
        </Link>
        <Link className="proof-secondary-action" href="/games/activity">
          Open activity lab
        </Link>
      </div>
    </main>
  );
}

function FlipPreview({ initialStep = 0 }: { initialStep?: number }) {
  const [pool, setPool] = useState<'base' | 'electric' | 'graded'>('base');
  const [step, setStep] = useState(initialStep);

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]" aria-label="Flip preview">
      <div className="proof-panel">
        <PreviewHeading
          eyebrow="Committed pool"
          title={step < 2 ? 'Choose one eligible inventory band' : 'The selected card is revealed'}
        />

        {step < 2 ? (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <PoolChoice
                active={pool === 'base'}
                label="Base Set vault"
                meta="12 eligible cards · $25"
                onClick={() => setPool('base')}
              />
              <PoolChoice
                active={pool === 'electric'}
                label="Electric vault"
                meta="18 eligible cards · $15"
                onClick={() => setPool('electric')}
              />
              <PoolChoice
                active={pool === 'graded'}
                label="Graded vault"
                meta="8 eligible cards · $50"
                onClick={() => setPool('graded')}
              />
            </div>

            <div className="mt-6 overflow-hidden rounded-xl border border-border">
              <ProbabilityRow band="Floor" chance="50%" detail="$10–$24.99 normalized value" />
              <ProbabilityRow band="Core" chance="35%" detail="$25–$49.99 normalized value" />
              <ProbabilityRow band="Chase" chance="15%" detail="$50+ normalized value" />
            </div>

            {step === 1 ? (
              <div className="mt-5 rounded-xl border border-lime/20 bg-lime/5 p-5" role="status">
                <div className="flex items-center gap-3 text-lime">
                  <CheckCircleIcon size={20} weight="fill" />
                  <strong className="text-sm">Fixture pool committed</strong>
                </div>
                <dl className="proof-definition-list mt-4">
                  <div>
                    <dt>Rules version</dt>
                    <dd className="font-mono">flip-fixture-v1</dd>
                  </div>
                  <div>
                    <dt>Pool snapshot</dt>
                    <dd className="font-mono">{pool}-00042</dd>
                  </div>
                  <div>
                    <dt>Acquisition</dt>
                    <dd>Simulated only</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <button
              className="proof-primary-action mt-6 gap-2"
              onClick={() => setStep(step === 0 ? 1 : 2)}
              type="button"
            >
              {step === 0 ? <LockKeyIcon size={16} /> : <SparkleIcon size={16} weight="fill" />}
              {step === 0 ? 'Commit fixture draw' : 'Reveal selected fixture'}
            </button>
          </>
        ) : (
          <div className="mt-6 grid gap-6 sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-center">
            <CardImage card={previewCards.charizard} priority />
            <div>
              <p className="proof-label">Chase band · selected reproducibly</p>
              <h3 className="mt-2 text-2xl font-semibold text-primary">
                {previewCards.charizard.name}
              </h3>
              <p className="mt-2 font-mono text-lg font-semibold text-lime">
                ${previewCards.charizard.value.toFixed(2)}
              </p>
              <p className="mt-4 text-sm leading-6 text-secondary">
                The reveal proves the planned selection UI. Ownership remains pending because no
                Marketplace purchase or transfer occurred.
              </p>
              {step === 2 ? (
                <button
                  className="proof-primary-action mt-5 gap-2"
                  onClick={() => setStep(3)}
                  type="button"
                >
                  <ReceiptIcon size={16} />
                  Review fixture receipt
                </button>
              ) : (
                <ReceiptSummary
                  facts={[
                    ['Selection', 'Reproducible fixture'],
                    ['Purchase', 'Not submitted'],
                    ['Ownership', 'Not transferred'],
                    ['Finality', 'Preview only'],
                  ]}
                  title="Flip acquisition receipt"
                />
              )}
            </div>
          </div>
        )}
      </div>

      <PreviewRail
        current={step}
        steps={[
          ['1', 'Choose pool', 'Inventory and probability band'],
          ['2', 'Commit', 'Rules and pool snapshot'],
          ['3', 'Reveal', 'Selected card and value'],
          ['4', 'Receipt', 'Purchase and ownership finality'],
        ]}
      />
    </section>
  );
}

function CrashPreview({
  initialStage = 1,
  initialStatus = 'active',
}: {
  initialStage?: number;
  initialStatus?: 'active' | 'busted' | 'cashed';
}) {
  const cards = [
    previewCards.pikachu,
    previewCards.mewtwo,
    previewCards.blastoise,
    previewCards.charizard,
  ] as const;
  const [stage, setStage] = useState(initialStage);
  const [status, setStatus] = useState<'active' | 'busted' | 'cashed'>(initialStatus);
  const revealed = status === 'busted' ? Math.min(stage + 1, cards.length) : stage;
  const fixturePot = 25 + cards.slice(0, stage).reduce((sum, card) => sum + card.value, 0);

  const reset = () => {
    setStage(1);
    setStatus('active');
  };

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]" aria-label="Crash preview">
      <div className="proof-panel">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <PreviewHeading
            eyebrow={`Stage ${stage} of ${cards.length}`}
            title={
              status === 'active'
                ? 'Continue the card run or cash out'
                : status === 'cashed'
                  ? 'Fixture pot cashed out'
                  : 'The next committed stage busted'
            }
          />
          <div className="sm:text-right">
            <p className="proof-label">Fixture pot</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-lime">
              ${fixturePot.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cards.map((card, index) => (
            <StageCard card={card} index={index} key={card.name} revealed={index < revealed} />
          ))}
        </div>

        {status === 'active' ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              className="proof-secondary-action min-h-12 gap-2"
              onClick={() =>
                stage === cards.length ? setStatus('busted') : setStage((current) => current + 1)
              }
              type="button"
            >
              <TrendUpIcon size={17} weight="bold" />
              Continue fixture run
            </button>
            <button
              className="proof-primary-action min-h-12 gap-2"
              onClick={() => setStatus('cashed')}
              type="button"
            >
              <BankIcon size={17} weight="fill" />
              Cash out fixture pot
            </button>
          </div>
        ) : (
          <div className="mt-6">
            <ReceiptSummary
              facts={[
                ['Terminal reason', status === 'cashed' ? 'Player cash-out' : 'Committed bust'],
                ['Stages resolved', String(revealed)],
                ['Custody movement', 'None · fixture'],
                ['Settlement', 'Preview only'],
              ]}
              title="Crash session receipt"
            />
            <button className="proof-secondary-action mt-4 gap-2" onClick={reset} type="button">
              <ArrowCounterClockwiseIcon size={16} />
              Reset run
            </button>
          </div>
        )}
      </div>

      <aside className="proof-panel">
        <p className="proof-label">Committed session</p>
        <h2 className="mt-2 text-xl font-semibold text-primary">Decision contract</h2>
        <dl className="proof-definition-list mt-5">
          <div>
            <dt>Rules</dt>
            <dd className="font-mono">crash-fixture-v1</dd>
          </div>
          <div>
            <dt>Maximum stages</dt>
            <dd>4</dd>
          </div>
          <div>
            <dt>Timeout default</dt>
            <dd>Cash out</dd>
          </div>
          <div>
            <dt>Live economics</dt>
            <dd>Disabled</dd>
          </div>
        </dl>
        <div className="mt-5 rounded-lg border border-warning/20 bg-warning/5 p-4 text-xs leading-5 text-secondary">
          Fixture values demonstrate hierarchy only. They are not approved probability, pot, or
          house-edge policy.
        </div>
      </aside>
    </section>
  );
}

function HousePreview({ initialStep = 0 }: { initialStep?: number }) {
  const [step, setStep] = useState(initialStep);
  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]" aria-label="House preview">
      <div className="proof-panel">
        <PreviewHeading
          eyebrow="House admission"
          title={
            step === 0
              ? 'The house follows the same duel contract'
              : step === 1
                ? 'Both purchase paths are committed first'
                : 'Fixture admission is ready'
          }
        />

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <ParticipantContract
            label="You"
            lines={['$50 Base Set tier', 'Same provider and value policy', 'Winner receives both']}
          />
          <ParticipantContract
            label="House"
            lines={[
              '$50 treasury-funded tier',
              'Precommitted before your reveal',
              'No privileged refund branch',
            ]}
          />
        </div>

        {step >= 1 ? (
          <div className="mt-5 grid gap-3 rounded-xl border border-border bg-tertiary p-5 sm:grid-cols-2">
            <CommitmentBlock label="Player path" value="player-fixture-41b7" />
            <CommitmentBlock label="House path" value="house-fixture-9ae2" />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-5 rounded-xl border border-lime/25 bg-lime/5 p-5" role="status">
            <div className="flex items-center gap-3 text-lime">
              <ShieldCheckIcon size={21} weight="fill" />
              <strong className="text-sm">Admission contract accepted</strong>
            </div>
            <p className="mt-3 text-sm leading-6 text-secondary">
              The real arena can now continue through wallet authentication and funding. This
              preview did not connect a wallet or reserve treasury exposure.
            </p>
            <Link className="proof-primary-action mt-5 gap-2" href="/overview">
              Open actual Duel arena
              <ArrowRightIcon size={16} />
            </Link>
          </div>
        ) : (
          <button
            className="proof-primary-action mt-6 gap-2"
            onClick={() => setStep((current) => current + 1)}
            type="button"
          >
            {step === 0 ? <CheckCircleIcon size={16} /> : <LockKeyIcon size={16} />}
            {step === 0 ? 'Accept fixture disclosure' : 'Commit fixture paths'}
          </button>
        )}
      </div>

      <aside className="proof-panel">
        <p className="proof-label">Admission gates</p>
        <h2 className="mt-2 text-xl font-semibold text-primary">Instant, never privileged</h2>
        <ul className="mt-5 grid gap-3">
          {[
            'Provider health passes',
            'Treasury exposure is available',
            'House commits before observation',
            'Same valuation and settlement path',
            'Deterministic refund on failure',
          ].map((gate) => (
            <li className="flex gap-3 text-sm leading-6 text-secondary" key={gate}>
              <CheckCircleIcon className="mt-1 shrink-0 text-lime" size={16} weight="fill" />
              {gate}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-tertiary p-4">
          <ClockCountdownIcon className="mt-0.5 shrink-0 text-secondary" size={18} />
          <p className="text-xs leading-5 text-secondary">
            Production House remains disabled until treasury, provider, custody, and legal gates are
            approved.
          </p>
        </div>
      </aside>
    </section>
  );
}

function PreviewHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="proof-label">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-primary">{title}</h2>
    </div>
  );
}

function PoolChoice({
  active,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={[
        'min-h-28 rounded-xl border p-4 text-left transition-colors',
        active
          ? 'border-lime/40 bg-lime/5'
          : 'border-border bg-tertiary hover:border-border-strong',
      ].join(' ')}
      onClick={onClick}
      type="button"
    >
      <span className={active ? 'text-lime' : 'text-secondary'} aria-hidden="true">
        <CardsThreeIcon size={20} weight="fill" />
      </span>
      <strong className="mt-3 block text-sm text-primary">{label}</strong>
      <small className="mt-1 block text-xs text-secondary">{meta}</small>
    </button>
  );
}

function ProbabilityRow({
  band,
  chance,
  detail,
}: {
  band: string;
  chance: string;
  detail: string;
}) {
  return (
    <div className="grid gap-2 border-b border-border bg-secondary px-4 py-3 last:border-b-0 sm:grid-cols-[6rem_4rem_minmax(0,1fr)] sm:items-center">
      <strong className="text-sm text-primary">{band}</strong>
      <span className="font-mono text-sm font-semibold text-lime">{chance}</span>
      <span className="text-xs text-secondary">{detail}</span>
    </div>
  );
}

function CardImage({ card, priority = false }: { card: PreviewCard; priority?: boolean }) {
  return (
    <div className="relative aspect-[2.5/3.5] overflow-hidden rounded-xl border border-border bg-tertiary">
      <Image
        alt={card.name}
        className="object-cover"
        fill
        loading={priority ? 'eager' : 'lazy'}
        priority={priority}
        sizes="(min-width: 768px) 240px, 72vw"
        src={card.imageUrl}
      />
    </div>
  );
}

function StageCard({
  card,
  index,
  revealed,
}: {
  card: PreviewCard;
  index: number;
  revealed: boolean;
}) {
  return (
    <article
      className={[
        'rounded-xl border p-2 transition-colors',
        revealed ? 'border-lime/30 bg-lime/5' : 'border-border bg-tertiary',
      ].join(' ')}
    >
      <div className="relative aspect-[2.5/3.5] overflow-hidden rounded-lg bg-primary">
        <Image
          alt={revealed ? card.name : ''}
          aria-hidden={!revealed}
          className={revealed ? 'object-cover' : 'object-cover opacity-15 blur-sm'}
          fill
          loading={revealed ? 'eager' : 'lazy'}
          sizes="(min-width: 768px) 160px, 40vw"
          src={card.imageUrl}
        />
        {!revealed ? (
          <span className="absolute inset-0 grid place-items-center text-secondary">
            <LockKeyIcon size={25} />
          </span>
        ) : null}
      </div>
      <p className="proof-label mt-3">Stage {index + 1}</p>
      <p className="mt-1 truncate text-xs font-semibold text-primary">
        {revealed ? card.name.split(' · ')[0] : 'Committed card'}
      </p>
      <p className="mt-1 font-mono text-xs text-secondary">
        {revealed ? `$${card.value.toFixed(2)}` : 'Hidden'}
      </p>
    </article>
  );
}

function ReceiptSummary({ facts, title }: { facts: Array<[string, string]>; title: string }) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-tertiary p-5" role="status">
      <div className="flex items-center gap-3 text-lime">
        <ReceiptIcon size={20} weight="fill" />
        <strong className="text-sm">{title}</strong>
      </div>
      <dl className="proof-definition-list mt-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PreviewRail({
  current,
  steps,
}: {
  current: number;
  steps: Array<[string, string, string]>;
}) {
  return (
    <aside className="proof-panel">
      <p className="proof-label">Player journey</p>
      <h2 className="mt-2 text-xl font-semibold text-primary">One committed path</h2>
      <ol className="mt-5 grid gap-3">
        {steps.map(([number, label, detail], index) => (
          <li className="flex gap-3" key={number}>
            <span
              className={[
                'grid size-8 shrink-0 place-items-center rounded-full border font-mono text-xs font-semibold',
                index <= current
                  ? 'border-lime/40 bg-lime/10 text-lime'
                  : 'border-border bg-tertiary text-secondary',
              ].join(' ')}
            >
              {number}
            </span>
            <div>
              <p className="text-sm font-semibold text-primary">{label}</p>
              <p className="mt-1 text-xs leading-5 text-secondary">{detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function ParticipantContract({ label, lines }: { label: string; lines: string[] }) {
  return (
    <article className="rounded-xl border border-border bg-tertiary p-5">
      <p className="proof-label">{label}</p>
      <div className="mt-4 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-elevated text-lime">
          <SwordIcon size={20} weight="fill" />
        </span>
        <strong className="text-base text-primary">$50 Base Set pack</strong>
      </div>
      <ul className="mt-4 grid gap-2">
        {lines.map((line) => (
          <li className="flex gap-2 text-xs leading-5 text-secondary" key={line}>
            <CheckCircleIcon className="mt-0.5 shrink-0 text-lime" size={14} weight="fill" />
            {line}
          </li>
        ))}
      </ul>
    </article>
  );
}

function CommitmentBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="proof-label">{label}</p>
      <p className="mt-2 break-all font-mono text-xs text-primary">{value}</p>
    </div>
  );
}
