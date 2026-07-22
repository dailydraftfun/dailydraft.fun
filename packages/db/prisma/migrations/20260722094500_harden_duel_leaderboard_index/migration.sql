-- Prisma PostgreSQL migrations run without an implicit transaction. Keep these
-- operations concurrent so the hot Duel table remains writable during deploy.
DROP INDEX CONCURRENTLY IF EXISTS "Duel_status_settledAt_id_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Duel_status_providerMode_settledAt_id_idx"
ON "Duel"("status", "providerMode", "settledAt", "id");
