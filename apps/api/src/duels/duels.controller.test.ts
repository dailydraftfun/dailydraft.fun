import { describe, expect, test } from 'bun:test';

import { assertWalletActor } from './duels.controller.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OTHER_WALLET = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';

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
