import { describe, expect, test } from 'bun:test';
import { DuelTransactionAction, DuelTransactionStatus } from '@openpacksduel/db';

import { isRecoverableTerminalFinalization } from './prisma-transaction-monitor.repository.js';

describe('terminal finalization recovery', () => {
  test.each([
    DuelTransactionAction.COMMIT_RESULT,
    DuelTransactionAction.SETTLE,
  ])('rechecks a finalized provider %s transaction rejected by the legacy access verifier', (action) => {
    expect(
      isRecoverableTerminalFinalization({
        action,
        errorCode: 'ACCOUNT_ACCESS_MISMATCH',
        status: DuelTransactionStatus.FAILED,
      }),
    ).toBe(true);
  });

  test('does not reopen actual chain failures or unrelated transaction actions', () => {
    expect(
      isRecoverableTerminalFinalization({
        action: DuelTransactionAction.SETTLE,
        errorCode: 'TRANSACTION_EXECUTION_ERROR',
        status: DuelTransactionStatus.FAILED,
      }),
    ).toBe(false);
    expect(
      isRecoverableTerminalFinalization({
        action: DuelTransactionAction.FUND,
        errorCode: 'ACCOUNT_ACCESS_MISMATCH',
        status: DuelTransactionStatus.FAILED,
      }),
    ).toBe(false);
  });
});
