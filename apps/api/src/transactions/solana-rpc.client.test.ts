import { describe, expect, test } from 'bun:test';

import { parseLegacyTokenAccount, SolanaRpcUnavailableError } from './solana-rpc.client.js';

describe('legacy SPL token-account parsing', () => {
  test('accepts an exactly initialized finalized account payload', () => {
    expect(parseLegacyTokenAccount(parsedAccount('initialized'))).toEqual({
      amount: 1n,
      delegate: null,
      delegatedAmount: 0n,
      mint: 'mint',
      owner: 'owner',
    });
  });

  test('rejects frozen, uninitialized, and missing account states', () => {
    for (const state of ['frozen', 'uninitialized', undefined]) {
      expect(() => parseLegacyTokenAccount(parsedAccount(state))).toThrow(
        SolanaRpcUnavailableError,
      );
    }
  });
});

function parsedAccount(state: string | undefined): { info: Record<string, unknown>; type: string } {
  return {
    info: {
      mint: 'mint',
      owner: 'owner',
      ...(state ? { state } : {}),
      tokenAmount: { amount: '1' },
    },
    type: 'account',
  };
}
