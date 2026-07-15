import { describe, expect, test } from 'bun:test';

import type { ProviderCardResult } from './pack-provider.js';
import { compareInsuredValues, normalizeProviderResult } from './provider-result.js';
import { CANONICAL_VALUATION_POLICY_HASH } from './valuation-policy.js';

const POLICY = CANONICAL_VALUATION_POLICY_HASH;
const OBSERVED_AT = new Date('2026-07-15T20:04:00.000Z');
const CONTEXT = {
  creatorWallet: 'creator-wallet',
  duelId: 'duel_test',
  escrowAddress: 'escrow-address',
  network: 'solana-devnet' as const,
  opponentWallet: 'opponent-wallet',
  providerMode: 'mock' as const,
  valuationPolicyHash: POLICY,
};

describe('provider result normalization', () => {
  test('compares insured values as integers without floating-point loss', () => {
    const creator = normalizeProviderResult(
      'creator',
      providerResult('creator-asset', '900719925474099300000001'),
      POLICY,
      'provider-creator',
      OBSERVED_AT,
    );
    const opponent = normalizeProviderResult(
      'opponent',
      providerResult('opponent-asset', '900719925474099300000000'),
      POLICY,
      'provider-opponent',
      OBSERVED_AT,
    );

    const comparison = compareInsuredValues(creator, opponent, CONTEXT);

    expect(comparison.winnerSide).toBe('creator');
    expect(comparison.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('fails closed when outcomes use different valuation policies', () => {
    const creator = normalizeProviderResult(
      'creator',
      providerResult('creator-asset', '1'),
      POLICY,
      'provider-creator',
      OBSERVED_AT,
    );
    expect(creator.valuationPolicyHash).toBe(POLICY);
    expect(() =>
      normalizeProviderResult(
        'opponent',
        {
          ...providerResult('opponent-asset', '2'),
          valuationPolicyHash: 'b'.repeat(64),
        },
        POLICY,
        'provider-opponent',
        OBSERVED_AT,
      ),
    ).toThrow('does not match the funded valuation policy');
  });

  test('binds duel, wallets, escrow, network, and provider mode into the result hash', () => {
    const creator = normalizeProviderResult(
      'creator',
      providerResult('creator-asset', '2'),
      POLICY,
      'provider-creator',
      OBSERVED_AT,
    );
    const opponent = normalizeProviderResult(
      'opponent',
      providerResult('opponent-asset', '1'),
      POLICY,
      'provider-opponent',
      OBSERVED_AT,
    );
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

  test('binds provider references and rejects conflicting pool snapshots', () => {
    const creator = normalizeProviderResult(
      'creator',
      providerResult('creator-asset', '2'),
      POLICY,
      'provider-creator',
      OBSERVED_AT,
    );
    const opponent = normalizeProviderResult(
      'opponent',
      providerResult('opponent-asset', '1'),
      POLICY,
      'provider-opponent',
      OBSERVED_AT,
    );
    const changedReference = normalizeProviderResult(
      'creator',
      providerResult('creator-asset', '2'),
      POLICY,
      'provider-creator-corrected',
      OBSERVED_AT,
    );

    expect(changedReference.resultHash).not.toBe(creator.resultHash);
    expect(() =>
      compareInsuredValues(
        creator,
        { ...opponent, poolVersion: 'collector-crypt-pool-v2' },
        CONTEXT,
      ),
    ).toThrow('different provider pool versions');
  });

  test('routes exact equal insured values to the deterministic refund tie rule', () => {
    const creator = normalizeProviderResult(
      'creator',
      providerResult('creator-asset', '50000000'),
      POLICY,
      'provider-creator',
      OBSERVED_AT,
    );
    const opponent = normalizeProviderResult(
      'opponent',
      providerResult('opponent-asset', '50000000'),
      POLICY,
      'provider-opponent',
      OBSERVED_AT,
    );

    expect(compareInsuredValues(creator, opponent, CONTEXT)).toEqual(
      expect.objectContaining({
        tieRule: 'return-original-assets-and-refund-platform-fees',
        winnerSide: null,
      }),
    );
  });

  test('rejects stale provider value snapshots', () => {
    expect(() =>
      normalizeProviderResult(
        'creator',
        {
          ...providerResult('creator-asset', '50000000'),
          sourceTimestamp: '2026-07-15T19:58:59.000Z',
        },
        POLICY,
        'provider-creator',
        OBSERVED_AT,
      ),
    ).toThrow('insured value is stale');
  });

  test('rejects a corrected provider value after the funded policy snapshot diverges', () => {
    expect(() =>
      normalizeProviderResult(
        'creator',
        {
          ...providerResult('creator-asset', '51000000'),
          valuationPolicyHash: 'b'.repeat(64),
        },
        POLICY,
        'provider-creator',
        OBSERVED_AT,
      ),
    ).toThrow('does not match the funded valuation policy');
  });
});

function providerResult(assetReference: string, amount: string): ProviderCardResult {
  return {
    assetReference,
    displayName: 'Normalized card',
    insuredValue: { amount, currency: 'USDC', decimals: 6 },
    poolVersion: 'collector-crypt-pool-2026-07-15T20:00Z',
    sourceTimestamp: '2026-07-15T20:03:30.000Z',
    valuationPolicyHash: POLICY,
  };
}
