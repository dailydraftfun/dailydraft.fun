import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PublicDuelLeaderboard } from '../duel/public-proof-client';

mock.module('server-only', () => ({}));

const { default: LeaderboardPage, metadata } = await import('./page');

describe('leaderboard page contract', () => {
  test('publishes the rebranded, no-index leaderboard metadata', () => {
    expect(metadata.title).toBe('Devnet leaderboard — DailyDraft');
    expect(metadata.description).toBe(
      'Pseudonymous standings from settled, non-mock Card Duel results on Solana devnet.',
    );
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });

  test('renders the leaderboard view when a durable snapshot is available', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json(leaderboard())) as typeof fetch;

    try {
      const markup = renderToStaticMarkup(await LeaderboardPage());
      expect(markup).toContain('Devnet leaderboard');
      expect(markup).toContain('#1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fails closed to the unavailable view when no snapshot is returned', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;

    try {
      const markup = renderToStaticMarkup(await LeaderboardPage());
      expect(markup).toContain('Standings could not be loaded safely');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function leaderboard(): PublicDuelLeaderboard {
  return {
    entries: [
      {
        display: '9xQe…9gJ1',
        lastPlayedAt: '2026-07-20T02:00:00.000Z',
        profileHref: '/profile/9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1',
        rank: 1,
        record: { completed: 4, losses: 1, ties: 0, wins: 3 },
        totalWonValue: { amount: '320000000', currency: 'USDC', decimals: 6 },
      },
    ],
    methodology: {
      entryLimit: 50,
      excludesMockResults: true,
      hasMoreSettledDuels: false,
      ranking: 'wins-total-value-completed-recency',
      sampleLimit: 5_000,
      sampledSettledDuels: 1,
    },
    privacy: {
      indexable: false,
      reason: 'Pseudonymous test fixture.',
    },
    schemaVersion: 'dailydraft.leaderboard.v1',
  };
}
