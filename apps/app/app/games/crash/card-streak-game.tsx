'use client';

import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  BankIcon,
  CheckCircleIcon,
  GameControllerIcon,
  LockKeyIcon,
  ShieldCheckIcon,
  SkullIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import Image from 'next/image';
import { useEffect, useReducer, useRef } from 'react';
import { activateRulesHashTarget } from '../game-rules-overview';
import styles from './card-streak-game.module.css';
import {
  CARD_STREAK_CARDS,
  type CardStreakAction,
  type CardStreakState,
  cardStreakCardsForRound,
  cardStreakReducer,
  fixturePotFor,
  INITIAL_CARD_STREAK_STATE,
  nextCardFor,
  streakProgressFor,
} from './card-streak-state';

export function CardStreakGame({
  initialState = INITIAL_CARD_STREAK_STATE,
}: {
  initialState?: CardStreakState;
}) {
  const [state, dispatch] = useReducer(cardStreakReducer, initialState);

  return <CardStreakView dispatch={dispatch} state={state} />;
}

export function CardStreakView({
  dispatch,
  state,
}: {
  dispatch: (action: CardStreakAction) => void;
  state: CardStreakState;
}) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const previousTerminalKey = useRef(`${state.status}:${state.round}`);
  const rulesRef = useRef<HTMLElement>(null);
  const cards = cardStreakCardsForRound(state.round);
  const currentCard = cards[state.stageIndex] ?? cards[0] ?? CARD_STREAK_CARDS[0];
  const nextCard = nextCardFor(state);
  const fixturePot = fixturePotFor(state.stageIndex, state.round);
  const active = state.status === 'active';

  useEffect(() => {
    const terminalKey = `${state.status}:${state.round}`;
    if (terminalKey === previousTerminalKey.current) return;
    previousTerminalKey.current = terminalKey;
    primaryActionRef.current?.focus();
  }, [state.round, state.status]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const focusRules = () => {
      activateRulesHashTarget({
        hash: window.location.hash,
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        target: rulesRef.current,
      });
    };
    focusRules();
    window.addEventListener('hashchange', focusRules);
    return () => window.removeEventListener('hashchange', focusRules);
  }, []);

  return (
    <section
      aria-label="Card Streak game"
      className={styles.game}
      data-stage={state.stageIndex + 1}
      data-status={state.status}
    >
      <header className={styles.scorebar}>
        <div className={styles.brand}>
          <span className={styles.brandIcon} aria-hidden="true">
            <GameControllerIcon size={20} weight="fill" />
          </span>
          <span>
            <small>Deterministic devnet game</small>
            <strong>Run {String(state.round).padStart(2, '0')}</strong>
          </span>
        </div>

        <div className={styles.score}>
          <span>Demo score · no funds</span>
          <strong>${fixturePot.toFixed(2)}</strong>
        </div>

        <div className={styles.stageScore}>
          <span>Streak</span>
          <strong>
            {state.stageIndex + 1}
            <small> / {CARD_STREAK_CARDS.length}</small>
          </strong>
        </div>
      </header>

      <div className={styles.arena}>
        <div className={styles.atmosphere} aria-hidden="true" />

        <ol aria-label="Card Streak stages" className={styles.stageTrack}>
          {cards.map((card, index) => {
            const revealed = index <= state.stageIndex;
            const current = index === state.stageIndex;
            return (
              <li
                aria-current={current ? 'step' : undefined}
                className={styles.stage}
                data-current={current || undefined}
                data-revealed={revealed || undefined}
                key={card.name}
              >
                <span>{revealed ? <CheckCircleIcon weight="fill" /> : index + 1}</span>
                <small>{revealed ? card.name : `Stage ${index + 1}`}</small>
              </li>
            );
          })}
        </ol>

        <div className={styles.playfield}>
          <aside className={styles.pressurePanel}>
            <span>Pressure</span>
            <strong>{currentCard.pressure}</strong>
            <div
              aria-label={`${Math.round(streakProgressFor(state))}% of the fixture path revealed`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(streakProgressFor(state))}
              className={styles.pressureMeter}
              role="progressbar"
            >
              <span style={{ width: `${streakProgressFor(state)}%` }} />
            </div>
            <p>
              {state.stageIndex === CARD_STREAK_CARDS.length - 1
                ? 'One more push busts this fixed run.'
                : `${CARD_STREAK_CARDS.length - state.stageIndex - 1} cards remain in the script.`}
            </p>
          </aside>

          <div className={styles.cardSpotlight}>
            {state.status === 'busted' ? (
              <TerminalCard
                detail={`You pushed past stage ${CARD_STREAK_CARDS.length}. The $${fixturePot.toFixed(2)} demo score is gone.`}
                icon={<SkullIcon size={46} weight="fill" />}
                title="Busted"
                tone="danger"
              />
            ) : state.status === 'cashed-out' ? (
              <TerminalCard
                detail={`You ended this run at a $${fixturePot.toFixed(2)} demo score after ${state.stageIndex + 1} ${state.stageIndex === 0 ? 'card' : 'cards'}.`}
                icon={<BankIcon size={46} weight="fill" />}
                title="Run ended"
                tone="success"
              />
            ) : (
              <figure className={styles.cardReveal} key={`${state.round}-${state.stageIndex}`}>
                <div className={styles.cardFrame}>
                  <Image
                    alt={`${currentCard.name} revealed at stage ${state.stageIndex + 1}`}
                    className={styles.cardImage}
                    fill
                    priority
                    sizes="(min-width: 900px) 280px, 64vw"
                    src={currentCard.imageUrl}
                  />
                  <span className={styles.cardGlow} aria-hidden="true" />
                </div>
                <figcaption>
                  <span>Stage {state.stageIndex + 1} clear</span>
                  <strong>{currentCard.name}</strong>
                  <small>+${currentCard.value.toFixed(2)} fixture value</small>
                </figcaption>
              </figure>
            )}
          </div>

          <aside className={styles.nextPanel}>
            <span>{nextCard ? 'Next card' : 'Final decision'}</span>
            <div className={styles.nextCard} aria-hidden="true">
              <LockKeyIcon size={24} />
            </div>
            <strong>{nextCard ? 'Hidden' : 'Past the edge'}</strong>
            <p>
              {nextCard
                ? `Continue to reveal stage ${state.stageIndex + 2}.`
                : 'Continue now and this deterministic fixture busts.'}
            </p>
          </aside>
        </div>

        <div aria-atomic="true" aria-live="polite" className={styles.liveStatus}>
          {state.status === 'active'
            ? `${currentCard.name} cleared. Demo score ${fixturePot.toFixed(2)}.`
            : state.status === 'cashed-out'
              ? `Run complete at a ${fixturePot.toFixed(2)} demo score.`
              : `Run complete. Busted after stage ${state.stageIndex + 1}.`}
        </div>

        {active ? (
          <div className={styles.actions}>
            <button
              className={styles.continueButton}
              onClick={() => dispatch({ type: 'continue' })}
              ref={primaryActionRef}
              type="button"
            >
              <span>
                <SparkleIcon size={21} weight="fill" />
                {nextCard ? 'Continue streak' : 'Push past the edge'}
              </span>
              <small>
                {nextCard ? `Reveal stage ${state.stageIndex + 2}` : 'This fixture will bust'}
              </small>
            </button>
            <button
              className={styles.cashButton}
              onClick={() => dispatch({ type: 'cash-out' })}
              type="button"
            >
              <span>
                <BankIcon size={21} weight="fill" />
                End run
              </span>
              <small>Keep ${fixturePot.toFixed(2)} as this run’s demo score</small>
            </button>
          </div>
        ) : (
          <div className={styles.terminalActions}>
            <button
              className={styles.replayButton}
              onClick={() => dispatch({ type: 'replay' })}
              ref={primaryActionRef}
              type="button"
            >
              <ArrowCounterClockwiseIcon size={20} weight="bold" />
              Play again
            </button>
            <p>
              Run {String(state.round).padStart(2, '0')} · {state.decisionCount}{' '}
              {state.decisionCount === 1 ? 'decision' : 'decisions'} · no asset movement
            </p>
          </div>
        )}
      </div>

      <footer className={styles.safety} id="rules" ref={rulesRef} tabIndex={-1}>
        <span>
          <ShieldCheckIcon size={18} weight="fill" />
          No wallet. No funds. No custody.
        </span>
        <p>
          This is a fixed devnet gameplay fixture—not a live-money game. Values are scores only;
          settlement and commercial odds remain disabled.
        </p>
        <details>
          <summary>
            How this run works <ArrowRightIcon aria-hidden="true" size={14} />
          </summary>
          <p>
            Each numbered run rotates the same four fixture cards through a deterministic path.
            Continue builds the demo score; ending the run stops safely; continuing once more after
            stage four always busts. Nothing is randomized, bought, transferred, or paid.
          </p>
        </details>
      </footer>
    </section>
  );
}

function TerminalCard({
  detail,
  icon,
  title,
  tone,
}: {
  detail: string;
  icon: React.ReactNode;
  title: string;
  tone: 'danger' | 'success';
}) {
  return (
    <div className={styles.terminalCard} data-tone={tone} role="status">
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
