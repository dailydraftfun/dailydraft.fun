import type { VerifiedGameActivityPage } from '@dailydraft/contracts/game-lobby';
import Link from 'next/link';
import { VerifiedActivity } from './verified-activity';

export function ActivityPreview({
  initialPage,
  initialState,
}: {
  initialPage?: VerifiedGameActivityPage;
  initialState?: 'degraded' | 'empty' | 'loading' | 'ready' | 'stale' | 'unavailable';
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-7rem)] max-w-6xl flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
      <header className="border-b border-border pb-7">
        <p className="proof-label">Activity</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-primary sm:text-5xl">
          Recent play.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-secondary">
          Browse completed games, open their receipts, and jump into a rematch.
        </p>
      </header>

      <VerifiedActivity initialPage={initialPage} initialState={initialState} />

      <div className="flex flex-wrap gap-3">
        <Link className="proof-primary-action" href="/games">
          Back to games
        </Link>
        <Link className="proof-secondary-action" href="/games/duel">
          Open Duel Arena
        </Link>
      </div>
    </main>
  );
}
