-- Keep this as one statement so Prisma does not wrap CONCURRENTLY in a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Duel_status_settledAt_id_idx"
ON "Duel"("status", "settledAt", "id");
