-- The result-commitment migration intended to replace this unique index with
-- a non-unique index, but PostgreSQL indexes are not table constraints.
DROP INDEX IF EXISTS "DuelTransaction_duelId_wallet_action_key";
