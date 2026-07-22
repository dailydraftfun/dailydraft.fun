-- Repair databases that applied the short-lived provider-prefixed index from
-- PR #151. Keep the sort keys adjacent to status so ORDER BY can stop at LIMIT.
DROP INDEX CONCURRENTLY IF EXISTS "Duel_status_providerMode_settledAt_id_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Duel_status_settledAt_id_idx"
ON "Duel"("status", "settledAt", "id");
