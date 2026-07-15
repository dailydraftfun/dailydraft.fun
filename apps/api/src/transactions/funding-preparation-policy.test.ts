import { describe, expect, test } from 'bun:test';
import { DuelStatus, DuelTransactionAction, DuelTransactionStatus } from '@openpacksduel/db';

import {
  ACTIVE_FUNDING_STATUSES,
  assertNoActiveFunding,
  fundingPreparationStatus,
  isPreparedBlockhashReusable,
} from './duel-funding.service.js';
import {
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

  test('replaces stale and near-expiry blockhashes before wallet review', () => {
    expect(isPreparedBlockhashReusable(1_021n, 1_000n)).toBe(true);
    expect(isPreparedBlockhashReusable(1_020n, 1_000n)).toBe(false);
    expect(isPreparedBlockhashReusable(999n, 1_000n)).toBe(false);
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
});
