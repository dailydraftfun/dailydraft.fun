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
