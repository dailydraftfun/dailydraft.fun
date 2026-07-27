import { describe, expect, test } from 'bun:test';

import {
  classifySignOnlyFailure,
  isExplicitWalletRejection,
  WalletTransactionNotBroadcastError,
} from './wallet-transaction-error';

describe('wallet transaction errors', () => {
  test('recognizes only explicit pre-broadcast rejection signals', () => {
    expect(
      isExplicitWalletRejection(Object.assign(new Error('Request failed'), { code: 4001 })),
    ).toBe(true);
    expect(isExplicitWalletRejection(new Error('User rejected the request'))).toBe(true);
    expect(isExplicitWalletRejection(new Error('Wallet declined transaction'))).toBe(true);
    expect(isExplicitWalletRejection(new Error('RPC connection dropped'))).toBe(false);
    expect(isExplicitWalletRejection(new Error('Confirmation timed out'))).toBe(false);
  });

  test('distinguishes a safe pre-broadcast failure from an explicit rejection', () => {
    expect(new WalletTransactionNotBroadcastError().reason).toBe('rejected');
    expect(
      new WalletTransactionNotBroadcastError(
        'The signed bytes were invalid. Nothing was broadcast.',
        'pre-broadcast-failure',
      ).reason,
    ).toBe('pre-broadcast-failure');
  });

  test('classifies every sign-only failure as safely not broadcast', () => {
    expect(classifySignOnlyFailure(new Error('Signer crashed'))).toMatchObject({
      message: 'The wallet could not sign the transaction. Nothing was broadcast.',
      reason: 'pre-broadcast-failure',
    });
    expect(classifySignOnlyFailure(new Error('User rejected the request'))).toMatchObject({
      reason: 'rejected',
    });

    const alreadyClassified = new WalletTransactionNotBroadcastError(
      'Signed bytes were invalid. Nothing was broadcast.',
      'pre-broadcast-failure',
    );
    expect(classifySignOnlyFailure(alreadyClassified)).toBe(alreadyClassified);
  });
});
