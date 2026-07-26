import type { Prisma } from '@dailydraft/db';

/**
 * `pg_advisory_xact_lock` returns Postgres `void`, which the Prisma driver adapter has no mapping
 * for: `$queryRaw` deserializes every returned column and throws `UnsupportedNativeDataType`
 * (surfaced as P2010) before the caller ever sees a row. `$executeRaw` runs the same statement
 * without deserializing columns, so it is the only safe way to take these locks. Route every
 * advisory lock through these helpers rather than hand-rolling the raw call.
 */

/** Takes a transaction-scoped advisory lock on a constant 64-bit key. */
export async function acquireAdvisoryTransactionLock(
  transaction: Prisma.TransactionClient,
  key: bigint | number,
): Promise<void> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(key)}::bigint)`;
}

/** Takes a transaction-scoped advisory lock on a text key hashed into a numeric namespace. */
export async function acquireNamespacedAdvisoryTransactionLock(
  transaction: Prisma.TransactionClient,
  key: string,
  namespace: bigint | number,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, ${BigInt(namespace)}::bigint))
  `;
}
