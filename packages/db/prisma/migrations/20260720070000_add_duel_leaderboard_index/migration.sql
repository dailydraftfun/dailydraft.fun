-- This migration must stay outside a transaction: CONCURRENTLY keeps the hot
-- Duel table writable while the public leaderboard index is built.
CREATE INDEX CONCURRENTLY "Duel_status_providerMode_settledAt_id_idx"
ON "Duel"("status", "providerMode", "settledAt", "id");
