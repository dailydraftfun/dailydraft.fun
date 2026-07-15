import { describe, expect, test } from 'bun:test';
import { DuelSide, DuelStatus } from '@openpacksduel/db';

import type { ProviderCardResult } from '../providers/pack-provider.js';
import { normalizeProviderResult } from '../providers/provider-result.js';
import { CANONICAL_VALUATION_POLICY_HASH } from '../providers/valuation-policy.js';
import { assertOperationState } from '../transactions/provider-settlement.service.js';
import { resolvedPackTargetStatus, toDuelResult } from './prisma-duel.repository.js';

describe('canonical valuation lifecycle', () => {
  test('keeps an equal-value result on the normal escrow custody and settlement path', () => {
    expect(resolvedPackTargetStatus(null)).toBe(DuelStatus.AWAITING_ASSETS);
    expect(() => assertOperationState('deposit_card', DuelStatus.AWAITING_ASSETS)).not.toThrow();
    expect(() => assertOperationState('commit_result', DuelStatus.AWAITING_ASSETS)).not.toThrow();
    expect(() => assertOperationState('settle', DuelStatus.SETTLING)).not.toThrow();

    const openedAt = new Date('2026-07-15T20:04:00.000Z');
    const result = toDuelResult({
      creatorWallet: 'creator',
      opponentWallet: 'opponent',
      packOutcomes: [
        canonicalOutcome(DuelSide.CREATOR, openedAt),
        canonicalOutcome(DuelSide.OPPONENT, openedAt),
      ],
      resultHash: 'b'.repeat(64),
      resultReadyAt: openedAt,
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
      winnerWallet: null,
    });
    expect(result).toEqual(expect.objectContaining({ settlementReady: true, winnerSide: null }));
  });

  test('degrades legacy outcomes without fabricating provider snapshot proof', () => {
    const openedAt = new Date('2026-07-15T20:00:00.000Z');
    const outcome = (side: DuelSide) => ({
      assetReference: `${side.toLowerCase()}-asset`,
      displayName: `${side.toLowerCase()} card`,
      insuredValueAmount: '50000000',
      insuredValueCurrency: 'USDC',
      insuredValueDecimals: 6,
      isMock: true,
      openedAt,
      poolVersion: null,
      provider: 'mock',
      providerReference: `${side.toLowerCase()}-provider-reference`,
      resultHash: 'a'.repeat(64),
      side,
      sourceTimestamp: null,
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    });

    expect(
      toDuelResult({
        creatorWallet: 'creator',
        opponentWallet: 'opponent',
        packOutcomes: [outcome(DuelSide.CREATOR), outcome(DuelSide.OPPONENT)],
        resultHash: 'b'.repeat(64),
        resultReadyAt: openedAt,
        valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
        winnerWallet: 'creator',
      }),
    ).toBeNull();
  });
});

function canonicalOutcome(side: DuelSide, openedAt: Date) {
  const normalized = normalizeProviderResult(
    side === DuelSide.CREATOR ? 'creator' : 'opponent',
    providerResult(`${side.toLowerCase()}-asset`),
    CANONICAL_VALUATION_POLICY_HASH,
    `${side.toLowerCase()}-provider-reference`,
    openedAt,
  );
  return {
    assetReference: normalized.assetReference,
    displayName: normalized.displayName,
    insuredValueAmount: normalized.insuredValue.amount,
    insuredValueCurrency: normalized.insuredValue.currency,
    insuredValueDecimals: normalized.insuredValue.decimals,
    isMock: true,
    openedAt,
    poolVersion: normalized.poolVersion,
    provider: 'mock',
    providerReference: normalized.providerReference,
    resultHash: normalized.resultHash,
    side,
    sourceTimestamp: new Date(normalized.sourceTimestamp),
    valuationPolicyHash: normalized.valuationPolicyHash,
  };
}

function providerResult(assetReference: string): ProviderCardResult {
  return {
    assetReference,
    displayName: 'Equal-value test card',
    insuredValue: { amount: '50000000', currency: 'USDC', decimals: 6 },
    poolVersion: 'collector-crypt-pool-v1',
    sourceTimestamp: '2026-07-15T20:03:30.000Z',
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  };
}
