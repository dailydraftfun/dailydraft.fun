import { describe, expect, test } from 'bun:test';
import {
  type DatabaseClient,
  DuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
} from '@dailydraft/db';

import { assertOperationState } from '../transactions/provider-settlement.service.js';
import { PrismaDuelRepository } from './prisma-duel.repository.js';

const NOW = new Date('2026-07-20T00:00:00.000Z');

describe('PrismaDuelRepository timeout recovery', () => {
  test('routes an expired committing duel with finalized funding into refunding', async () => {
    const fixture = expiryFixture({ finalizedFunding: true });

    expect(await fixture.repository.expireTimedOut(NOW)).toBe(1);
    expect(fixture.duel).toMatchObject({
      cancellationReason: 'commitment_timeout_with_finalized_funding',
      status: DuelStatus.REFUNDING,
      version: 8,
    });
    expect(fixture.events).toEqual([
      expect.objectContaining({
        data: {
          expiredAt: NOW.toISOString(),
          hasFinalizedFunding: true,
          reason: 'commitment_timeout_with_finalized_funding',
        },
        fromStatus: DuelStatus.COMMITTING,
        sequence: 8,
        toStatus: DuelStatus.REFUNDING,
        type: 'duel.funding_commitment_timed_out',
      }),
    ]);
    expect(() => assertOperationState('refund_payment', fixture.duel.status)).not.toThrow();
    expect(fixture.query).toMatchObject({
      select: {
        transactions: {
          take: 1,
          where: {
            action: DuelTransactionAction.FUND,
            status: DuelTransactionStatus.FINALIZED,
          },
        },
      },
    });
  });

  test('cancels an expired committing duel without finalized funding', async () => {
    const fixture = expiryFixture({ finalizedFunding: false });

    expect(await fixture.repository.expireTimedOut(NOW)).toBe(1);
    expect(fixture.duel).toMatchObject({
      cancellationReason: 'commitment_timeout_without_finalized_funding',
      status: DuelStatus.CANCELLED,
      version: 8,
    });
    expect(fixture.events[0]).toMatchObject({
      data: {
        expiredAt: NOW.toISOString(),
        hasFinalizedFunding: false,
        reason: 'commitment_timeout_without_finalized_funding',
      },
      fromStatus: DuelStatus.COMMITTING,
      toStatus: DuelStatus.CANCELLED,
      type: 'duel.funding_commitment_timed_out',
    });
  });

  test('does not emit an event when the optimistic version check loses a race', async () => {
    const fixture = expiryFixture({ finalizedFunding: true, loseRace: true });

    expect(await fixture.repository.expireTimedOut(NOW)).toBe(0);
    expect(fixture.duel).toMatchObject({
      cancellationReason: null,
      status: DuelStatus.COMMITTING,
      version: 7,
    });
    expect(fixture.events).toEqual([]);
  });

  test('leaves matchmaking-managed commitments to the matchmaking expiry path', async () => {
    const fixture = expiryFixture({ finalizedFunding: true, matchmakingManaged: true });

    expect(await fixture.repository.expireTimedOut(NOW)).toBe(0);
    expect(fixture.duel.status).toBe(DuelStatus.COMMITTING);
    expect(fixture.events).toEqual([]);
    expect(fixture.query).toMatchObject({
      where: {
        OR: expect.arrayContaining([
          {
            matchmakingTickets: { none: {} },
            status: DuelStatus.COMMITTING,
          },
        ]),
      },
    });
  });
});

function expiryFixture(input: {
  finalizedFunding: boolean;
  loseRace?: boolean;
  matchmakingManaged?: boolean;
}) {
  const duel: {
    cancellationReason: string | null;
    id: string;
    status: DuelStatus;
    transactions: Array<{ id: string }>;
    version: number;
  } = {
    cancellationReason: null,
    id: 'duel_expired_committing',
    status: DuelStatus.COMMITTING,
    transactions: input.finalizedFunding ? [{ id: 'tx_finalized_funding' }] : [],
    version: 7,
  };
  const events: Array<Record<string, unknown>> = [];
  let query: Record<string, unknown> = {};
  let pendingUpdate: {
    cancellationReason: string;
    status: DuelStatus;
    versionIncrement: number;
  } | null = null;
  const transaction = {
    duel: {
      updateMany: ({
        data,
        where,
      }: {
        data: {
          cancellationReason: string;
          status: DuelStatus;
          version: { increment: number };
        };
        where: { id: string; status: DuelStatus; version: number };
      }) => {
        if (
          input.loseRace ||
          where.id !== duel.id ||
          where.status !== duel.status ||
          where.version !== duel.version
        ) {
          return Promise.resolve({ count: 0 });
        }
        pendingUpdate = {
          cancellationReason: data.cancellationReason,
          status: data.status,
          versionIncrement: data.version.increment,
        };
        return Promise.resolve({ count: 1 });
      },
    },
    duelEvent: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        if (pendingUpdate) {
          duel.cancellationReason = pendingUpdate.cancellationReason;
          duel.status = pendingUpdate.status;
          duel.version += pendingUpdate.versionIncrement;
        }
        return Promise.resolve(data);
      },
    },
  };
  const database = {
    $transaction: async (operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    duel: {
      findMany: (nextQuery: Record<string, unknown>) => {
        query = nextQuery;
        return Promise.resolve(input.matchmakingManaged ? [] : [duel]);
      },
    },
  } as unknown as DatabaseClient;

  return {
    duel,
    events,
    get query() {
      return query;
    },
    repository: new PrismaDuelRepository(database),
  };
}
