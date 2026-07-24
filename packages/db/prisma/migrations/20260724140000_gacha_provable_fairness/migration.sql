CREATE TABLE "GachaRipSeedCommitment" (
    "id" TEXT NOT NULL,
    "machineKey" TEXT NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "consumedByRipId" TEXT,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GachaRipSeedCommitment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GachaRip"
ADD COLUMN "idempotencyKey" TEXT;

-- A FAILED rip never delivered its asset to the recipient, so its selected asset
-- must return to the eligible pool for the next rip against the same snapshot.
-- selectedAssetReference is widened to nullable and cleared on the FAILED
-- transition so the depletion unique index below only ever covers assets that
-- were actually claimed; failedAssetReference preserves the audit trail.
ALTER TABLE "GachaRip"
ADD COLUMN "failedAssetReference" TEXT;

ALTER TABLE "GachaRip"
ALTER COLUMN "selectedAssetReference" DROP NOT NULL;

CREATE UNIQUE INDEX "GachaRipSeedCommitment_consumedByRipId_key"
ON "GachaRipSeedCommitment"("consumedByRipId");

CREATE INDEX "GachaRipSeedCommitment_machineKey_committedAt_idx"
ON "GachaRipSeedCommitment"("machineKey", "committedAt");

CREATE INDEX "GachaRipSeedCommitment_expiresAt_idx"
ON "GachaRipSeedCommitment"("expiresAt");

CREATE UNIQUE INDEX "GachaRip_snapshotContentHash_selectedAssetReference_key"
ON "GachaRip"("snapshotContentHash", "selectedAssetReference");

CREATE UNIQUE INDEX "GachaRip_machineKey_idempotencyKey_key"
ON "GachaRip"("machineKey", "idempotencyKey");

ALTER TABLE "GachaRipSeedCommitment"
ADD CONSTRAINT "GachaRipSeedCommitment_consumedByRipId_fkey"
FOREIGN KEY ("consumedByRipId") REFERENCES "GachaRip"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GachaRipSeedCommitment"
ADD CONSTRAINT "GachaRipSeedCommitment_contract_check" CHECK (
  "machineKey" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  AND "serverSeed" ~ '^[a-f0-9]{64}$'
  AND "serverSeedHash" ~ '^[a-f0-9]{64}$'
  AND "expiresAt" > "committedAt"
);
