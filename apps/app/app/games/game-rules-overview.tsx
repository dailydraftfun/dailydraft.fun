import {
  ArrowDownIcon,
  CheckCircleIcon,
  LockKeyIcon,
  ReceiptIcon,
  ShieldWarningIcon,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { type GameRulesMode, gameRules } from './game-rules';
import styles from './game-rules-overview.module.css';

export function GameRulesOverview({ mode }: { mode: GameRulesMode }) {
  const rules = gameRules[mode];
  const preview = rules.state === 'fixture-preview';

  return (
    <section
      aria-labelledby={`${mode}-rules-title`}
      className={styles.shell}
      data-game-rules={mode}
      id="rules"
    >
      <header className={styles.masthead}>
        <div>
          <p className="proof-label">{rules.eyebrow}</p>
          <h1 className={styles.title} id={`${mode}-rules-title`}>
            Know the outcome path
            <span className="block text-lime">before the wallet.</span>
          </h1>
          <p className={styles.summary}>{rules.summary}</p>
        </div>

        <aside
          aria-label={`${rules.name} readiness and wallet requirements`}
          className={`${styles.statusDocket}${preview ? ` ${styles.previewStatus}` : ''}`}
        >
          <div className={styles.statusLine}>
            <span className={styles.statusDot} aria-hidden="true" />
            {rules.statusLabel}
          </div>
          <p className={styles.wallet}>
            <strong className="text-primary">Wallet requirement.</strong> {rules.wallet}
          </p>
          <Link className={styles.action} href={rules.previewHref}>
            {rules.previewLabel}
            <ArrowDownIcon aria-hidden="true" size={15} weight="bold" />
          </Link>
        </aside>
      </header>

      <ol aria-label={`${rules.name} player loop`} className={styles.loop}>
        {rules.loop.map((step, index) => (
          <li key={step.label}>
            <span className={styles.step} aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <dl aria-label={`${rules.name} operating rules`} className={styles.ruleGrid}>
        {rules.facts.map((fact) => (
          <div className={styles.ruleCard} key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.detail}</dd>
          </div>
        ))}
        <div className={styles.ruleCard}>
          <dt>Custody</dt>
          <dd>{rules.custody}</dd>
        </div>
        <div className={styles.ruleCard}>
          <dt>Settlement</dt>
          <dd>{rules.settlement}</dd>
        </div>
        <div className={styles.ruleCard}>
          <dt>Refund boundary</dt>
          <dd>{rules.refund}</dd>
        </div>
        <div className={styles.ruleCard}>
          <dt>Receipt</dt>
          <dd>{rules.receipt}</dd>
        </div>
      </dl>

      <div className={styles.ledger}>
        <header className={styles.ledgerHeader}>
          <p className="proof-label flex items-center gap-2">
            <ReceiptIcon aria-hidden="true" size={15} weight="fill" />
            State ledger
          </p>
          <h2>Three facts, never one vague “done.”</h2>
        </header>
        <dl className={styles.ledgerFacts}>
          {rules.stateLegend.map((fact, index) => (
            <div className={styles.ledgerFact} key={fact.label}>
              <dt className="flex items-center gap-2">
                {index === 0 ? <LockKeyIcon aria-hidden="true" size={14} /> : null}
                {index === 1 ? <CheckCircleIcon aria-hidden="true" size={14} /> : null}
                {index === 2 ? <ReceiptIcon aria-hidden="true" size={14} /> : null}
                {fact.label}
              </dt>
              <dd>{fact.detail}</dd>
            </div>
          ))}
        </dl>

        <aside className={styles.gates} aria-labelledby={`${mode}-gates-title`}>
          <p className="proof-label flex items-center gap-2">
            <ShieldWarningIcon aria-hidden="true" size={15} weight="fill" />
            Exact promotion gates
          </p>
          <h2 id={`${mode}-gates-title`}>
            {preview ? 'Why this is not playable' : 'What the server and policy must allow'}
          </h2>
          <ul className={styles.gateList}>
            {rules.gates.map((gate) => (
              <li key={gate}>
                <LockKeyIcon
                  aria-hidden="true"
                  className={styles.gateIcon}
                  size={15}
                  weight="fill"
                />
                <span>{gate}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
