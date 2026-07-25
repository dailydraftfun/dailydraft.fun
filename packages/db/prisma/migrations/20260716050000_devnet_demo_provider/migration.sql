ALTER TYPE "ProviderMode" ADD VALUE 'OPENPACKSDUEL_DEVNET';

CREATE TABLE "DevnetPackSnapshot" (
    "providerReference" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "side" "DuelSide" NOT NULL,
    "providerPackId" TEXT NOT NULL,
    "pokemonCardId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "insuredValueAmount" TEXT NOT NULL,
    "priceVariant" TEXT NOT NULL,
    "priceUpdatedAt" TEXT NOT NULL,
    "sourceTimestamp" TIMESTAMP(3) NOT NULL,
    "depositLeaseOwner" TEXT,
    "depositLeaseExpiresAt" TIMESTAMP(3),
    "depositSignature" TEXT,
    "assetReference" TEXT,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevnetPackSnapshot_pkey" PRIMARY KEY ("providerReference")
);

CREATE UNIQUE INDEX "DevnetPackSnapshot_duelId_side_key"
ON "DevnetPackSnapshot"("duelId", "side");

CREATE INDEX "DevnetPackSnapshot_pokemonCardId_createdAt_idx"
ON "DevnetPackSnapshot"("pokemonCardId", "createdAt");

ALTER TABLE "DevnetPackSnapshot"
ADD CONSTRAINT "DevnetPackSnapshot_duelId_fkey"
FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DuelPackOutcome"
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "valuationSourceReference" TEXT;

ALTER TABLE "DuelTransaction"
ADD COLUMN "lastRecoveryCheckedBlockHeight" BIGINT;
