import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '@dailydraft/db';

import {
  type CreateWalletAuthChallengeRecord,
  type WalletAuthMaintenancePolicy,
  WalletChallengeRateLimitExceededError,
} from './auth.repository.js';
import { PrismaWalletAuthRepository } from './prisma-auth.repository.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const START = new Date('2026-07-18T10:00:00.000Z');

describe('PrismaWalletAuthRepository', () => {
  test('rejects N+1 issuance transactionally and recovers after the rate window elapses', async () => {
    const database = new FakeAuthDatabase();
    const repository = new PrismaWalletAuthRepository(database as unknown as DatabaseClient);

    await issue(repository, database, 'authc_1', START, 2);
    await issue(repository, database, 'authc_2', new Date(START.getTime() + 1_000), 2);

    await expect(
      issue(repository, database, 'authc_3', new Date(START.getTime() + 2_000), 2),
    ).rejects.toBeInstanceOf(WalletChallengeRateLimitExceededError);
    expect(database.challengeIds()).toEqual(['authc_1', 'authc_2']);
    expect(database.advisoryLockCount).toBe(3);

    await issue(repository, database, 'authc_4', new Date(START.getTime() + 61_000), 2);
    expect(database.challengeIds()).toEqual(['authc_1', 'authc_2', 'authc_4']);
  });

  test('deletes only a bounded batch of expired rows without removing active-window evidence', async () => {
    const database = new FakeAuthDatabase();
    const repository = new PrismaWalletAuthRepository(database as unknown as DatabaseClient);
    const old = new Date(START.getTime() - 20 * 60 * 1_000);
    const expired = new Date(START.getTime() - 10 * 60 * 1_000);
    for (let index = 1; index <= 4; index += 1) {
      database.seedChallenge({
        ...challenge(`authc_stale_${index}`, expired),
        createdAt: old,
      });
      database.seedSession({
        expiresAt: expired,
        id: `auths_stale_${index}`,
        revokedAt: null,
        tokenHash: `hash_${index}`,
        wallet: WALLET,
      });
    }
    database.seedChallenge({
      ...challenge('authc_window_evidence', expired),
      createdAt: new Date(START.getTime() - 30_000),
    });
    database.seedSession({
      expiresAt: new Date(START.getTime() + 60_000),
      id: 'auths_live',
      revokedAt: null,
      tokenHash: 'hash_live',
      wallet: WALLET,
    });

    await issue(repository, database, 'authc_fresh', START, 10, 2);

    expect(database.challengeIds()).toEqual([
      'authc_fresh',
      'authc_stale_3',
      'authc_stale_4',
      'authc_window_evidence',
    ]);
    expect(database.sessionIds()).toEqual(['auths_live', 'auths_stale_3', 'auths_stale_4']);
    expect(database.cleanupTakeValues).toEqual([2, 2]);
  });

  test('preserves exactly-once challenge consumption while cleaning expired auth rows', async () => {
    const database = new FakeAuthDatabase();
    const repository = new PrismaWalletAuthRepository(database as unknown as DatabaseClient);
    database.seedChallenge({
      ...challenge('authc_current', new Date(START.getTime() + 60_000)),
      createdAt: START,
    });
    database.seedSession({
      expiresAt: new Date(START.getTime() + 60_000),
      id: 'auths_revoked',
      revokedAt: new Date(START.getTime() - 1_000),
      tokenHash: 'hash_revoked',
      wallet: WALLET,
    });
    const maintenance = maintenancePolicy(START, 10);
    const session = {
      expiresAt: new Date(START.getTime() + 15 * 60 * 1_000),
      id: 'auths_current',
      tokenHash: 'hash_current',
      wallet: WALLET,
    };

    await repository.consumeChallengeAndCreateSession('authc_current', session, maintenance);

    await expect(
      repository.consumeChallengeAndCreateSession('authc_current', session, maintenance),
    ).rejects.toThrow('expired or already used');
    expect(database.sessionIds()).toEqual(['auths_current']);
  });
});

async function issue(
  repository: PrismaWalletAuthRepository,
  database: FakeAuthDatabase,
  id: string,
  now: Date,
  limit: number,
  cleanupBatchSize = 100,
) {
  database.now = now;
  return repository.createChallenge(challenge(id, new Date(now.getTime() + 5 * 60 * 1_000)), {
    ...maintenancePolicy(now, cleanupBatchSize),
    challengeLimit: limit,
    challengeWindowStartedAt: new Date(now.getTime() - 60_000),
  });
}

