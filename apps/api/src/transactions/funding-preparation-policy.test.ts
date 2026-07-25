import { describe, expect, test } from 'bun:test';
import { DuelStatus, DuelTransactionAction, DuelTransactionStatus } from '@dailydraft/db';
import {
  CANONICAL_VALUATION_POLICY_HASH,
  DEVNET_DEMO_VALUATION_POLICY_HASH,
} from '../providers/valuation-policy.js';
import {
  ACTIVE_FUNDING_STATUSES,
  assertNoActiveFunding,
  assertNoPreparedFundingReplacement,
  fundingPreparationStatus,
  isPreparedBlockhashReusable,
  parsePolicyHash,
  validateFundingDuelForPreparation,
} from './duel-funding.service.js';
import {
  isIdempotentSubmissionReplay,
  recoveryAlertRouting,
  recoveryAlertTarget,
  recoveryStatusForTerminalTransaction,
  shouldEnterCommittingOnCreatorSubmission,
} from './prisma-transaction-monitor.repository.js';

describe('funding preparation policy', () => {
  test('keeps a matched duel cancellable until creator submission', () => {
    expect(fundingPreparationStatus(DuelStatus.MATCHED)).toBe(DuelStatus.MATCHED);
    expect(
      shouldEnterCommittingOnCreatorSubmission({
        action: DuelTransactionAction.FUND,
        duel: { creatorWallet: 'creator', status: DuelStatus.MATCHED },
        expectedFromStatus: DuelStatus.COMMITTING,
        wallet: 'creator',
      }),
    ).toBe(true);
  });

  test('commits only the current canonical valuation policy into escrow funding', () => {
    expect(Buffer.from(parsePolicyHash(CANONICAL_VALUATION_POLICY_HASH)).toString('hex')).toBe(
      CANONICAL_VALUATION_POLICY_HASH,
    );
    expect(Buffer.from(parsePolicyHash(DEVNET_DEMO_VALUATION_POLICY_HASH)).toString('hex')).toBe(
      DEVNET_DEMO_VALUATION_POLICY_HASH,
    );
    expect(() => parsePolicyHash('a'.repeat(64))).toThrow('supported canonical policy');
  });

  test('does not transition on opponent or non-funding submission', () => {
    expect(
      shouldEnterCommittingOnCreatorSubmission({
        action: DuelTransactionAction.FUND,
        duel: { creatorWallet: 'creator', status: DuelStatus.MATCHED },
        expectedFromStatus: DuelStatus.COMMITTING,
        wallet: 'opponent',
      }),
    ).toBe(false);
  });

  test('rejects a second active funding intent for one wallet', () => {
    expect(ACTIVE_FUNDING_STATUSES).toEqual([
      DuelTransactionStatus.SUBMITTED,
      DuelTransactionStatus.CONFIRMED,
      DuelTransactionStatus.FINALIZED,
    ]);
    expect(() => assertNoActiveFunding({ id: 'tx_active' })).toThrow(
      'This wallet already has an active funding transaction',
    );
    expect(() => assertNoActiveFunding(null)).not.toThrow();
  });

  test('accepts a lost-response retry only for the same submission key and signature', () => {
    const transaction = {
      signature: 'signature-a',
      status: DuelTransactionStatus.SUBMITTED,
      submissionIdempotencyKey: 'opd-submit-tx-a',
    };
    expect(
      isIdempotentSubmissionReplay(transaction, {
        idempotencyKey: 'opd-submit-tx-a',
        signature: 'signature-a',
      }),
    ).toBe(true);
    expect(
      isIdempotentSubmissionReplay(transaction, {
        idempotencyKey: 'opd-submit-tx-a',
        signature: 'signature-b',
      }),
    ).toBe(false);
  });

  test('replaces stale and near-expiry blockhashes before wallet review', () => {
    expect(isPreparedBlockhashReusable(1_021n, 1_000n)).toBe(true);
    expect(isPreparedBlockhashReusable(1_020n, 1_000n)).toBe(false);
    expect(isPreparedBlockhashReusable(999n, 1_000n)).toBe(false);
  });

  test('never overwrites a prepared transaction that the wallet may have broadcast', () => {
    expect(() => assertNoPreparedFundingReplacement({ id: 'tx_prepared' })).toThrow(
      'must be reconciled before another transaction can be prepared',
    );
    expect(() => assertNoPreparedFundingReplacement(null)).not.toThrow();
  });

  test('never reuses a prepared intent after duel cancellation or expiry', () => {
    const base = {
      creatorWallet: 'creator',
      expiresAt: new Date('2026-07-15T22:00:00.000Z'),
      opponentWallet: 'opponent',
    };
    expect(() =>
      validateFundingDuelForPreparation(
        { ...base, status: DuelStatus.CANCELLED },
        'creator',
        new Date('2026-07-15T21:00:00.000Z'),
      ),
    ).toThrow('Creator funding requires a matched duel');
    expect(() =>
      validateFundingDuelForPreparation(
        { ...base, status: DuelStatus.MATCHED },
        'creator',
        new Date('2026-07-15T22:00:00.000Z'),
      ),
    ).toThrow('Duel has expired');
  });

  test('cancels an atomic creator funding failure because no asset was deposited', () => {
    expect(
      recoveryStatusForTerminalTransaction({
        action: DuelTransactionAction.FUND,
        creatorWallet: 'creator',
        fromStatus: 'committing',
        wallet: 'creator',
      }),
    ).toBe('cancelled');
  });

  test('refunds an opponent funding failure after creator funding finalized', () => {
    expect(
      recoveryStatusForTerminalTransaction({
        action: DuelTransactionAction.FUND,
        creatorWallet: 'creator',
        fromStatus: 'committing',
        wallet: 'opponent',
      }),
    ).toBe('refunding');
  });

  test('keeps custody recovery open when one tracked refund expires or fails', () => {
    expect(
      recoveryStatusForTerminalTransaction({
        action: DuelTransactionAction.REFUND,
        creatorWallet: 'creator',
        fromStatus: 'refunding',
        wallet: 'operator',
      }),
    ).toBeNull();
  });

  test('routes exact unbound funding from cancelled custody into refunding only', () => {
    expect(recoveryAlertTarget(DuelStatus.CANCELLED)).toBe(DuelStatus.REFUNDING);
    expect(recoveryAlertTarget(DuelStatus.REFUNDED)).toBe(DuelStatus.REFUNDED);
    expect(recoveryAlertTarget(DuelStatus.SETTLED)).toBe(DuelStatus.SETTLED);
  });

  test('persists a validated missing escrow PDA and never overwrites a conflicting PDA', () => {
    expect(
      recoveryAlertRouting({
        currentStatus: DuelStatus.CANCELLED,
        storedEscrowAddress: null,
        validatedEscrowAddress: 'validated-escrow',
      }),
    ).toEqual({
      escrowAddress: 'validated-escrow',
      escrowConflict: false,
      targetStatus: DuelStatus.REFUNDING,
    });
    expect(
      recoveryAlertRouting({
        currentStatus: DuelStatus.CANCELLED,
        storedEscrowAddress: 'different-escrow',
        validatedEscrowAddress: 'validated-escrow',
      }),
    ).toEqual({
      escrowAddress: 'different-escrow',
      escrowConflict: true,
      targetStatus: DuelStatus.CANCELLED,
    });
  });
});
