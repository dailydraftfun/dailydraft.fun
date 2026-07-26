import { describe, expect, test } from 'bun:test';

import { getExplorerAddressUrl, getExplorerTransactionUrl, shortenAddress } from './config';

const signature =
  '5j7s1QzqC5S1oJ8nJ2gGkQvJ4aVn8rTz9wXyB3cD4eF6aB7cD8eF9gH1jK2mN3pQ4rS5tU6vW7xY8zA9bC1dE2f';
const address = '4Nd1mB1TrE9gJ2vQ8mHc1oQ5m8y1Y7xZoK3rWpTf6xTk';

describe('explorer urls', () => {
  test('pins a transaction link to the cluster the app actually runs on', () => {
    // Without the cluster query the explorer silently resolves against mainnet,
    // where a devnet signature simply does not exist.
    expect(getExplorerTransactionUrl(signature)).toBe(
      `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    );
  });

  test('pins an address link to the same cluster', () => {
    expect(getExplorerAddressUrl(address)).toBe(
      `https://explorer.solana.com/address/${address}?cluster=devnet`,
    );
  });

  test('escapes anything that is not a plain base58 value', () => {
    expect(getExplorerTransactionUrl('a/b?c=d')).toContain('/tx/a%2Fb%3Fc%3Dd?cluster=devnet');
    expect(getExplorerAddressUrl('a&b')).toContain('/address/a%26b?cluster=devnet');
  });
});

describe('shortenAddress', () => {
  test('keeps both ends of a full address legible', () => {
    expect(shortenAddress(address)).toBe('4Nd1…6xTk');
  });

  test('leaves a value too short to abbreviate untouched', () => {
    expect(shortenAddress('4Nd1mB1Tr')).toBe('4Nd1mB1Tr');
  });
});
