import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  duelStatuses,
  getDuelSocialSnapshot,
  getSocialDescription,
  resolveDuelStatus,
} from '../social-card-data';

type DuelPageProps = {
  params: Promise<{ duelId: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
};

export async function generateMetadata({ params, searchParams }: DuelPageProps): Promise<Metadata> {
  const [{ duelId }, query] = await Promise.all([params, searchParams]);
  const status = resolveDuelStatus(query.status);
  const snapshot = getDuelSocialSnapshot(duelId, status);
  const encodedDuelId = encodeURIComponent(duelId);
  const pageUrl = `/duel/${encodedDuelId}?status=${status}`;
  const imageUrl = `/duel/${encodedDuelId}/social/${status}`;
  const description = getSocialDescription(snapshot);

  return {
    title: `${snapshot.badge} — Pack Duel`,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title: snapshot.headline,
      description,
      url: pageUrl,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${snapshot.badge}: ${snapshot.headline}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: snapshot.headline,
      description,
      images: [imageUrl],
    },
  };
}

export default async function DuelPage({ params, searchParams }: DuelPageProps) {
  const [{ duelId }, query] = await Promise.all([params, searchParams]);
  const status = resolveDuelStatus(query.status);
  const snapshot = getDuelSocialSnapshot(duelId, status);
  const imageUrl = `/duel/${encodeURIComponent(duelId)}/social/${status}`;

  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-lime">
            Shareable duel status
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-primary sm:text-5xl">
            {snapshot.headline}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary sm:text-base">
            {snapshot.subline}
          </p>
        </div>
        <Link
          href="/overview"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-lime px-4 text-sm font-semibold text-black transition hover:brightness-110"
        >
          Open Pack Duel
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-secondary shadow-2xl shadow-black/40">
        <Image
          src={imageUrl}
          width={1200}
          height={630}
          priority
          alt={`${snapshot.badge}: ${snapshot.headline}`}
          className="h-auto w-full"
          unoptimized
        />
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Preview duel status cards">
        {duelStatuses.map((candidate) => (
          <Link
            key={candidate}
            href={`/duel/${encodeURIComponent(duelId)}?status=${candidate}`}
            aria-current={candidate === status ? 'page' : undefined}
            className={
              candidate === status
                ? 'rounded-md bg-lime px-3 py-2 font-mono text-xs font-semibold uppercase text-black'
                : 'rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs font-semibold uppercase text-secondary transition hover:border-border-strong hover:text-primary'
            }
          >
            {candidate}
          </Link>
        ))}
      </nav>
    </main>
  );
}
