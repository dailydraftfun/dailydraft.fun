import { describe, expect, test } from 'bun:test';

import type { Duel, DuelTransactionRecord } from '../domain.js';
import { buildPublicDuelReceipt, buildPublicWalletProfile } from './public-duel-proof.js';

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';

describe('public duel proof', () => {
  test('builds a strict receipt from public state without support metadata', () => {
    const receipt = buildPublicDuelReceipt(settledDuel(), fundingTransactions());

    expect(receipt.participants.creator.display).toBe('9xQe…9gJ1');
    expect(receipt.result?.winner?.address).toBe(CREATOR);
    expect(receipt.result?.totalValue.amount).toBe('115000000');
    expect(receipt.result?.margin.amount).toBe('85000000');
    expect(receipt.fees).toEqual({
      asset: 'WSOL',
      finalizedSides: 2,
      perSideAmountLamports: '1000000',
      requiredSides: 2,
      totalFinalizedAmountLamports: '2000000',
    });
    expect(receipt.availability.missing).toContain('card_settlement_reference');
    expect(receipt.privacy.indexable).toBe(false);
    expect(JSON.stringify(receipt)).not.toContain('private support detail');
    expect(JSON.stringify(receipt)).not.toContain('RECONCILIATION_STUCK');
  });

  test('keeps timeout cancellation and absent custody understandable', () => {
    const receipt = buildPublicDuelReceipt(
      {
        ...settledDuel(),
        cancellationReason: 'timeout',
        escrowAddress: null,
        result: null,
        status: 'cancelled',
        winnerWallet: null,
      },
      [],
    );

    expect(receipt.duel.status).toBe('expired');
    expect(receipt.custody.platformFee.status).toBe('not-started');
    expect(receipt.custody.cardAssets.status).toBe('not-recorded');
    expect(receipt.actions.primary.label).toBe('Open a new duel');
  });

  test('does not treat an unfinalized settlement signature as custody proof', () => {
    const duel = settledDuel();
    const result = requireResult(duel);
    const receipt = buildPublicDuelReceipt(
      {
        ...duel,
        providerMode: 'collector-crypt-sandbox',
        result: {
          ...result,
          outcomes: result.outcomes.map((outcome) => ({ ...outcome, isMock: false })),
        },
      },
      [
        ...fundingTransactions(),
        {
          action: 'settle',
          createdAt: '2026-07-15T20:04:00.000Z',
          duelId: 'duel_receipt00001',
          id: 'tx_settle_failed',
          network: 'solana-devnet',
          signature: '3'.repeat(88),
          status: 'failed',
          updatedAt: '2026-07-15T20:05:00.000Z',
          wallet: CREATOR,
        },
      ],
    );

    expect(receipt.references.solana).toContainEqual(
      expect.objectContaining({ action: 'settle', status: 'failed' }),
    );
    expect(receipt.custody.cardAssets.status).toBe('provider-results-recorded');
    expect(receipt.availability.missing).toContain('card_settlement_reference');
  });

  test('does not treat a finalized mock settlement as real card custody proof', () => {
    const receipt = buildPublicDuelReceipt(settledDuel(), [
      ...fundingTransactions(),
      {
        action: 'settle',
        createdAt: '2026-07-15T20:04:00.000Z',
        duelId: 'duel_receipt00001',
        finalizedAt: '2026-07-15T20:05:00.000Z',
        id: 'tx_settle_mock',
        network: 'solana-devnet',
        signature: '3'.repeat(88),
        status: 'finalized',
        updatedAt: '2026-07-15T20:05:00.000Z',
        wallet: CREATOR,
      },
    ]);

    expect(receipt.references.solana).toContainEqual(
      expect.objectContaining({ action: 'settle', status: 'finalized' }),
    );
    expect(receipt.custody.cardAssets.status).toBe('provider-results-recorded');
    expect(receipt.availability.missing).toContain('card_settlement_reference');
  });

  test('calculates wallet record, biggest win, refunds, and pseudonymous opponents', () => {
    const settled = settledDuel();
    const loss = {
      ...settled,
      id: 'duel_loss00000001',
      winnerWallet: OPPONENT,
      result: { ...requireResult(settled), winnerSide: 'opponent' as const },
    };
    const refunded = {
      ...settledDuel(),
      id: 'duel_refund000001',
      result: null,
      status: 'refunded' as const,
      winnerWallet: null,
    };

    const profile = buildPublicWalletProfile(CREATOR, [settledDuel(), loss, refunded], false, 100);

    expect(profile.record).toEqual({
      active: 0,
      cancelledOrExpired: 0,
      completed: 2,
      losses: 1,
      refunded: 1,
      total: 3,
      wins: 1,
    });
    expect(profile.biggestWin?.duelId).toBe('duel_receipt00001');
    expect(profile.duels[0]?.opponentDisplay).toBe('DeWQ…12Eu');
    expect(profile.privacy.indexable).toBe(false);
  });
});

