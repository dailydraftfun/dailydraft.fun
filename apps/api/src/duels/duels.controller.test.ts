import { describe, expect, test } from 'bun:test';

import { assertWalletActor, resolvePrivateRematchOpponent } from './duels.controller.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OTHER_WALLET = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const SPECTATOR_WALLET = '7YWHMfk9JZe0LMdzHpYvCWHrGkpmQXJVhqBYoZ9UwNKq';

describe('duel mutation wallet binding', () => {
  test('allows a wallet session to act for its own address', () => {
    expect(() =>
      assertWalletActor(
        { kind: 'wallet-session', sessionId: 'auths_test', wallet: WALLET },
        WALLET,
      ),
    ).not.toThrow();
  });

  test('rejects a wallet session claiming another address', () => {
    expect(() =>
      assertWalletActor(
        { kind: 'wallet-session', sessionId: 'auths_test', wallet: WALLET },
        OTHER_WALLET,
      ),
    ).toThrow('cannot act for another wallet');
  });

  test('keeps server integration credentials authorized for orchestration', () => {
    expect(() => assertWalletActor({ kind: 'integration' }, OTHER_WALLET)).not.toThrow();
  });
});

describe('private rematch opponent resolution', () => {
  const settledDuel = {
    creatorWallet: WALLET,
    houseOpponent: false,
    opponentWallet: OTHER_WALLET,
    status: 'settled',
  } as const;

  test('returns only the other participant wallet and side', () => {
    expect(
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_creator', wallet: WALLET },
        settledDuel,
      ),
    ).toEqual({ side: 'opponent', wallet: OTHER_WALLET });
    expect(
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_opponent', wallet: OTHER_WALLET },
        settledDuel,
      ),
    ).toEqual({ side: 'creator', wallet: WALLET });
  });

  test('reveals no participant wallet to spectators or invalid rematches', () => {
    expect(() =>
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_spectator', wallet: SPECTATOR_WALLET },
        settledDuel,
      ),
    ).toThrow('Private rematch is unavailable');
    expect(() =>
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_creator', wallet: WALLET },
        { ...settledDuel, status: 'opening' },
      ),
    ).toThrow('Private rematch is unavailable');
    expect(() =>
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_creator', wallet: WALLET },
        { ...settledDuel, houseOpponent: true },
      ),
    ).toThrow('Private rematch is unavailable');
  });
});
