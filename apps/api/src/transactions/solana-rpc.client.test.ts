import { describe, expect, test } from 'bun:test';

import {
  parseFinalizedAddressSignature,
  parseLegacyTokenAccount,
  SolanaRpcUnavailableError,
} from './solana-rpc.client.js';

describe('finalized signature parsing', () => {
  test('preserves failed signatures so recovery can detect a truncated raw page', () => {
    expect(
      parseFinalizedAddressSignature({
        blockTime: 1_784_155_260,
        confirmationStatus: 'finalized',
        err: { InstructionError: [0, 'Custom'] },
        signature: '4'.repeat(88),
      }),
    ).toEqual([
      {
        blockTime: 1_784_155_260,
        confirmationStatus: 'finalized',
        signature: '4'.repeat(88),
      },
    ]);
  });
});

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
