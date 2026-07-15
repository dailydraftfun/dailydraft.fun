ALTER TABLE "DuelTransaction"
ADD COLUMN "expectedMessageHash" TEXT;

CREATE UNIQUE INDEX "DuelTransaction_duelId_wallet_action_key"
ON "DuelTransaction"("duelId", "wallet", "action");
