ALTER TYPE "DuelTransactionAction" ADD VALUE IF NOT EXISTS 'COMMIT_RESULT';

ALTER TABLE "DuelTransaction"
DROP CONSTRAINT IF EXISTS "DuelTransaction_duelId_wallet_action_key";

CREATE INDEX IF NOT EXISTS "DuelTransaction_duelId_wallet_action_idx"
ON "DuelTransaction"("duelId", "wallet", "action");
