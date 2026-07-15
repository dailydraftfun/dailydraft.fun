import {
  ArrowRightIcon,
  CheckCircleIcon,
  LockKeyIcon,
  SparkleIcon,
  SwordIcon,
  TrophyIcon,
  UsersThreeIcon,
  WalletIcon,
  XLogoIcon,
} from '@phosphor-icons/react/dist/ssr';

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://openpacksduel.vercel.app';

const steps = [
  {
    number: '01',
    title: 'Choose a pack',
    detail: 'Pick the same eligible pack and stake on both sides of the duel.',
  },
  {
    number: '02',
    title: 'Find an opponent',
    detail: 'Match instantly with another wallet or send a direct challenge to a friend.',
  },
  {
    number: '03',
    title: 'Rip together',
    detail: 'Both packs reveal in sync. The higher verified card value wins the round.',
  },
  {
    number: '04',
    title: 'Winner takes the cards',
    detail: 'Settlement sends both pulls to the winner after fees and on-chain confirmation.',
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
    title: 'Open escrow',
    detail: 'The Solana escrow program is public so custody and settlement rules can be audited.',
  },
  {
    icon: CheckCircleIcon,
    title: 'Verifiable outcomes',
    detail: 'Provider results, valuation policy, fees, and final chain state stay inspectable.',
  },
] as const;

export default function LandingPage() {
  return (
    <main>
      <section className="marketing-hero">
        <div className="hero-grid" aria-hidden="true" />
        <header className="marketing-nav">
          <a href="/" className="brand" aria-label="Pack Duel home">
            <span className="brand-mark">
              <span />
              <span />
            </span>
            <span>PACK DUEL</span>
          </a>
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#trust">Trust</a>
            <a href="https://github.com/openpacksduel/escrow">Open escrow</a>
          </nav>
          <a className="nav-cta" href={appUrl}>
            Try the demo <ArrowRightIcon size={15} weight="bold" />
          </a>
        </header>

        <div className="hero-content">
          <div className="hero-copy">
            <span className="eyebrow">
              <SparkleIcon size={14} weight="fill" /> Trading card duels on Solana
            </span>
            <h1>
              Two packs.
              <br />
              <em>One winner.</em>
            </h1>
            <p>
              Challenge a friend or match another wallet. Rip the same pack together, compare the
              verified pulls, and let the higher card value take both.
            </p>
            <div className="hero-actions">
              <a className="primary-cta" href={appUrl}>
                Enter the arena <SwordIcon size={18} weight="fill" />
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
                <LockKeyIcon size={15} /> Public escrow
              </span>
              <span>
                <CheckCircleIcon size={15} /> Transparent fees
              </span>
            </div>
          </div>

          <section className="duel-visual" aria-label="Preview of a fifty dollar pack duel">
            <div className="duel-status">
              <span className="live-dot" /> $50 PACK DUEL
              <span>DEMO</span>
            </div>
            <div className="duel-stage">
              <article className="preview-pack preview-pack-left">
                <span className="pack-owner">8xK4…p2Te</span>
                <div className="pack-art">
                  <SparkleIcon size={36} weight="fill" />
                  <small>AUTHENTICATED</small>
                  <strong>PACK</strong>
                  <strong>DUEL</strong>
                  <span>$50</span>
                </div>
              </article>
              <div className="versus">
                <span>VS</span>
              </div>
              <article className="preview-pack preview-pack-right">
                <span className="pack-owner">Boba.sol</span>
                <div className="pack-art">
                  <TrophyIcon size={36} weight="fill" />
                  <small>AUTHENTICATED</small>
                  <strong>PACK</strong>
                  <strong>DUEL</strong>
                  <span>$50</span>
                </div>
              </article>
            </div>
            <div className="duel-footer">
              <span>
                <UsersThreeIcon size={15} /> Opponent found
              </span>
              <span>Opening together in 03</span>
            </div>
          </section>
        </div>
      </section>

      <section className="signal-strip" aria-label="Product principles">
        <span>DIRECT WALLET CHALLENGES</span>
        <span>LIVE MATCHMAKING</span>
        <span>SYNCHRONIZED REVEALS</span>
        <span>SHAREABLE RESULTS</span>
      </section>

      <section id="how-it-works" className="section-shell process-section">
        <div className="section-heading">
          <span className="eyebrow">The duel loop</span>
          <h2>Pack opening gets an opponent.</h2>
          <p>
            The thrill of a rip, the tension of a coin flip, and a result worth sharing—all in one
            fast round.
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
          <a href="https://github.com/openpacksduel/escrow">
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
            <h2>Every duel becomes a story.</h2>
            <p>
              Waiting, matched, opening, won, or lost—each status gets a shareable card that pulls
              the next challenger into the arena.
            </p>
          </div>
          <div className="share-preview" aria-hidden="true">
            <span className="result-chip">DUEL WON</span>
            <strong>Umbreon VMAX</strong>
            <b>$1,380</b>
            <small>Beat a $615 pull · $50 pack tier</small>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <span className="eyebrow">The arena is open</span>
        <h2>Think your pack wins?</h2>
        <p>Try the interactive duel demo. Real wallet and settlement flows are coming next.</p>
        <a className="primary-cta" href={appUrl}>
          Try Pack Duel <ArrowRightIcon size={18} weight="bold" />
        </a>
      </section>

      <footer className="marketing-footer">
        <a href="/" className="brand" aria-label="Pack Duel home">
          <span className="brand-mark brand-mark-small">
            <span />
            <span />
          </span>
          <span>PACK DUEL</span>
        </a>
        <p>Preview product. No real wallet signatures or settlement are enabled in the demo.</p>
        <div>
          <a href="https://github.com/openpacksduel">GitHub</a>
          <a href={appUrl}>Demo</a>
        </div>
      </footer>
    </main>
  );
}
