import type { Metadata } from 'next';
import { cache } from 'react';

import { fetchPublicDuelLeaderboard } from '../duel/public-proof-client';
import { LeaderboardUnavailable, LeaderboardView } from './leaderboard-view';

export const metadata: Metadata = {
  title: 'Devnet leaderboard — Pack Duel',
  description: 'Pseudonymous standings from settled, non-mock Pack Duel results on Solana devnet.',
  robots: { follow: false, index: false, nocache: true },
};

const getLeaderboard = cache(fetchPublicDuelLeaderboard);

export default async function LeaderboardPage() {
  const leaderboard = await getLeaderboard();
  return leaderboard ? <LeaderboardView leaderboard={leaderboard} /> : <LeaderboardUnavailable />;
}
