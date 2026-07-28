import type { Metadata } from 'next';
import { DuelArena } from '../../duel-arena';
import { type DuelRouteSearchParams, resolveDuelRouteEntry } from './route-entry';

type DuelPageProps = {
  searchParams: Promise<DuelRouteSearchParams>;
};

export const metadata: Metadata = {
  title: 'Duel Arena — DailyDraft Devnet',
  description:
    'Compare server-provided DailyDraft demo pulls on Solana devnet. Demo-pool value is not charged or purchased; each participant approves only the displayed test-SOL platform fee.',
  robots: { follow: false, index: false, nocache: true },
};

export default async function DuelPage({ searchParams }: DuelPageProps) {
  const query = await searchParams;
  const entry = await resolveDuelRouteEntry(query);
  const entryKey = entry ? `${entry.action}:${entry.duelId}` : 'duel-lobby';

  return <DuelArena key={entryKey} entry={entry ?? undefined} />;
}