function requireResult(duel: Duel): NonNullable<Duel['result']> {
  if (!duel.result) throw new Error('Test fixture requires a duel result');
  return duel.result;
}

function settledDuel(): Duel {
  return {
    cancellationReason: null,
    createdAt: '2026-07-15T20:00:00.000Z',
    creatorWallet: CREATOR,
    environment: 'solana-devnet',
    escrowAddress: '7YttLkHDoNj9wyDur5rWnFwyCRLQ8vWUvqGL9cM23Zgy',
    expiresAt: '2026-07-15T21:00:00.000Z',
    houseOpponent: false,
    id: 'duel_receipt00001',
    matchmakingMode: 'direct',
    opponentJoinedAt: '2026-07-15T20:01:00.000Z',
    opponentWallet: OPPONENT,
    pack: {
      active: true,
      id: 'pokemon_50',
      name: '$50 Pokémon Pack',
      price: { amount: '50000000', currency: 'USDC', decimals: 6 },
      provider: 'collector-crypt',
      providerPackId: 'pokemon_50',
      valuationPolicyHash: 'a'.repeat(64),
    },
    providerMode: 'mock',
    result: {
      comparisonMetric: 'insured-value',
      outcomes: [
        {
          assetReference: 'mock:card:creator',
          displayName: 'Umbreon VMAX',
          insuredValue: { amount: '100000000', currency: 'USDC', decimals: 6 },
          isMock: true,
          provider: 'collector-crypt',
          providerReference: 'mock:pack:creator',
          resultHash: 'b'.repeat(64),
          side: 'creator',
        },
        {
          assetReference: 'mock:card:opponent',
          displayName: 'Blastoise',
          insuredValue: { amount: '15000000', currency: 'USDC', decimals: 6 },
          isMock: true,
          provider: 'collector-crypt',
          providerReference: 'mock:pack:opponent',
          resultHash: 'c'.repeat(64),
          side: 'opponent',
        },
      ],
      resultHash: 'd'.repeat(64),
      settlementReady: true,
      valuationPolicyHash: 'a'.repeat(64),
      winnerSide: 'creator',
    },
    stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
    status: 'settled',
    updatedAt: '2026-07-15T20:10:00.000Z',
    version: 8,
    winnerWallet: CREATOR,
  };
}

function fundingTransactions(): DuelTransactionRecord[] {
  return [CREATOR, OPPONENT].map((wallet, index) => ({
    action: 'fund',
    createdAt: '2026-07-15T20:02:00.000Z',
    duelId: 'duel_receipt00001',
    errorCode: index === 0 ? 'RECONCILIATION_STUCK' : null,
    errorMessage: index === 0 ? 'private support detail' : null,
    feeAmountLamports: '1000000',
    finalizedAt: '2026-07-15T20:03:00.000Z',
    id: `tx_fund_${index}`,
    network: 'solana-devnet',
    signature: `${index + 1}`.repeat(88),
    status: 'finalized',
    updatedAt: '2026-07-15T20:03:00.000Z',
    wallet,
  }));
}
