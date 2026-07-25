import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PublicWalletProfile } from '../../duel/public-proof-client';

mock.module('server-only', () => ({}));

const { default: WalletProfilePage, generateMetadata } = await import('./page');

describe('wallet profile page contract', () => {
  test('publishes rebranded metadata and history copy for a known wallet', async () => {
    const originalFetch = globalThis.fetch;
    const wallet = 'wallet_profile_metadata_present';
    globalThis.fetch = (async () => Response.json(profile(wallet))) as unknown as typeof fetch;

    try {
      const metadata = await generateMetadata({ params: Promise.resolve({ wallet }) });

      expect(metadata.title).toBe('9xQe…9gJ1 — DailyDraft');
      expect(metadata.description).toBe(
        'Pseudonymous Card Duel history for 9xQe…9gJ1 on Solana devnet.',
      );
      expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('falls back to unavailable metadata for an unknown wallet', async () => {
    const originalFetch = globalThis.fetch;
    const wallet = 'wallet_profile_metadata_missing';
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    try {
      const metadata = await generateMetadata({ params: Promise.resolve({ wallet }) });

      expect(metadata.title).toBe('Wallet profile unavailable — DailyDraft');
      expect(metadata.description).toBe('No durable public wallet history is available.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('renders durable activity for a wallet with a public profile', async () => {
    const originalFetch = globalThis.fetch;
    const wallet = 'wallet_profile_page_present';
    globalThis.fetch = (async () => Response.json(profile(wallet))) as unknown as typeof fetch;

    try {
      const markup = renderToStaticMarkup(
        await WalletProfilePage({ params: Promise.resolve({ wallet }) }),
      );

      expect(markup).toContain('9xQe…9gJ1');
      expect(markup).toContain('Durable activity');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fails closed when no durable profile is available', async () => {
    const originalFetch = globalThis.fetch;
    const wallet = 'wallet_profile_page_missing';
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    try {
      const markup = renderToStaticMarkup(
        await WalletProfilePage({ params: Promise.resolve({ wallet }) }),
      );

      expect(markup).toContain('This wallet has no publicly readable history.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function profile(wallet: string): PublicWalletProfile {
  return {
    biggestWin: null,
    duels: [],
    pagination: { hasMore: false, sampleLimit: 5_000 },
    privacy: { indexable: false, reason: 'Pseudonymous test fixture.' },
    record: {
      active: 0,
      cancelledOrExpired: 0,
      completed: 4,
      losses: 1,
      refunded: 0,
      total: 4,
      wins: 3,
    },
    schemaVersion: 'dailydraft.profile.v1',
    wallet: { address: wallet, display: '9xQe…9gJ1' },
  };
}
