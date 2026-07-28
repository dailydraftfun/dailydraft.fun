import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { PublicDuelReceipt } from '../../duel/public-proof-client';

mock.module('server-only', () => ({}));

const { metadata } = await import('./page');
const { resolveDuelRouteEntry } = await import('./route-entry');

function receipt(
  status: PublicDuelReceipt['duel']['status'],
  mode: PublicDuelReceipt['duel']['mode'] = 'direct',
): PublicDuelReceipt {
  return {
    duel: { id: 'duel_shared', mode, status },
    pack: { tier: { amount: '50000000', currency: 'USDC', decimals: 6 } },
    participants: {
      creator: { display: 'Creator abcd…wxyz' },
      opponent: { display: 'Opponent abcd…wxyz' },
    },
  } as PublicDuelReceipt;
}

describe('canonical Duel Arena route', () => {
  test('publishes no-index Devnet metadata', () => {
    expect(metadata.title).toBe('Duel Arena — DailyDraft Devnet');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });

  test('places the canonical browse-first rules before the live arena', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

    expect(source.indexOf('<GameRulesOverview mode="duel" />')).toBeGreaterThan(-1);
    expect(source.indexOf('<GameRulesOverview mode="duel" />')).toBeLessThan(
      source.indexOf('<DuelArena'),
    );
  });

  test('preserves the challenge entry behavior', async () => {
    const requestedIds: string[] = [];
    const entry = await resolveDuelRouteEntry(
      { challenge: ['duel_challenge', 'ignored'] },
      async (duelId) => {
        requestedIds.push(duelId);
        return receipt('waiting');
      },
    );

    expect(requestedIds).toEqual(['duel_challenge']);
    expect(entry).toEqual({
      action: 'accept',
      duelId: 'duel_shared',
      mode: 'direct',
      opponentLabel: 'Creator abcd…wxyz',
      tier: 50,
    });
  });

  test('falls through an unusable challenge to a valid rematch', async () => {
    const requestedIds: string[] = [];
    const entry = await resolveDuelRouteEntry(
      { challenge: 'duel_closed', rematch: 'duel_settled' },
      async (duelId) => {
        requestedIds.push(duelId);
        return receipt(duelId === 'duel_closed' ? 'settled' : 'settled');
      },
    );

    expect(requestedIds).toEqual(['duel_closed', 'duel_settled']);
    expect(entry?.action).toBe('rematch');
    expect(entry?.duelId).toBe('duel_shared');
  });

  test('opens the plain lobby when no shared receipt can be used', async () => {
    const entry = await resolveDuelRouteEntry({ challenge: 'duel_missing' }, async () => null);

    expect(entry).toBeNull();
  });
});
