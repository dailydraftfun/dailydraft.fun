import type { Metadata } from 'next';
import { DuelArena } from '../../duel-arena';
import { type DuelRouteSearchParams, resolveDuelRouteEntry } from './route-entry';

type DuelPageProps = {
  searchParams: Promise<DuelRouteSearchParams>;
};

export const metadata: Metadata = {
  title: 'Duel Arena — DailyDraft Devnet',
  description: 'Challenge another collector to a server-owned sports card duel on Solana devnet.',
  robots: { follow: false, index: false, nocache: true },
};

export default async function DuelPage({ searchParams }: DuelPageProps) {
  const query = await searchParams;
  const entry = await resolveDuelRouteEntry(query);
  const entryKey = entry ? `${entry.action}:${entry.duelId}` : 'duel-lobby';

  return <DuelArena key={entryKey} entry={entry ?? undefined} />;
}
