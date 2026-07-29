'use client';

import {
  ArrowCounterClockwiseIcon,
  CardsThreeIcon,
  CheckCircleIcon,
  CrosshairIcon,
  LockKeyIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SparkleIcon,
  TrophyIcon,
} from '@phosphor-icons/react';
import { motion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { type CSSProperties, type RefObject, useEffect, useReducer, useRef } from 'react';
import { ChoreographyAudioHaptics } from '../../components/audio-haptics';
import { CelebrationOverlay } from '../../components/celebration';
import {
  ChoreographyCelebration,
  type ChoreographyController,
  ChoreographyDriver,
  ChoreographySkipControl,
  useRevealChoreography,
} from '../../components/choreography';
import choreographyStyles from '../../components/choreography/choreography.module.css';
import { demoCards } from '../demo-card-data';
import { GameRulesOverview } from '../game-rules-overview';
import styles from './marketplace-flip-game.module.css';
import {
  type FlipCall,
  flipCallLabel,
  flipResultCallForRound,
  INITIAL_MARKETPLACE_FLIP_GAME_STATE,
  type MarketplaceFlipGameState,
  marketplaceFlipGameReducer,
} from './marketplace-flip-game-state';

const callOptions: ReadonlyArray<{
  call: FlipCall;
  detail: string;
  multiplier: string;
}> = [
  { call: 'floor', detail: 'Under $25 fixture band', multiplier: '+1 if exact' },
  { call: 'core', detail: '$25–$49.99 fixture band', multiplier: '+2 if exact' },
  { call: 'chase', detail: '$50+ fixture band', multiplier: '+3 if exact' },
];

export function MarketplaceFlipGame({
  initialState = INITIAL_MARKETPLACE_FLIP_GAME_STATE,
}: {
  initialState?: MarketplaceFlipGameState;
}) {
  const [state, dispatch] = useReducer(marketplaceFlipGameReducer, initialState);
  const nextActionRef = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef(state.phase);
  const resultVisible = state.phase === 'result' || state.phase === 'receipt';

  useEffect(() => {
    if (previousPhase.current === state.phase) return;
    previousPhase.current = state.phase;
    nextActionRef.current?.focus();
  }, [state.phase]);

  return (
    <main className={styles.page}>
      <section
        aria-label="Marketplace Flip game"
        className={styles.machine}
        data-flip-phase={state.phase}
        id="flip-table"
      >
        <header className={styles.machineHeader}>
          <div>
            <p className={styles.eyebrow}>No-value devnet table</p>
            <h1 className={styles.title}>Marketplace Flip</h1>
          </div>
          <section className={styles.scoreboard} aria-label="Fixture score">
            <Score label="Round" value={state.round.toString().padStart(2, '0')} />
            <Score label="Score" value={state.score.toString().padStart(2, '0')} />
            <Score label="Streak" value={`${state.streak}×`} />
          </section>
        </header>

        <div className={styles.fixtureNotice}>
          <ShieldCheckIcon aria-hidden="true" size={17} weight="fill" />
          <span>
            Gameplay only. No wallet, payment, marketplace order, custody, or ownership change.
          </span>
        </div>

        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {phaseAnnouncement(state)}
        </p>

        <ol aria-label="Round progress" className={styles.progress}>
          {[
            ['01', 'Call'],
            ['02', 'Commit'],
            ['03', 'Flip'],
            ['04', 'Result'],
          ].map(([number, label], index) => {
            const activeIndex = phaseIndex(state.phase);
            return (
              <li
                aria-current={index === activeIndex ? 'step' : undefined}
                className={index < activeIndex ? styles.progressDone : undefined}
                data-active={index === activeIndex || undefined}
                key={number}
              >
                <span>{index < activeIndex ? <CheckCircleIcon weight="fill" /> : number}</span>
                {label}
              </li>
            );
          })}
        </ol>

        <div className={styles.table}>
          <section className={styles.playfield}>
            {state.phase === 'pick' ? (
              <CallStage
                call={state.call}
                focusRef={nextActionRef}
                onCommit={() => dispatch({ type: 'call-committed' })}
                onSelect={(call) => dispatch({ call, type: 'call-selected' })}
              />
            ) : null}

            {state.phase === 'committed' ? (
              <CommittedStage
                call={state.call}
                focusRef={nextActionRef}
                onFlip={() => dispatch({ type: 'card-flipped' })}
              />
            ) : null}

            {state.phase === 'revealing' || resultVisible ? (
              <RevealStage
                call={state.call}
                onComplete={() => dispatch({ type: 'reveal-completed' })}
                phase={state.phase}
                round={state.round}
              />
            ) : null}

            {state.phase === 'receipt' ? <FixtureReceipt state={state} /> : null}
          </section>

          <aside className={styles.roundRail} aria-label="Current round">
            <p className={styles.eyebrow}>Round card</p>
            <h2>Make the call. Own the moment.</h2>
            <dl>
              <div>
                <dt>Your call</dt>
                <dd>{flipCallLabel(state.call)}</dd>
              </div>
              <div>
                <dt>Entry</dt>
                <dd>$0.00</dd>
              </div>
              <div>
                <dt>Result source</dt>
                <dd>Local fixture</dd>
              </div>
              <div>
                <dt>Asset movement</dt>
                <dd>None</dd>
              </div>
            </dl>
            <p>
              The selected call changes your score only. The fixture card was fixed before you
              arrived and never becomes an owned asset.
            </p>
          </aside>
        </div>

        {resultVisible ? (
          <footer className={styles.resultActions}>
            {state.phase === 'result' ? (
              <button
                className={styles.secondaryAction}
                onClick={() => dispatch({ type: 'receipt-opened' })}
                ref={nextActionRef}
                type="button"
              >
                <ReceiptIcon aria-hidden="true" size={17} />
                Review script summary
              </button>
            ) : null}
            <button
              className={styles.primaryAction}
              onClick={() => dispatch({ type: 'round-replayed' })}
              ref={state.phase === 'receipt' ? nextActionRef : undefined}
              type="button"
            >
              <ArrowCounterClockwiseIcon aria-hidden="true" size={18} weight="bold" />
              Play next round
            </button>
          </footer>
        ) : null}
      </section>

      <GameRulesOverview
        actionDirection="up"
        actionHref="#flip-table"
        actionLabel="Return to the game"
        headingLevel={2}
        mode="flip"
      />

      <nav aria-label="Marketplace Flip links" className={styles.footerLinks}>
        <Link href="/games">Back to games</Link>
        <Link href="/games/activity">Open activity</Link>
      </nav>
    </main>
  );
}

function Score({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function CallStage({
  call,
  focusRef,
  onCommit,
  onSelect,
}: {
  call: FlipCall;
  focusRef: RefObject<HTMLButtonElement | null>;
  onCommit: () => void;
  onSelect: (call: FlipCall) => void;
}) {
  return (
    <div className={styles.stageContent}>
      <div className={styles.stageHeading}>
        <span className={styles.stageIcon}>
          <CrosshairIcon aria-hidden="true" size={25} weight="bold" />
        </span>
        <div>
          <p className={styles.eyebrow}>Make your prediction</p>
          <h2>Which band is behind the card?</h2>
          <p>Call the exact fixture band before the card turns over.</p>
        </div>
      </div>

      <fieldset className={styles.calls}>
        <legend className="sr-only">Choose your fixture band prediction</legend>
        {callOptions.map((option) => (
          <button
            aria-pressed={call === option.call}
            className={styles.call}
            data-selected={call === option.call || undefined}
            key={option.call}
            onClick={() => onSelect(option.call)}
            type="button"
          >
            <span className={styles.callMarker} aria-hidden="true" />
            <strong>{flipCallLabel(option.call)}</strong>
            <span>{option.detail}</span>
            <small>{option.multiplier}</small>
          </button>
        ))}
      </fieldset>

      <button className={styles.primaryAction} onClick={onCommit} ref={focusRef} type="button">
        <LockKeyIcon aria-hidden="true" size={18} weight="bold" />
        Lock {flipCallLabel(call)} call
      </button>
    </div>
  );
}

function CommittedStage({
  call,
  focusRef,
  onFlip,
}: {
  call: FlipCall;
  focusRef: RefObject<HTMLButtonElement | null>;
  onFlip: () => void;
}) {
  return (
    <div className={styles.committedStage}>
      <div className={styles.cardPedestal} aria-hidden="true">
        <div className={styles.cardBack}>
          <span>DailyDraft</span>
          <CardsThreeIcon size={47} weight="fill" />
          <strong>Flip</strong>
          <small>Fixture round</small>
        </div>
      </div>
      <div className={styles.committedCopy}>
        <p className={styles.eyebrow}>Call locked · {flipCallLabel(call)}</p>
        <h2>The card is ready.</h2>
        <p>
          Your prediction is frozen for this round. Flip when you’re ready—the outcome cannot change
          now.
        </p>
        <button className={styles.flipAction} onClick={onFlip} ref={focusRef} type="button">
          <SparkleIcon aria-hidden="true" size={21} weight="fill" />
          Flip the card
        </button>
      </div>
    </div>
  );
}

function RevealStage({
  call,
  onComplete,
  phase,
  round,
}: {
  call: FlipCall;
  onComplete: () => void;
  phase: MarketplaceFlipGameState['phase'];
  round: number;
}) {
  const resultCall = flipResultCallForRound(round);
  const card =
    resultCall === 'chase'
      ? demoCards.charizard
      : resultCall === 'core'
        ? demoCards.mewtwo
        : demoCards.pikachu;
  const resultVisible = phase === 'result' || phase === 'receipt';
  const choreography = useRevealChoreography({
    active: true,
    initiallySettled: resultVisible,
    rarity: 'rare',
    sequenceKey: `marketplace-flip-round-${round}`,
  });

  useEffect(() => {
    if (phase === 'revealing' && choreography.settled) onComplete();
  }, [choreography.settled, onComplete, phase]);

  const cardVisible = choreography.revealed || choreography.settled;
  const won = call === resultCall;
  const points = won ? (resultCall === 'chase' ? 3 : resultCall === 'core' ? 2 : 1) : 0;

  return (
    <div className={styles.revealStage}>
      <div>
        <figure
          aria-label={`Card reveal for ${card.name}`}
          className={`${choreographyStyles.flipScene} ${styles.revealScene}`}
          data-choreography-active="true"
          data-choreography-beat={choreography.beat}
          data-choreography-rarity="rare"
          data-choreography-settled={choreography.settled}
          style={
            {
              '--choreography-intensity': choreography.intensity,
            } as CSSProperties
          }
        >
          <motion.div
            animate={{
              opacity: cardVisible ? 1 : 0,
              rotateY: cardVisible ? 0 : -88,
              scale: choreography.beat === 'celebrate' ? 1 + choreography.intensity * 0.035 : 1,
            }}
            className={`${choreographyStyles.flipCard} ${styles.revealCard}`}
            initial={false}
            transition={choreography.transition}
          >
            <div className={styles.cardImage}>
              <Image
                alt={card.name}
                className={styles.cardArtwork}
                fill
                priority
                sizes="(min-width: 768px) 260px, 70vw"
                src={card.imageUrl}
              />
            </div>
          </motion.div>
          <motion.div
            animate={packTarget(choreography)}
            aria-hidden="true"
            className={`${choreographyStyles.pack} ${styles.revealBack}`}
            initial={false}
            transition={choreography.transition}
          >
            <CardsThreeIcon size={52} weight="fill" />
            <strong>DailyDraft</strong>
            <span>Marketplace Flip</span>
          </motion.div>
          <ChoreographyCelebration
            className={choreographyStyles.celebration}
            controller={choreography}
          />
          <CelebrationOverlay
            controller={choreography}
            sequenceKey={`marketplace-${card.name}`}
            valueUsd={card.value}
          />
          <ChoreographyDriver controller={choreography} sequenceKey={`marketplace-${card.name}`} />
          <ChoreographyAudioHaptics beat={choreography.beat} rarity="rare" />
        </figure>
        <ChoreographySkipControl
          className={`${styles.skipAction} ${choreographyStyles.skip}`}
          controller={choreography}
          label="Skip reveal animation"
        />
      </div>

      <div className={styles.resultCopy} data-visible={resultVisible || undefined}>
        <p className={styles.eyebrow}>
          {resultVisible
            ? won
              ? `Exact call · +${points} ${points === 1 ? 'point' : 'points'}`
              : 'Call missed · next round'
            : 'Flipping'}
        </p>
        <h2>{resultVisible ? card.name : 'Hold for the reveal…'}</h2>
        {resultVisible ? (
          <>
            <p className={styles.fixtureValue}>${card.value.toFixed(2)}</p>
            <span className={styles.resultBadge}>
              {won ? (
                <TrophyIcon aria-hidden="true" size={18} weight="fill" />
              ) : (
                <CardsThreeIcon aria-hidden="true" size={18} weight="fill" />
              )}
              {won
                ? `${flipCallLabel(resultCall)} called correctly`
                : `Result was ${flipCallLabel(resultCall)}`}
            </span>
            <p className={styles.resultBoundary}>
              Fixture value only. No listing was selected, bought, transferred, or assigned to your
              wallet.
            </p>
          </>
        ) : (
          <p>Your locked call is being compared with the fixed local fixture card.</p>
        )}
      </div>
    </div>
  );
}

function FixtureReceipt({ state }: { state: MarketplaceFlipGameState }) {
  return (
    <div className={styles.receipt} role="status">
      <header>
        <ReceiptIcon aria-hidden="true" size={21} weight="fill" />
        <div>
          <p className={styles.eyebrow}>Round {state.round} summary</p>
          <h2>Fixture result computed for this run</h2>
        </div>
      </header>
      <dl>
        <div>
          <dt>Your call</dt>
          <dd>{flipCallLabel(state.call)}</dd>
        </div>
        <div>
          <dt>Fixture result</dt>
          <dd>{flipCallLabel(flipResultCallForRound(state.round))}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>+{state.lastPoints}</dd>
        </div>
        <div>
          <dt>Commitment</dt>
          <dd>Local UI state only</dd>
        </div>
        <div>
          <dt>Purchase</dt>
          <dd>Not submitted</dd>
        </div>
        <div>
          <dt>Ownership</dt>
          <dd>Unchanged</dd>
        </div>
      </dl>
    </div>
  );
}

function phaseIndex(phase: MarketplaceFlipGameState['phase']): number {
  switch (phase) {
    case 'pick':
      return 0;
    case 'committed':
      return 1;
    case 'revealing':
      return 2;
    case 'result':
    case 'receipt':
      return 3;
  }
}

function phaseAnnouncement(state: MarketplaceFlipGameState): string {
  switch (state.phase) {
    case 'pick':
      return `Round ${state.round}. Choose and lock a prediction.`;
    case 'committed':
      return `${flipCallLabel(state.call)} prediction locked. The card is ready to flip.`;
    case 'revealing':
      return 'The fixture card is flipping.';
    case 'result':
      return `Round result revealed. ${state.lastPoints} points scored.`;
    case 'receipt':
      return 'No-value round summary opened.';
  }
}

function packTarget(choreography: ChoreographyController) {
  switch (choreography.beat) {
    case 'anticipation':
      return { opacity: 1, rotateZ: -2, scale: 1.04, y: -4 };
    case 'hold':
      return { opacity: 1, rotateZ: 2, scale: 1.07, y: 0 };
    case 'reveal':
    case 'celebrate':
    case 'settled':
      return { opacity: 0, rotateZ: 0, scale: 1.14, y: -14 };
    case 'idle':
      return { opacity: 1, rotateZ: 0, scale: 0.98, y: 8 };
  }
}