function maintenancePolicy(now: Date, cleanupBatchSize: number): WalletAuthMaintenancePolicy {
  return {
    challengeCreatedBefore: new Date(now.getTime() - 60_000),
    cleanupBatchSize,
    now,
  };
}

function challenge(id: string, expiresAt: Date): CreateWalletAuthChallengeRecord {
  return {
    chain: 'solana:devnet',
    consumedAt: null,
    domain: 'localhost:3001',
    expiresAt,
    id,
    message: `Sign ${id}`,
    nonceHash: `nonce_${id}`,
    uri: 'http://localhost:3001',
    wallet: WALLET,
  };
}

type ChallengeRow = CreateWalletAuthChallengeRecord & { createdAt: Date };
type SessionRow = {
  expiresAt: Date;
  id: string;
  revokedAt: Date | null;
  tokenHash: string;
  wallet: string;
};

class FakeAuthDatabase {
  readonly #challenges = new Map<string, ChallengeRow>();
  readonly #sessions = new Map<string, SessionRow>();
  advisoryLockCount = 0;
  cleanupTakeValues: number[] = [];
  now = START;

  readonly walletAuthChallenge = {
    count: async (query: {
      where: { createdAt: { gte: Date }; wallet: string };
    }): Promise<number> =>
      [...this.#challenges.values()].filter(
        (row) => row.wallet === query.where.wallet && row.createdAt >= query.where.createdAt.gte,
      ).length,
    create: async ({ data }: { data: CreateWalletAuthChallengeRecord }) => {
      const row = { ...data, createdAt: this.now };
      this.#challenges.set(row.id, row);
      return row;
    },
    deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
      for (const id of where.id.in) this.#challenges.delete(id);
      return { count: where.id.in.length };
    },
    findMany: async (query: {
      take: number;
      where: {
        consumedAt: null;
        createdAt: { lt: Date };
        expiresAt: { lte: Date };
      };
    }) => {
      this.cleanupTakeValues.push(query.take);
      return [...this.#challenges.values()]
        .filter(
          (row) =>
            !row.consumedAt &&
            row.createdAt < query.where.createdAt.lt &&
            row.expiresAt <= query.where.expiresAt.lte,
        )
        .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime())
        .slice(0, query.take)
        .map(({ id }) => ({ id }));
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.#challenges.get(where.id) ?? null,
    updateMany: async ({
      data,
      where,
    }: {
      data: { consumedAt: Date };
      where: { consumedAt: null; expiresAt: { gt: Date }; id: string; wallet: string };
    }) => {
      const row = this.#challenges.get(where.id);
      if (
        !row ||
        row.consumedAt ||
        row.expiresAt <= where.expiresAt.gt ||
        row.wallet !== where.wallet
      ) {
        return { count: 0 };
      }
      this.#challenges.set(row.id, { ...row, consumedAt: data.consumedAt });
      return { count: 1 };
    },
  };

  readonly walletSession = {
    create: async ({ data }: { data: Omit<SessionRow, 'revokedAt'> }) => {
      const row = { ...data, revokedAt: null };
      this.#sessions.set(row.id, row);
      return row;
    },
    deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
      for (const id of where.id.in) this.#sessions.delete(id);
      return { count: where.id.in.length };
    },
    findMany: async (query: { take: number; where: { OR: unknown[] } }) => {
      this.cleanupTakeValues.push(query.take);
      return [...this.#sessions.values()]
        .filter((row) => row.expiresAt <= this.now || row.revokedAt)
        .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime())
        .slice(0, query.take)
        .map(({ id }) => ({ id }));
    },
  };

  readonly $executeRaw = async () => {
    this.advisoryLockCount += 1;
    return 1;
  };

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    return operation(this);
  }

  challengeIds(): string[] {
    return [...this.#challenges.keys()].sort();
  }

  seedChallenge(row: ChallengeRow): void {
    this.#challenges.set(row.id, row);
  }

  seedSession(row: SessionRow): void {
    this.#sessions.set(row.id, row);
  }

  sessionIds(): string[] {
    return [...this.#sessions.values()].map(({ id }) => id).sort();
  }
}
