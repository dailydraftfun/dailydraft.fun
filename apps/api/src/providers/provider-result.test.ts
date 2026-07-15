import { describe, expect, test } from 'bun:test';

import type { ProviderCardResult } from './pack-provider.js';
import { compareInsuredValues, normalizeProviderResult } from './provider-result.js';

const POLICY = 'a'.repeat(64);
const CONTEXT = {
  creatorWallet: 'creator-wallet',
  duelId: 'duel_test',
  escrowAddress: 'escrow-address',
  network: 'solana-devnet' as const,
  opponentWallet: 'opponent-wallet',
  providerMode: 'mock' as const,
};

describe('provider result normalization', () => {
  test('compares insured values as integers without floating-point loss', () => {
    const creator = normalizeProviderResult(
      'creator',
      providerResult('creator-asset', '900719925474099300000001'),
    );
    const opponent = normalizeProviderResult(
      'opponent',
      providerResult('opponent-asset', '900719925474099300000000'),
    );

    const comparison = compareInsuredValues(creator, opponent, CONTEXT);

    expect(comparison.winnerSide).toBe('creator');
    expect(comparison.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('fails closed when outcomes use different valuation policies', () => {
    const creator = normalizeProviderResult('creator', providerResult('creator-asset', '1'));
    const opponent = normalizeProviderResult('opponent', {
      ...providerResult('opponent-asset', '2'),
      valuationPolicyHash: 'b'.repeat(64),
    });

    expect(() => compareInsuredValues(creator, opponent, CONTEXT)).toThrow(
      'different valuation policies',
    );
  });

  test('binds duel, wallets, escrow, network, and provider mode into the result hash', () => {
    const creator = normalizeProviderResult('creator', providerResult('creator-asset', '2'));
    const opponent = normalizeProviderResult('opponent', providerResult('opponent-asset', '1'));
    const baseline = compareInsuredValues(creator, opponent, CONTEXT).resultHash;
    const variants = [
      { ...CONTEXT, duelId: 'duel_other' },
      { ...CONTEXT, creatorWallet: 'creator-other' },
      { ...CONTEXT, opponentWallet: 'opponent-other' },
      { ...CONTEXT, escrowAddress: 'escrow-other' },
      { ...CONTEXT, network: 'solana-mainnet' as const },
      { ...CONTEXT, providerMode: 'collector-crypt-sandbox' as const },
    ];

    for (const context of variants) {
      expect(compareInsuredValues(creator, opponent, context).resultHash).not.toBe(baseline);
    }
  });
});

function providerResult(assetReference: string, amount: string): ProviderCardResult {
  return {
    assetReference,
    displayName: 'Normalized card',
    insuredValue: { amount, currency: 'USDC', decimals: 6 },
    valuationPolicyHash: POLICY,
  };
}
