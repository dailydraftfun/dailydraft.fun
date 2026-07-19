import { describe, expect, test } from 'bun:test';

import type { DuelTransactionIntent } from '../solana/duel-client';
import {
  createDuelEntryDraft,
  getDuelEntryStage,
  getPlainMoneySummary,
  parseDuelEntryDraft,
} from './duel-entry-flow';

const authenticated = {
  authenticationStatus: 'authenticated' as const,
  error: null,
  fundingPhase: 'idle' as const,
  hasSession: true,
  intent: null,
  networkStatus: 'online' as const,
  pending: false,
  persistedStatus: null,
  walletAddress: 'wallet',
};

describe('guided duel entry flow', () => {
  test('starts with connection and keeps authentication in the same journey', () => {
    expect(getDuelEntryStage({ ...authenticated, walletAddress: null })).toBe('connect');
    expect(
      getDuelEntryStage({
        ...authenticated,
        authenticationStatus: 'signing',
        hasSession: false,
      }),
    ).toBe('authenticate');
  });

  test('identifies value-bearing signing separately from authentication', () => {
    expect(
      getDuelEntryStage({
        ...authenticated,
        fundingPhase: 'signing',
        intent: fundingIntent(),
        pending: true,
      }),
    ).toBe('funding-signature');
  });

  test('advances from preparation through funding confirmation', () => {
    expect(getDuelEntryStage({ ...authenticated, pending: true })).toBe('preparing');
    expect(getDuelEntryStage({ ...authenticated, intent: fundingIntent() })).toBe('funding-review');
    expect(
      getDuelEntryStage({
        ...authenticated,
        fundingPhase: 'confirming',
        pending: true,
      }),
    ).toBe('confirming');
    expect(
      getDuelEntryStage({
        ...authenticated,
        error: 'Confirmation timed out.',
        fundingPhase: 'recovering',
        intent: fundingIntent(),
      }),
    ).toBe('recovery');
    expect(getDuelEntryStage({ ...authenticated, persistedStatus: 'funded' })).toBe('complete');
  });

  test('routes rejection and RPC outages to specific recovery', () => {
    expect(
      getDuelEntryStage({
        ...authenticated,
        authenticationStatus: 'error',
        error: 'Authentication signature rejected.',
        hasSession: false,
      }),
    ).toBe('authenticate');
    expect(getDuelEntryStage({ ...authenticated, error: 'Wallet rejected the request.' })).toBe(
      'recovery',
    );
    expect(getDuelEntryStage({ ...authenticated, networkStatus: 'offline' })).toBe('recovery');
  });

  test('keeps a partially funded duel resumable', () => {
    expect(getDuelEntryStage({ ...authenticated, persistedStatus: 'committing' })).toBe('waiting');
    expect(getDuelEntryStage({ ...authenticated, persistedStatus: 'matched' })).toBe('recovery');
  });

  test('shows one plain-money summary before the wallet opens', () => {
    expect(getPlainMoneySummary(50, fundingIntent())).toEqual({
      packPurchase: 'Not charged in this devnet step',
      packTier: '$50.00',
      platformFee: '0.015 SOL',
      walletApproval: '0.015 SOL',
    });
  });

  test('restores a valid reload draft without storing credentials or serialized transactions', () => {
    const draft = createDuelEntryDraft(
      {
        broadcastPending: false,
        duelId: 'duel_123',
        mode: 'direct',
        opponentAddress: 'opponent',
        rejectedIntentId: 'tx_rejectedfunding01',
        tier: 50,
      },
      '2026-07-17T09:00:00.000Z',
    );

    expect(
      parseDuelEntryDraft(JSON.stringify(draft), new Date('2026-07-17T09:10:00.000Z').getTime()),
    ).toEqual(draft);
    expect(JSON.stringify(draft)).not.toContain('session');
    expect(JSON.stringify(draft)).not.toContain('serializedTransaction');
    expect(draft.broadcastPending).toBe(false);
    expect(draft.rejectedIntentId).toBe('tx_rejectedfunding01');
  });

  test('discards malformed or outdated reload drafts', () => {
    expect(parseDuelEntryDraft('not-json')).toBeNull();
    expect(parseDuelEntryDraft('{"version":2,"tier":50}')).toBeNull();
    expect(
      parseDuelEntryDraft(
        '{"version":1,"broadcastPending":false,"duelId":null,"mode":"direct","opponentAddress":"","tier":75,"updatedAt":"2026-07-17T09:00:00.000Z"}',
      ),
    ).toBeNull();
    expect(
      parseDuelEntryDraft(
        '{"version":1,"broadcastPending":true,"duelId":"duel_123","mode":"direct","opponentAddress":"","rejectedIntentId":"tx_rejectedfunding01","tier":50,"updatedAt":"2026-07-17T09:00:00.000Z"}',
        new Date('2026-07-17T09:10:00.000Z').getTime(),
      ),
    ).toBeNull();
    expect(
      parseDuelEntryDraft(
        JSON.stringify(
          createDuelEntryDraft(
            {
              broadcastPending: false,
              duelId: 'expired_duel',
              mode: 'direct',
              opponentAddress: 'opponent',
              rejectedIntentId: null,
              tier: 50,
            },
            '2026-07-17T08:00:00.000Z',
          ),
        ),
        new Date('2026-07-17T09:00:00.000Z').getTime(),
      ),
    ).toBeNull();
  });
});

function fundingIntent(): DuelTransactionIntent {
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
    wallet: 'wallet',
    warnings: [],
  };
}
