import { describe, expect, test } from 'bun:test';
import { type DatabaseClient, DuelSide, DuelStatus } from '@dailydraft/db';

import type { ProviderCardResult } from '../providers/pack-provider.js';
import { compareInsuredValues, normalizeProviderResult } from '../providers/provider-result.js';
import { CANONICAL_VALUATION_POLICY_HASH } from '../providers/valuation-policy.js';
import { assertOperationState } from '../transactions/provider-settlement.service.js';
import {
  assertOpeningTimesWithinEscrowWindow,
  PrismaDuelRepository,
  resolvedPackTargetStatus,
  toDuelResult,
} from './prisma-duel.repository.js';

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
    expect(result?.resultHash).toBe('b'.repeat(64));
    expect(result?.outcomes.map((outcome) => outcome.rarity)).toEqual(['rare', 'rare']);
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

  test('rejects provider openings after expiry before any outcome is persisted', async () => {
    const now = new Date();
    const fundedAt = new Date(now.getTime() - 120_000);
    const expiresAt = new Date(now.getTime() - 31_000);
    const openedAt = new Date(now.getTime() - 30_000);
    const harness = persistenceHarness(fundedAt, expiresAt);

    await expect(harness.repository.resolveOpenedPacks(resolveInput(openedAt))).rejects.toThrow(
      'after duel expiry',
    );
    expect(harness.outcomeWrites()).toBe(0);
  });

  test('rejects future-skewed provider openings before any outcome is persisted', async () => {
    const now = new Date();
    const fundedAt = new Date(now.getTime() - 60_000);
    const expiresAt = new Date(now.getTime() + 3_600_000);
    const openedAt = new Date(now.getTime() + 60_000);
    const harness = persistenceHarness(fundedAt, expiresAt);

    await expect(harness.repository.resolveOpenedPacks(resolveInput(openedAt))).rejects.toThrow(
      'future-skew allowance',
    );
    expect(harness.outcomeWrites()).toBe(0);
  });

  test('accepts exact whole-second funding, expiry, and future-skew boundaries', () => {
    expect(() =>
      assertOpeningTimesWithinEscrowWindow({
        creatorOpenedAt: '2026-07-15T20:00:00.000Z',
        expiresAt: new Date('2026-07-15T20:05:00.100Z'),
        fundedAt: new Date('2026-07-15T20:00:00.900Z'),
        now: new Date('2026-07-15T20:04:30.900Z'),
        opponentOpenedAt: '2026-07-15T20:05:00.999Z',
      }),
    ).not.toThrow();
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

function providerResult(
  assetReference: string,
  sourceTimestamp = '2026-07-15T20:03:30.000Z',
): ProviderCardResult {
  return {
    assetReference,
    displayName: 'Equal-value test card',
    insuredValue: { amount: '50000000', currency: 'USDC', decimals: 6 },
    poolVersion: 'collector-crypt-pool-v1',
    sourceTimestamp,
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  };
}

function resolveInput(openedAt: Date) {
  const creator = normalizeProviderResult(
    'creator',
    providerResult('creator-asset', openedAt.toISOString()),
    CANONICAL_VALUATION_POLICY_HASH,
    'creator-provider-reference',
    openedAt,
  );
  const opponent = normalizeProviderResult(
    'opponent',
    providerResult('opponent-asset', openedAt.toISOString()),
    CANONICAL_VALUATION_POLICY_HASH,
    'opponent-provider-reference',
    openedAt,
  );
  const comparison = compareInsuredValues(creator, opponent, {
    creatorWallet: 'creator',
    duelId: 'duel_opening_window',
    escrowAddress: 'escrow',
    network: 'solana-devnet',
    opponentWallet: 'opponent',
    providerMode: 'mock',
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  });
  return {
    comparison,
    creator,
    duelId: 'duel_opening_window',
    idempotencyKey: 'opening-window-idempotency-key',
    isMock: true,
    opponent,
    provider: 'mock',
    requestHash: 'opening-window-request-hash',
  };
}

function persistenceHarness(fundedAt: Date, expiresAt: Date) {
  let outcomeWrites = 0;
  const transaction = {
    duel: {
      findUnique: async () => ({
        creatorWallet: 'creator',
        expiresAt,
        fundedAt,
        id: 'duel_opening_window',
        opponentWallet: 'opponent',
        resultHash: null,
        resultReadyAt: null,
        status: DuelStatus.OPENING,
        valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
        version: 4,
      }),
    },
    duelPackOutcome: {
      createMany: async () => {
        outcomeWrites += 1;
      },
    },
  };
  const database = {
    $transaction: async (operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    idempotencyRecord: {
      findUnique: async () => null,
    },
  } as unknown as DatabaseClient;

  return {
    outcomeWrites: () => outcomeWrites,
    repository: new PrismaDuelRepository(database),
  };
}
