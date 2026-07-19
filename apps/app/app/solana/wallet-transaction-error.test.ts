import { describe, expect, test } from 'bun:test';

import { isExplicitWalletRejection } from './wallet-transaction-error';

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
});
