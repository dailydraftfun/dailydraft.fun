import { describe, expect, test } from 'bun:test';

import type { DuelTransactionIntent, DurableDuel } from '../solana/duel-client';
import {
  classifyPostBroadcastRecovery,
  getDuelEntryCancellationTarget,
  restoreDuelEntry,
} from './duel-entry-recovery';

describe('duel entry recovery', () => {
  test('awaits a fresh unsigned intent before returning one restored state update', async () => {
    const calls: string[] = [];
    const restored = await restoreDuelEntry({
      abandonRejectedIntent: async () => {
        calls.push('rejection');
      },
      duelId: 'duel_123',
      fundingPossiblyBroadcast: false,
      loadDuel: async () => {
        calls.push('duel');
        return duel('matched');
      },
      prepareIntent: async () => {
        calls.push('intent');
        return intent();
      },
      rejectedIntentId: null,
      sessionToken: 'session',
      wallet: 'creator',
    });

    expect(calls).toEqual(['duel', 'intent']);
    expect(restored.duel.id).toBe('duel_123');
    expect(restored.intent?.id).toBe('intent_123');
  });

  test('never prepares another intent while an earlier wallet request may have broadcast', async () => {
    let prepared = false;
    const restored = await restoreDuelEntry({
      abandonRejectedIntent: async () => {
        throw new Error('uncertain broadcasts must not be abandoned');
      },
      duelId: 'duel_123',
      fundingPossiblyBroadcast: true,
      loadDuel: async () => duel('matched'),
      prepareIntent: async () => {
        prepared = true;
        return intent();
      },
      rejectedIntentId: null,
      sessionToken: 'session',
      wallet: 'creator',
    });

    expect(prepared).toBe(false);
    expect(restored.intent).toBeNull();
  });

  test('rejects a different wallet before preparing any transaction', async () => {
    expect(
      restoreDuelEntry({
        abandonRejectedIntent: async () => undefined,
        duelId: 'duel_123',
        fundingPossiblyBroadcast: false,
        loadDuel: async () => duel('matched'),
        prepareIntent: async () => intent(),
        rejectedIntentId: null,
        sessionToken: 'session',
        wallet: 'stranger',
      }),
    ).rejects.toThrow('not a participant');
  });

  test('expires a definite no-broadcast intent before preparing its replacement', async () => {
    const calls: string[] = [];

    const restored = await restoreDuelEntry({
      abandonRejectedIntent: async (_duelId, intentId) => {
        calls.push(`reject:${intentId}`);
      },
      duelId: 'duel_123',
      fundingPossiblyBroadcast: false,
      loadDuel: async () => {
        calls.push('duel');
        return duel('matched');
      },
      prepareIntent: async () => {
        calls.push('intent');
        return intent();
      },
      rejectedIntentId: 'tx_rejected_funding_01',
      sessionToken: 'session',
      wallet: 'creator',
    });

    expect(calls).toEqual(['duel', 'reject:tx_rejected_funding_01', 'intent']);
    expect(restored.intent?.id).toBe('intent_123');
  });

  test('keeps uncertain chain state away from the approve button', () => {
    expect(classifyPostBroadcastRecovery(duel('matched'), 1, 0)).toBe('still-confirming');
    expect(classifyPostBroadcastRecovery(duel('matched'), 0, 1)).toBe('still-confirming');
    expect(classifyPostBroadcastRecovery(duel('matched'), 0, 0)).toBe('retry-safe');
    expect(classifyPostBroadcastRecovery(duel('committing'), 0, 0)).toBe('waiting');
    expect(classifyPostBroadcastRecovery(duel('funded'), 0, 0)).toBe('complete');
  });

  test('cancels a selected house fallback as a duel, not as open matchmaking', () => {
    const houseDuel = { ...duel('matched'), matchmakingMode: 'house' as const };

    expect(getDuelEntryCancellationTarget(null, true)).toBe('matchmaking');
    expect(getDuelEntryCancellationTarget(duel('waiting'), true)).toBe('duel');
    expect(getDuelEntryCancellationTarget(houseDuel, true)).toBe('duel');
  });
});

function duel(status: DurableDuel['status']): DurableDuel {
  return {
    createdAt: '2026-07-17T09:00:00.000Z',
    creatorWallet: 'creator',
    environment: 'solana-devnet',
    expiresAt: '2026-07-17T09:15:00.000Z',
    houseOpponent: false,
    id: 'duel_123',
    matchmakingMode: 'direct',
    opponentWallet: 'opponent',
    pack: {
      id: 'pokemon_50',
      name: 'Pokemon $50',
      price: { amount: '50000000', currency: 'USDC', decimals: 6 },
      provider: 'openpacksduel',
    },
    providerMode: 'openpacksduel-devnet',
    result: null,
    stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
    status,
    transactionSignature: null,
    version: 1,
    winnerWallet: null,
  };
}

function intent(): DuelTransactionIntent {
  return {
    action: 'fund',
    chain: 'solana:devnet',
    cluster: 'devnet',
    duelId: 'duel_123',
    escrowAddress: 'escrow',
    expiresAt: '2026-07-17T09:15:00.000Z',
    feeAmountLamports: '15000000',
    feeAmountSol: '0.015',
    feeRecipient: 'recipient',
    fundingSide: 'creator',
    id: 'intent_123',
    lastValidBlockHeight: '123',
    paymentMint: 'So11111111111111111111111111111111111111112',
    programId: 'program',
    recentBlockhash: 'blockhash',
    serializedTransactionBase64: 'dHJhbnNhY3Rpb24=',
    status: 'prepared',
    wallet: 'creator',
    warnings: [],
  };
}
