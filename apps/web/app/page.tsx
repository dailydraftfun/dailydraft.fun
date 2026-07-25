import {
  ArrowRightIcon,
  CheckCircleIcon,
  LockKeyIcon,
  SparkleIcon,
  TrophyIcon,
  UsersThreeIcon,
  WalletIcon,
  XLogoIcon,
} from '@phosphor-icons/react/dist/ssr';

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailydraft.fun';

const steps = [
  {
    number: '01',
    title: 'Rip a sports pack',
    detail:
      'Open a Collector Crypt football, soccer, baseball, or basketball pack and pull a real, vaulted, graded card.',
  },
  {
    number: '02',
    title: 'Build your squad',
    detail:
      'Hold the players you believe in. Your cards are the roster you take into every tournament.',
  },
  {
    number: '03',
    title: 'Auto-enter tournaments',
    detail:
      'Squads lock at kickoff. No lineups to submit—if you hold the card before the whistle, you are in.',
  },
  {
    number: '04',
    title: 'Win on real match data',
    detail:
      'Live stats score your players. Top finishers by position pay out, weighted by the cards you hold.',
  },
] as const;

const principles = [
  {
    icon: WalletIcon,
    title: 'Your wallet signs',
    detail: 'The app never asks for a seed phrase or signs a transaction on your behalf.',
  },
  {
    icon: LockKeyIcon,
    title: 'Real cards, on-chain',
    detail:
      'Cards are Collector Crypt assets—real graded collectibles vaulted and tokenized on Solana.',
  },
  {
    icon: CheckCircleIcon,
    title: 'Verifiable outcomes',
    detail: 'Match data, scoring rules, fees, and final chain state stay inspectable end to end.',
  },
] as const;

export default function LandingPage() {
  return (
    <main>
      <section className="marketing-hero">
        <div className="hero-grid" aria-hidden="true" />
        <header className="marketing-nav">
          <a href="/" className="brand" aria-label="Grail home">
            <span className="brand-mark">
              <span />
              <span />
            </span>
            <span>GRAIL</span>
          </a>
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#trust">Trust</a>
            <a href="https://github.com/dailydraft/escrow">Open escrow</a>
          </nav>
          <a className="nav-cta" href={appUrl}>
            Enter the arena <ArrowRightIcon size={15} weight="bold" />
          </a>
        </header>

        <div className="hero-content">
          <div className="hero-copy">
            <span className="eyebrow">
              <SparkleIcon size={14} weight="fill" /> Sports fantasy casino on Solana
            </span>
            <h1>
              Own the cards.
              <br />
              <em>Field the squad.</em>
            </h1>
            <p>
              Rip real, vaulted sports cards from Collector Crypt, build a squad across football,
              soccer, baseball, and basketball, and win tournaments scored by live match data.
            </p>
            <div className="hero-actions">
              <a className="primary-cta" href={appUrl}>
                Start playing <TrophyIcon size={18} weight="fill" />
              </a>
              <a className="secondary-cta" href="#how-it-works">
                See how it works
              </a>
            </div>
            <div className="hero-proof">
              <span>
                <WalletIcon size={15} /> Wallet confirmed
              </span>
              <span>
                <LockKeyIcon size={15} /> Real vaulted cards
              </span>
              <span>
                <CheckCircleIcon size={15} /> Scored on match data
              </span>
            </div>
          </div>

          <section
            className="duel-visual"
            aria-label="Preview of a Collector Crypt sports pack rip"
          >
            <div className="duel-status">
              <span className="live-dot" /> COLLECTOR CRYPT · SPORTS PACK
              <span>DEVNET</span>
            </div>
            <div className="duel-stage">
              <article className="preview-pack preview-pack-left">
                <span className="pack-owner">8xK4…p2Te</span>
                <div className="pack-art">
                  <SparkleIcon size={36} weight="fill" />
                  <small>GRADED · VAULTED</small>
                  <strong>FOOTBALL</strong>
                  <strong>PACK</strong>
                  <span>$100</span>
                </div>
              </article>
              <div className="versus">
                <span>RIP</span>
              </div>
              <article className="preview-pack preview-pack-right">
                <span className="pack-owner">Boba.sol</span>
                <div className="pack-art">
                  <TrophyIcon size={36} weight="fill" />
                  <small>GRADED · VAULTED</small>
                  <strong>HOOPS</strong>
                  <strong>PACK</strong>
                  <span>$100</span>
                </div>
              </article>
            </div>
            <div className="duel-footer">
              <span>
                <UsersThreeIcon size={15} /> Squad forming
              </span>
              <span>Locks at kickoff in 03</span>
            </div>
          </section>
        </div>
      </section>

      <section className="signal-strip" aria-label="Product principles">
        <span>REAL COLLECTOR CRYPT CARDS</span>
        <span>LIVE MATCH SCORING</span>
        <span>AUTO-ENTERED TOURNAMENTS</span>
        <span>SHAREABLE RESULTS</span>
      </section>

      <section id="how-it-works" className="section-shell process-section">
        <div className="section-heading">
          <span className="eyebrow">The fantasy loop</span>
          <h2>Pack opening becomes a season.</h2>
          <p>
            The thrill of a rip, the strategy of a fantasy squad, and results that settle on real
            games—one loop that keeps giving you a reason to come back.
          </p>
        </div>
        <div className="step-grid">
          {steps.map((step) => (
            <article key={step.number} className="step-card">
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="trust" className="section-shell trust-section">
        <div className="trust-copy">
          <span className="eyebrow">Built to be checked</span>
          <h2>Excitement without a black box.</h2>
          <p>
            Every value-bearing step is designed around explicit wallet approval, public program
            rules, and evidence you can verify independently.
          </p>
          <a href="https://github.com/dailydraft/escrow">
            Inspect the escrow repository <ArrowRightIcon size={16} />
          </a>
        </div>
        <div className="principle-grid">
          {principles.map(({ icon: Icon, title, detail }) => (
            <article key={title} className="principle-card">
              <Icon size={22} weight="duotone" />
              <div>
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section-shell social-section">
        <div className="social-card">
          <div>
            <span className="eyebrow">
              <XLogoIcon size={14} weight="fill" /> Built to travel
            </span>
            <h2>Every tournament becomes a story.</h2>
            <p>
              Squad locked, players scoring, finished on the podium—each result gets a shareable
              card that pulls the next collector into the arena.
            </p>
          </div>
          <div className="share-preview" aria-hidden="true">
            <span className="result-chip">ILLUSTRATIVE SHARE CARD</span>
            <strong>Matchday 6 · 1st</strong>
            <b>+$1,380</b>
            <small>Top forward finish · $100 squad</small>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <span className="eyebrow">The arena is open</span>
        <h2>Think your squad wins?</h2>
        <p>
          Try the devnet build with real wallet signatures and on-chain settlement. Demo assets have
          no real-world value.
        </p>
        <a className="primary-cta" href={appUrl}>
          Play Grail <ArrowRightIcon size={18} weight="bold" />
        </a>
      </section>

      <footer className="marketing-footer">
        <a href="/" className="brand" aria-label="Grail home">
          <span className="brand-mark brand-mark-small">
            <span />
            <span />
          </span>
          <span>GRAIL</span>
        </a>
        <p>
          Devnet preview. Wallet signatures and settlement are real; demo assets have no real-world
          value.
        </p>
        <div>
          <a href="https://github.com/dailydraft">GitHub</a>
          <a href={appUrl}>Demo</a>
        </div>
      </footer>
    </main>
  );
}
