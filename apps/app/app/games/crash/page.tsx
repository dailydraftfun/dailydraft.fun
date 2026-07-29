import type { Metadata } from 'next';
import Link from 'next/link';
import { CardStreakGame } from './card-streak-game';

export const metadata: Metadata = {
  description:
    'Play a deterministic four-card risk loop on DailyDraft devnet. Continue, cash out, bust, and replay without a wallet, funds, custody, or settlement.',
  robots: { follow: false, index: false, nocache: true },
  title: 'Card Streak — DailyDraft Devnet',
};

export default function CardStreakPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1180px] gap-5 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="proof-label">Playable devnet fixture</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-primary sm:text-5xl">
            Build the streak. Know when to leave.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">
            Every card grows your demo score. End the run safely—or keep pushing until the fixed
            path breaks.
          </p>
        </div>
        <Link className="proof-secondary-action" href="/games">
          All games
        </Link>
      </header>

      <CardStreakGame />
    </main>
  );
}
