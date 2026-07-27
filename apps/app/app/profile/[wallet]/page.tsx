import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import {
  fetchPublicWalletProfile,
  formatPublicMoney,
  type PublicWalletProfile,
} from '../../duel/public-proof-client';

type WalletProfilePageProps = { params: Promise<{ wallet: string }> };

const getProfile = cache(fetchPublicWalletProfile);

export async function generateMetadata({ params }: WalletProfilePageProps): Promise<Metadata> {
  const { wallet } = await params;
  const profile = await getProfile(wallet);

  return {
    title: profile
      ? `${profile.wallet.display} — DailyDraft`
      : 'Wallet profile unavailable — DailyDraft',
    description: profile
      ? `Pseudonymous Card Duel history for ${profile.wallet.display} on Solana devnet.`
      : 'No durable public wallet history is available.',
    robots: { follow: false, index: false, nocache: true },
  };
}

export default async function WalletProfilePage({ params }: WalletProfilePageProps) {
  const { wallet } = await params;
  const profile = await getProfile(wallet);
  if (!profile) return <UnavailableProfile />;

  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl flex-col gap-7 px-4 py-10 sm:px-6">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="proof-label">Pseudonymous devnet profile</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-primary sm:text-5xl">
            {profile.wallet.display}
          </h1>
          <p className="mt-3 max-w-2xl break-all font-mono text-xs leading-5 text-secondary">
            {profile.wallet.address}
          </p>
        </div>
        <Link href="/games/duel" className="proof-primary-action">
          Start a duel
        </Link>
      </header>

      <section className="proof-stat-grid">
        <ProfileStat label="Record" value={`${profile.record.wins}–${profile.record.losses}`} />
        <ProfileStat label="Completed" value={profile.record.completed.toString()} />
        <ProfileStat label="Active" value={profile.record.active.toString()} />
        <ProfileStat label="Refunded" value={profile.record.refunded.toString()} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="proof-panel">
          <p className="proof-label">Biggest recorded win</p>
          {profile.biggestWin ? (
            <>
              <p className="mt-3 text-2xl font-semibold text-lime">
                {formatPublicMoney(profile.biggestWin.prizeValue)}
              </p>
              <Link
                href={`/duel/${encodeURIComponent(profile.biggestWin.duelId)}`}
                className="mt-4 inline-block text-sm font-semibold text-primary hover:text-lime"
              >
                Inspect receipt
              </Link>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6 text-secondary">No completed win is recorded.</p>
          )}
        </article>
        <article className="proof-panel">
          <p className="proof-label">Activity summary</p>
          <dl className="proof-definition-list mt-4">
            <div>
              <dt>Total sampled</dt>
              <dd>{profile.record.total}</dd>
            </div>
            <div>
              <dt>Cancelled / expired</dt>
              <dd>{profile.record.cancelledOrExpired}</dd>
            </div>
            <div>
              <dt>History window</dt>
              <dd>{profile.pagination.sampleLimit}</dd>
            </div>
          </dl>
          {profile.pagination.hasMore ? (
            <p className="mt-4 text-xs leading-5 text-secondary">
              This profile is a bounded recent-history summary, not an all-time claim.
            </p>
          ) : null}
        </article>
      </section>

      <section className="proof-panel">
        <div>
          <p className="proof-label">Recent duels</p>
          <h2 className="mt-2 text-xl font-semibold text-primary">Durable activity</h2>
        </div>
        {profile.duels.length > 0 ? (
          <ul className="mt-5 grid gap-3">
            {profile.duels.map((duel) => (
              <ProfileDuel key={duel.duelId} duel={duel} />
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm leading-6 text-secondary">
            No duels are recorded for this wallet.
          </p>
        )}
      </section>

      <p className="text-xs leading-5 text-secondary">
        Privacy: {profile.privacy.reason} Wallet addresses remain public Solana identifiers; the UI
        uses shortened labels and this page is excluded from indexing.
      </p>
    </main>
  );
}

function ProfileDuel({ duel }: { duel: PublicWalletProfile['duels'][number] }) {
  return (
    <li className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-primary p-4 sm:flex-row sm:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary">
            {duel.status}
          </span>
          {duel.result !== 'none' ? (
            <span className={duel.result === 'win' ? 'text-lime' : 'text-secondary'}>
              {duel.result}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-sm font-semibold text-primary">
          {duel.packName} · {formatPublicMoney(duel.tier)}
        </p>
        <p className="mt-1 text-xs text-secondary">
          {duel.opponentDisplay ? `vs ${duel.opponentDisplay}` : 'Waiting for an opponent'} ·{' '}
          {new Date(duel.createdAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={duel.receiptHref} className="proof-secondary-action">
          View receipt
        </Link>
        {duel.rematchHref ? (
          <Link href={duel.rematchHref} className="proof-primary-action">
            Rematch
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="proof-label">{label}</p>
      <p className="mt-2 text-xl font-semibold text-primary">{value}</p>
    </div>
  );
}

function UnavailableProfile() {
  return (
    <main className="mx-auto min-h-[calc(100svh-4rem)] max-w-3xl px-4 py-16 sm:px-6">
      <p className="proof-label">Profile unavailable</p>
      <h1 className="mt-3 text-3xl font-semibold text-primary">
        This wallet has no publicly readable history.
      </h1>
      <p className="mt-4 text-sm leading-6 text-secondary">
        No durable profile summary was returned. No duel record or wallet activity is inferred.
      </p>
      <Link href="/games/duel" className="proof-primary-action mt-6">
        Back to duels
      </Link>
    </main>
  );
}
