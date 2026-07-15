CREATE TYPE "DuelSide" AS ENUM ('CREATOR', 'OPPONENT');

ALTER TABLE "Duel"
ADD COLUMN "resultHash" TEXT,
ADD COLUMN "resultReadyAt" TIMESTAMP(3);

CREATE TABLE "DuelPackOutcome" (
  "id" TEXT NOT NULL,
  "duelId" TEXT NOT NULL,
  "side" "DuelSide" NOT NULL,
  "provider" TEXT NOT NULL,
  "providerReference" TEXT NOT NULL,
  "assetReference" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "insuredValueAmount" TEXT NOT NULL,
  "insuredValueCurrency" TEXT NOT NULL DEFAULT 'USDC',
  "insuredValueDecimals" INTEGER NOT NULL DEFAULT 6,
  "valuationPolicyHash" TEXT NOT NULL,
  "resultHash" TEXT NOT NULL,
  "isMock" BOOLEAN NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DuelPackOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DuelPackOutcome_duelId_side_key" ON "DuelPackOutcome"("duelId", "side");
CREATE UNIQUE INDEX "DuelPackOutcome_provider_providerReference_key" ON "DuelPackOutcome"("provider", "providerReference");
CREATE INDEX "DuelPackOutcome_duelId_openedAt_idx" ON "DuelPackOutcome"("duelId", "openedAt");

ALTER TABLE "DuelPackOutcome"
ADD CONSTRAINT "DuelPackOutcome_duelId_fkey"
FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
