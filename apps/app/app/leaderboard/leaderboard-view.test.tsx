import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PublicDuelLeaderboard } from '../duel/public-proof-client';
import { LeaderboardUnavailable, LeaderboardView } from './leaderboard-view';

describe('leaderboard view', () => {
  test('renders ranked records, public profiles, and transparent methodology', () => {
    const markup = renderToStaticMarkup(
      <LeaderboardView
        leaderboard={leaderboard([
          {
            display: '9xQe…9gJ1',
            lastPlayedAt: '2026-07-20T02:00:00.000Z',
            profileHref: '/profile/9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1',
            rank: 1,
            record: { completed: 4, losses: 1, ties: 0, wins: 3 },
            totalWonValue: { amount: '320000000', currency: 'USDC', decimals: 6 },
          },
        ])}
      />,
    );

    expect(markup).toContain('Devnet leaderboard');
    expect(markup).toContain('#1');
    expect(markup).toContain('3W · 1L · 0T');
    expect(markup).toContain('Last played');
    expect(markup).toContain('USDC 320');
    expect(markup).toContain('75%');
    expect(markup).toContain('href="/profile/9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1"');
    expect(markup).toContain('Mock results');
    expect(markup).toContain('Excluded');
  });

  test('renders an honest empty state when no non-mock result qualifies', () => {
    const markup = renderToStaticMarkup(<LeaderboardView leaderboard={leaderboard([])} />);

    expect(markup).toContain('No ranked players yet');
    expect(markup).toContain('Mock previews and incomplete proofs are intentionally excluded');
    expect(markup).not.toContain('#1');
  });

  test('fails closed when no durable snapshot is available', () => {
    const markup = renderToStaticMarkup(<LeaderboardUnavailable />);

    expect(markup).toContain('Standings could not be loaded safely');
    expect(markup).toContain('No rank or player record is inferred');
    expect(markup).toContain('href="/leaderboard"');
  });
});

function leaderboard(entries: PublicDuelLeaderboard['entries']): PublicDuelLeaderboard {
  return {
    entries,
    methodology: {
      entryLimit: 50,
      excludesMockResults: true,
      hasMoreSettledDuels: false,
      ranking: 'wins-total-value-completed-recency',
      sampleLimit: 5_000,
      sampledSettledDuels: entries.length,
    },
    privacy: {
      indexable: false,
      reason: 'Pseudonymous test fixture.',
    },
    schemaVersion: 'openpacksduel.leaderboard.v1',
  };
}
