import { describe, expect, test } from 'bun:test';

import { CrashHistorySessionGuard } from './crash-history-session-guard';

describe('CrashHistorySessionGuard', () => {
  test('invalidates wallet A list and receipt requests before wallet B can render', () => {
    const guard = new CrashHistorySessionGuard();
    const walletAHistory = guard.begin('history');
    const walletAReceipt = guard.begin('receipt');

    guard.switchSession();

    expect(walletAHistory.signal.aborted).toBe(true);
    expect(walletAReceipt.signal.aborted).toBe(true);
    expect(guard.isCurrent(walletAHistory)).toBe(false);
    expect(guard.isCurrent(walletAReceipt)).toBe(false);

    const walletBHistory = guard.begin('history');
    expect(walletBHistory.signal.aborted).toBe(false);
    expect(guard.isCurrent(walletBHistory)).toBe(true);
  });

  test('a replacement request cannot be overwritten by the older response', () => {
    const guard = new CrashHistorySessionGuard();
    const first = guard.begin('history');
    const replacement = guard.begin('history');

    expect(first.signal.aborted).toBe(true);
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(replacement)).toBe(true);
  });
});
