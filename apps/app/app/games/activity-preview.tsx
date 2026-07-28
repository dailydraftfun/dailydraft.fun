import type { VerifiedGameActivityPage } from '@dailydraft/contracts/game-lobby';
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/ssr';
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
      <header className="grid gap-5 border-b border-border pb-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div>
          <p className="proof-label">Public activity · settled proof only</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-primary sm:text-5xl">
            Recent play you can verify.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-secondary">
            This bounded feed publishes completed games only after their canonical receipt and RGS
            proof agree. Flip and Card Streak remain absent until their engines produce equivalent
            finalized evidence.
          </p>
        </div>
        <div className="rounded-xl border border-lime/20 bg-lime/5 p-5">
          <div className="flex items-center gap-3 text-lime">
            <ShieldCheckIcon aria-hidden="true" size={22} weight="fill" />
            <strong className="text-sm">No fabricated live counts</strong>
          </div>
          <p className="mt-3 text-xs leading-5 text-secondary">
            Public labels are pseudonyms. Raw wallet addresses, unsettled outcomes, fake players,
            urgency timers, and inferred jackpots are excluded.
          </p>
        </div>
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
