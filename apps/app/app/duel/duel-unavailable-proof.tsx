import Link from 'next/link';

export function DuelUnavailableProof({ duelId }: { duelId: string }) {
  return (
    <main className="mx-auto min-h-[calc(100svh-4rem)] max-w-3xl px-4 py-16 sm:px-6">
      <p className="proof-label">Proof unavailable</p>
      <h1 className="mt-3 text-3xl font-semibold text-primary">
        This duel is not publicly readable yet.
      </h1>
      <p className="mt-4 text-sm leading-6 text-secondary">
        The API returned no durable public receipt for <code>{duelId}</code>. No status or result is
        inferred.
      </p>
      <Link href="/overview" className="proof-secondary-action mt-6">
        Back to duels
      </Link>
    </main>
  );
}
