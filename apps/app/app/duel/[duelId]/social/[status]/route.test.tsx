import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PublicDuelReceipt } from '../../../public-proof-client';
import type { DuelSocialPull, DuelSocialSnapshot } from '../../../social-card-data';

let receipt: PublicDuelReceipt | null = null;
let snapshot: DuelSocialSnapshot = socialSnapshot();
let captured: { element: React.ReactElement; options: ResponseInit } | null = null;

// next/og only renders inside the edge runtime, so the card element is captured here
// and rendered with react-dom/server instead.
mock.module('next/og', () => ({
  ImageResponse: class {
    constructor(element: React.ReactElement, options: ResponseInit) {
      captured = { element, options };
    }
  },
}));

mock.module('../../../public-proof-client', () => ({
  fetchPublicDuelReceipt: async () => receipt,
}));

// The snapshot derivation is covered by its own tests; stubbing it keeps this file
// focused on what the shared card actually renders.
mock.module('../../../social-card-data', () => ({
  getDuelSocialSnapshot: () => snapshot,
  resolveDuelStatus: (value: string) => value,
}));

const { GET, runtime } = await import('./route');

function pull(overrides: Partial<DuelSocialPull> = {}): DuelSocialPull {
  return {
    displayName: 'Charizard',
    side: 'creator',
    value: '$72.50',
    winner: true,
    ...overrides,
  };
}

function socialSnapshot(overrides: Partial<DuelSocialSnapshot> = {}): DuelSocialSnapshot {
  return {
    accent: '#d8ff3e',
    badge: 'SETTLED',
    duelId: 'duel-1',
    headline: 'Creator wins the pull',
    mockPreview: false,
    network: 'devnet',
    opponent: '2222…2222',
    opponentType: 'wallet',
    player: '1111…1111',
    primaryAction: { href: '/duel/duel-1', label: 'View receipt' },
    pulls: [pull(), pull({ displayName: 'Blastoise', side: 'opponent', winner: false })],
    requestedStatusMatches: true,
    status: 'settled',
    subline: 'Proof is on devnet.',
    tier: '$50',
    totalValue: '$100.00',
    valuationPolicy: 'dailydraft-pokemon-tcg-market-usdc-v1',
    winner: '1111…1111',
    ...overrides,
  };
}

async function renderCard(status = 'settled'): Promise<string> {
  captured = null;
  await GET(new Request(`https://dailydraft.fun/duel/duel-1/social/${status}`), {
    params: Promise.resolve({ duelId: 'duel-1', status }),
  });
  if (!captured) throw new Error('The social card route never produced an image.');
  return renderToStaticMarkup(captured.element);
}

describe('duel social card route', () => {
  test('renders on the edge so shared links resolve close to the viewer', () => {
    expect(runtime).toBe('edge');
  });

  test('shows both pulls side by side once a duel has settled', async () => {
    receipt = { result: { winnerSide: 'creator' } } as unknown as PublicDuelReceipt;
    snapshot = socialSnapshot();

    const markup = await renderCard();

    expect(markup).toContain('Charizard');
    expect(markup).toContain('Blastoise');
    expect(markup).toContain('VS');
    expect(captured?.options.headers).toMatchObject({ 'X-Dailydraft-Status': 'settled' });
  });

  test('withholds the pull matchup while a duel is still open', async () => {
    receipt = { result: null } as unknown as PublicDuelReceipt;
    snapshot = socialSnapshot({
      badge: 'WAITING',
      headline: 'Waiting for an opponent',
      pulls: [],
      status: 'waiting',
      winner: null,
    });

    const markup = await renderCard('waiting');

    expect(markup).not.toContain('Charizard');
    expect(markup).not.toContain('VS');
    expect(markup).toContain('Waiting for an opponent');
  });

  test('brands every shared card as DailyDraft rather than the retired name', async () => {
    receipt = { result: { winnerSide: 'creator' } } as unknown as PublicDuelReceipt;
    snapshot = socialSnapshot();

    const markup = await renderCard();

    expect(markup).toContain('DailyDraft');
    expect(markup).toContain('DAILYDRAFT');
    expect(markup.toUpperCase()).not.toContain('PACK DUEL');
  });

  test('answers an unknown duel with a branded not-found card instead of a crash', async () => {
    receipt = null;

    const markup = await renderCard();

    expect(captured?.options.status).toBe(404);
    expect(markup).toContain('DAILYDRAFT · DEVNET');
    expect(markup).toContain('Proof unavailable');
  });
});
