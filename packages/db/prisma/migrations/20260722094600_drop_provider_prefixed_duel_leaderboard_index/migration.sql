-- Keep this as one statement so Prisma does not wrap CONCURRENTLY in a transaction.
DROP INDEX CONCURRENTLY IF EXISTS "Duel_status_providerMode_settledAt_id_idx";
