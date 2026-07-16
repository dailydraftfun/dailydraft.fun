import { describe, expect, test } from 'bun:test';
import { DuelStatus, DuelTransactionAction, DuelTransactionStatus } from '@openpacksduel/db';

import { PrismaTransactionMonitorRepository } from './prisma-transaction-monitor.repository.js';

describe('PrismaTransactionMonitorRepository terminal recovery', () => {
  test.each([
    [DuelTransactionAction.COMMIT_RESULT, DuelStatus.AWAITING_ASSETS, DuelStatus.SETTLING],
    [DuelTransactionAction.SETTLE, DuelStatus.SETTLING, DuelStatus.SETTLED],
  ] as const)('restores a finalized %s transaction after the legacy access verifier moved the duel to refunding', async (action, expectedFromStatus, expectedToStatus) => {
    const fixture = recoveryFixture(action, expectedFromStatus, expectedToStatus);
    const repository = new PrismaTransactionMonitorRepository(fixture.client);

    const finalized = await repository.recordFinalized(
      fixture.transaction.id,
      new Date('2026-07-16T07:20:00.000Z'),
    );

    expect(finalized).toBe(true);
    expect(fixture.duel.status).toBe(expectedToStatus);
    expect(fixture.transaction.status).toBe(DuelTransactionStatus.FINALIZED);
    expect(fixture.transaction.errorCode).toBeNull();
    expect(fixture.events).toEqual([
      expect.objectContaining({
        fromStatus: DuelStatus.REFUNDING,
        toStatus: expectedToStatus,
        type: 'duel.transaction_finalization_recovered',
      }),
    ]);
  });
});

function recoveryFixture(
  action: DuelTransactionAction,
  expectedFromStatus: DuelStatus,
  expectedToStatus: DuelStatus,
) {
  const duel: { id: string; status: DuelStatus; version: number } = {
    id: 'duel_recover_finalization',
    status: DuelStatus.REFUNDING,
    version: 7,
  };
  const transaction: {
    action: DuelTransactionAction;
    confirmedAt: Date | null;
    duel: typeof duel;
    errorCode: string | null;
    expectedFromStatus: DuelStatus;
    expectedToStatus: DuelStatus;
    id: string;
    signature: string;
    status: DuelTransactionStatus;
  } = {
    action,
    confirmedAt: null,
    duel,
    errorCode: 'ACCOUNT_ACCESS_MISMATCH',
    expectedFromStatus,
    expectedToStatus,
    id: 'tx_recover_finalization',
    signature: '4'.repeat(88),
    status: DuelTransactionStatus.FAILED,
  };
  const events: Array<Record<string, unknown>> = [];
  const database = {
    duel: {
      updateMany: ({
        data,
        where,
      }: {
        data: { settledAt?: Date; status: DuelStatus };
        where: { id: string; status: DuelStatus; version: number };
      }) => {
        if (
          where.id !== duel.id ||
          where.status !== duel.status ||
          where.version !== duel.version
        ) {
          return Promise.resolve({ count: 0 });
        }
        duel.status = data.status;
        duel.version += 1;
        return Promise.resolve({ count: 1 });
      },
    },
    duelEvent: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return Promise.resolve(data);
      },
    },
    duelTransaction: {
      findUnique: () => Promise.resolve(transaction),
      update: ({ data }: { data: Partial<typeof transaction> }) => {
        Object.assign(transaction, data);
        return Promise.resolve(transaction);
      },
    },
  };
  return {
    client: {
      $transaction: (callback: (client: typeof database) => Promise<boolean>) => callback(database),
    } as never,
    duel,
    events,
    transaction,
  };
}
