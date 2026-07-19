import { describe, expect, test } from 'bun:test';
import { DuelTransactionAction, DuelTransactionStatus } from '@openpacksduel/db';

import { DuelFundingService } from './duel-funding.service.js';

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';

describe('definite no-broadcast funding recovery', () => {
  test('expires the exact rejected intent immediately and replays idempotently', async () => {
    const fixture = rejectionFixture();
    const service = fundingService(fixture.client);

    const first = await service.recordWalletRejection({
      actorWallet: CREATOR,
      duelId: fixture.transaction.duelId,
      transactionId: fixture.transaction.id,
    });
    const replay = await service.recordWalletRejection({
      actorWallet: CREATOR,
      duelId: fixture.transaction.duelId,
      transactionId: fixture.transaction.id,
    });

    expect(first).toEqual({
      duelId: fixture.transaction.duelId,
      reason: 'wallet_rejected_before_broadcast',
      status: 'expired',
      transactionId: fixture.transaction.id,
    });
    expect(replay).toEqual(first);
    expect(fixture.transaction.status).toBe(DuelTransactionStatus.EXPIRED);
    expect(fixture.transaction.errorCode).toBe('WALLET_REJECTED_BEFORE_BROADCAST');
    expect(fixture.updates).toBe(1);
  });

  test('never expires an intent with a signature because broadcast state is uncertain', async () => {
    const fixture = rejectionFixture({ signature: '4'.repeat(88) });
    const service = fundingService(fixture.client);

    await expect(
      service.recordWalletRejection({
        actorWallet: CREATOR,
        duelId: fixture.transaction.duelId,
        transactionId: fixture.transaction.id,
      }),
    ).rejects.toThrow('Only an unsubmitted prepared funding intent');

    expect(fixture.transaction.status).toBe(DuelTransactionStatus.PREPARED);
    expect(fixture.transaction.errorCode).toBeNull();
    expect(fixture.updates).toBe(0);
  });

  test('accepts a concurrent no-broadcast expiry without overwriting its evidence', async () => {
    const fixture = rejectionFixture({
      errorCode: 'UNBOUND_BROADCAST_NOT_FOUND_AFTER_FINALITY',
      status: DuelTransactionStatus.EXPIRED,
    });
    const service = fundingService(fixture.client);

    await expect(
      service.recordWalletRejection({
        actorWallet: CREATOR,
        duelId: fixture.transaction.duelId,
        transactionId: fixture.transaction.id,
      }),
    ).resolves.toMatchObject({
      reason: 'wallet_rejected_before_broadcast',
      status: 'expired',
    });

    expect(fixture.transaction.errorCode).toBe('UNBOUND_BROADCAST_NOT_FOUND_AFTER_FINALITY');
    expect(fixture.updates).toBe(0);
  });

  test('rejects a wallet session acting for the other funding signer', async () => {
    const fixture = rejectionFixture();
    const service = fundingService(fixture.client);

    await expect(
      service.recordWalletRejection({
        actorWallet: OPPONENT,
        duelId: fixture.transaction.duelId,
        transactionId: fixture.transaction.id,
      }),
    ).rejects.toThrow('another signer or duel participant');

    expect(fixture.transaction.status).toBe(DuelTransactionStatus.PREPARED);
    expect(fixture.updates).toBe(0);
  });
});

function fundingService(database: never): DuelFundingService {
  return new DuelFundingService(database, {} as never, {} as never, {} as never);
}

function rejectionFixture({
  errorCode = null,
  signature = null,
  status = DuelTransactionStatus.PREPARED,
}: {
  errorCode?: string | null;
  signature?: string | null;
  status?: DuelTransactionStatus;
} = {}) {
  const duel = {
    creatorWallet: CREATOR,
    opponentWallet: OPPONENT,
  };
  const transaction = {
    action: DuelTransactionAction.FUND,
    duel,
    duelId: 'duel_rejected_funding_01',
    errorCode,
    expectedSigner: CREATOR,
    id: 'tx_rejectedfunding01',
    lastCheckedAt: null as Date | null,
    nextCheckAt: null as Date | null,
    nextRecoveryCheckAt: null as Date | null,
    signature,
    status,
    wallet: CREATOR,
  };
  let updates = 0;
  const database = {
    duelTransaction: {
      findUnique: () => Promise.resolve(transaction),
      updateMany: ({
        data,
        where,
      }: {
        data: Partial<typeof transaction>;
        where: {
          action: DuelTransactionAction;
          duelId: string;
          id: string;
          signature: null;
          status: DuelTransactionStatus;
          wallet: string;
        };
      }) => {
        if (
          transaction.action !== where.action ||
          transaction.duelId !== where.duelId ||
          transaction.id !== where.id ||
          transaction.signature !== where.signature ||
          transaction.status !== where.status ||
          transaction.wallet !== where.wallet
        ) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(transaction, data);
        updates += 1;
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return {
    client: {
      $transaction: (callback: (client: typeof database) => Promise<unknown>) => callback(database),
    } as never,
    get updates() {
      return updates;
    },
    transaction,
  };
}
