import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabaseClient, type DatabaseClient } from '@dailydraft/db';
import { PrismaWalletAuthRepository } from '../auth/prisma-auth.repository.js';
import {
  acquireAdvisoryTransactionLock,
  acquireNamespacedAdvisoryTransactionLock,
} from './advisory-lock.js';

const API_SOURCE_ROOT = join(import.meta.dir, '..');
const databaseUrl = process.env.DATABASE_URL;

// The CI database lane sets REQUIRE_DB_INTEGRATION=1 so a missing DATABASE_URL fails the build
// instead of silently skipping the only coverage that exercises the real driver.
if (process.env.REQUIRE_DB_INTEGRATION === '1' && !databaseUrl) {
  throw new Error('REQUIRE_DB_INTEGRATION=1 but DATABASE_URL is unset');
}

async function* walkSourceFiles(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkSourceFiles(path);
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) yield path;
  }
}

// Static guard: mocks cannot catch a `$queryRaw` advisory lock because a fake never deserializes
// the `void` column the real driver chokes on. Every lock must go through the helper.
test('no production source takes an advisory lock through $queryRaw', async () => {
  const offenders: string[] = [];
  for await (const path of walkSourceFiles(API_SOURCE_ROOT)) {
    if (path === join(import.meta.dir, 'advisory-lock.ts')) continue;
    const source = await readFile(path, 'utf8');
    if (source.includes('pg_advisory')) offenders.push(path.slice(API_SOURCE_ROOT.length + 1));
  }
  expect(offenders).toEqual([]);
});

const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('advisory locks against a real Postgres', () => {
  let database: DatabaseClient;

  beforeAll(() => {
    database = createDatabaseClient(databaseUrl);
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  test('acquires a constant-key lock without a deserialization failure', async () => {
    await expect(
      database.$transaction(async (transaction) => {
        await acquireAdvisoryTransactionLock(transaction, 770_392_114);
        return 'locked';
      }),
    ).resolves.toBe('locked');
  });

  test('acquires a namespaced lock and is reentrant inside one transaction', async () => {
    await expect(
      database.$transaction(async (transaction) => {
        await acquireNamespacedAdvisoryTransactionLock(transaction, 'pool-key', 1_584_503_769);
        await acquireNamespacedAdvisoryTransactionLock(transaction, 'pool-key', 1_584_503_769);
        return 'locked';
      }),
    ).resolves.toBe('locked');
  });

  test('serializes concurrent transactions holding the same namespaced key', async () => {
    const order: string[] = [];
    const hold = async (label: string, delayMs: number) => {
      await database.$transaction(async (transaction) => {
        await acquireNamespacedAdvisoryTransactionLock(transaction, 'contended', 1_584_503_769);
        order.push(`${label}:enter`);
        await Bun.sleep(delayMs);
        order.push(`${label}:exit`);
      });
    };

    await Promise.all([hold('first', 40), hold('second', 0)]);

    // Whichever transaction wins the race must fully release before the other enters.
    expect(order).toHaveLength(4);
    const disjoint =
      order.indexOf('first:exit') < order.indexOf('second:enter') ||
      order.indexOf('second:exit') < order.indexOf('first:enter');
    expect(disjoint).toBe(true);
  });

  test('issues a wallet auth challenge end to end', async () => {
    const repository = new PrismaWalletAuthRepository(database);
    const wallet = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
    const now = new Date();
    const challengeId = `authc_dbtest_${crypto.randomUUID().replaceAll('-', '')}`;

    const challenge = await repository.createChallenge(
      {
        chain: 'solana:devnet',
        consumedAt: null,
        domain: 'dailydraft.fun',
        expiresAt: new Date(now.getTime() + 300_000),
        id: challengeId,
        message: 'dailydraft.fun wants you to sign in',
        nonceHash: `nonce_${challengeId}`,
        uri: 'https://dailydraft.fun',
        wallet,
      },
      {
        challengeCreatedBefore: new Date(now.getTime() - 86_400_000),
        challengeLimit: 5,
        challengeWindowStartedAt: new Date(now.getTime() - 600_000),
        cleanupBatchSize: 100,
        now,
      },
    );

    expect(challenge.id).toBe(challengeId);
    await database.walletAuthChallenge.delete({ where: { id: challengeId } });
  });
});
