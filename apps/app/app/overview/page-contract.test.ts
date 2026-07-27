import { describe, expect, test } from 'bun:test';
import OverviewPage from './page';
import { buildRedirectTarget } from './redirect-target';
import { buildSharedDuelEntry } from './shared-route-entry';

const participantAddresses = {
  creator: 'creator_sensitive_wallet_address',
  opponent: 'opponent_sensitive_wallet_address',
};

const receipt = {
  duel: { id: 'duel_private', mode: 'direct', status: 'settled' },
  pack: { tier: { amount: '50000000', currency: 'USDC', decimals: 6 } },
  participants: {
    creator: { address: participantAddresses.creator, display: 'Creator abcd…wxyz' },
    opponent: { address: participantAddresses.opponent, display: 'Opponent abcd…wxyz' },
  },
} as const;

describe('overview shared-route boundary', () => {
  test('preserves compatibility-route query parameters for the canonical Duel Arena', () => {
    expect(
      buildRedirectTarget('/games/duel', {
        challenge: 'duel/challenge',
        ref: ['invite one', 'invite two'],
        skipped: undefined,
      }),
    ).toBe('/games/duel?challenge=duel%2Fchallenge&ref=invite+one&ref=invite+two');
    expect(buildRedirectTarget('/games/duel', {})).toBe('/games/duel');
  });

  test('serializes only pseudonymous labels into rematch entry props', () => {
    const serialized = JSON.stringify(buildSharedDuelEntry(receipt, 'rematch'));

    expect(serialized).toContain('Creator abcd…wxyz');
    expect(serialized).toContain('Opponent abcd…wxyz');
    expect(serialized).not.toContain(participantAddresses.creator);
    expect(serialized).not.toContain(participantAddresses.opponent);
  });

  test('serializes only the creator label into challenge entry props', () => {
    const serialized = JSON.stringify(
      buildSharedDuelEntry({ ...receipt, duel: { ...receipt.duel, status: 'waiting' } }, 'accept'),
    );

    expect(serialized).toContain('Creator abcd…wxyz');
    expect(serialized).not.toContain(participantAddresses.creator);
    expect(serialized).not.toContain(participantAddresses.opponent);
  });

  test('executes the compatibility redirect boundary', async () => {
    await expect(
      OverviewPage({ searchParams: Promise.resolve({ challenge: 'duel_123' }) }),
    ).rejects.toThrow();
  });
});
