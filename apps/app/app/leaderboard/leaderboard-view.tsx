import Link from 'next/link';
import { formatPublicMoney } from '../duel/public-money';
import type { PublicDuelLeaderboard } from '../duel/public-proof-client';

export function LeaderboardView({ leaderboard }: { leaderboard: PublicDuelLeaderboard }) {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl flex-col gap-7 px-4 py-10 sm:px-6">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="proof-label">Settled non-mock results</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-primary sm:text-5xl">
            Devnet leaderboard
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary">
            Ranked by wins, total value won, completed duels, then most recent play. Mock previews
            never count toward the standings.
          </p>
        </div>
        <Link href="/games/duel" className="proof-primary-action">
          Start a duel
        </Link>
      </header>

      {leaderboard.entries.length > 0 ? (
        <section aria-labelledby="standings-title" className="proof-panel overflow-hidden p-0">
          <div className="border-b border-border px-5 py-4 sm:px-6">
            <p className="proof-label">Current standings</p>
            <h2 id="standings-title" className="mt-2 text-xl font-semibold text-primary">
              Top players
            </h2>
          </div>
          <ol className="divide-y divide-border">
            {leaderboard.entries.map((entry) => (
              <LeaderboardRow key={entry.profileHref} entry={entry} />
            ))}
          </ol>
        </section>
      ) : (
        <section className="proof-panel text-center">
          <p className="proof-label">Standings are empty</p>
          <h2 className="mt-3 text-2xl font-semibold text-primary">No ranked players yet.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-secondary">
            The first settled duel backed by non-mock provider results will open the leaderboard.
            Mock previews and incomplete proofs are intentionally excluded.
          </p>
          <Link href="/games/duel" className="proof-primary-action mt-6">
            Play the first ranked duel
          </Link>
        </section>
      )}

      <details className="proof-panel">
        <summary className="cursor-pointer text-sm font-semibold text-primary">
          How ranking works
        </summary>
        <dl className="proof-definition-list mt-5">
          <div>
            <dt>Settled duels counted</dt>
            <dd>{leaderboard.methodology.sampledSettledDuels}</dd>
          </div>
          <div>
            <dt>History window</dt>
            <dd>Latest {leaderboard.methodology.sampleLimit.toLocaleString()} settled duels</dd>
          </div>
          <div>
            <dt>Maximum displayed</dt>
            <dd>{leaderboard.methodology.entryLimit} players</dd>
          </div>
          <div>
            <dt>Mock results</dt>
            <dd>Excluded</dd>
          </div>
        </dl>
        {leaderboard.methodology.hasMoreSettledDuels ? (
          <p className="mt-4 text-sm leading-6 text-secondary">
            More settled duels exist outside this bounded window, so these are recent standings
            rather than an all-time claim.
          </p>
        ) : null}
        <p className="mt-4 text-sm leading-6 text-secondary">
          Privacy: {leaderboard.privacy.reason}
        </p>
      </details>
    </main>
  );
}

export function LeaderboardUnavailable() {
  return (
    <main className="mx-auto min-h-[calc(100svh-4rem)] max-w-3xl px-4 py-16 sm:px-6">
      <p className="proof-label">Leaderboard unavailable</p>
      <h1 className="mt-3 text-3xl font-semibold text-primary">
        Standings could not be loaded safely.
      </h1>
      <p className="mt-4 text-sm leading-6 text-secondary">
        The API returned no durable leaderboard snapshot. No rank or player record is inferred.
      </p>
      <Link href="/leaderboard" className="proof-primary-action mt-6">
        Try again
      </Link>
    </main>
  );
}

function LeaderboardRow({ entry }: { entry: PublicDuelLeaderboard['entries'][number] }) {
  return (
    <li className="grid gap-4 px-5 py-5 sm:grid-cols-[3rem_minmax(0,1fr)_auto_auto] sm:items-center sm:px-6">
      <div className="flex items-center gap-3 sm:block">
        <span className="proof-label sm:hidden">Rank</span>
        <strong className="font-mono text-xl text-lime">#{entry.rank}</strong>
      </div>
      <div className="min-w-0">
        <Link
          className="font-mono text-base font-semibold text-primary hover:text-lime"
          href={entry.profileHref}
        >
          {entry.display}
        </Link>
        <p className="mt-1 text-sm text-secondary">
          {entry.record.wins}W · {entry.record.losses}L · {entry.record.ties}T
        </p>
        <p className="mt-1 text-sm text-secondary">
          Last played {new Date(entry.lastPlayedAt).toLocaleDateString()}
        </p>
      </div>
      <LeaderboardMetric label="Value won" value={formatPublicMoney(entry.totalWonValue)} />
      <LeaderboardMetric
        label="Win rate"
        value={formatWinRate(entry.record.wins, entry.record.completed)}
      />
    </li>
  );
}

function LeaderboardMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:min-w-28 sm:text-right">
      <p className="proof-label">{label}</p>
      <p className="mt-1 text-sm font-semibold text-primary">{value}</p>
    </div>
  );
}

function formatWinRate(wins: number, completed: number): string {
  return completed === 0 ? '0%' : `${Math.round((wins / completed) * 100)}%`;
}
