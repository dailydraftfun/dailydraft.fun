CREATE TYPE "GachaRipPaymentStatus" AS ENUM (
    'PENDING',
    'VERIFIED',
    'CONSUMED',
    'EXPIRED'
);

CREATE TABLE "GachaRipPayment" (
    "id" TEXT NOT NULL,
    "machineKey" TEXT NOT NULL,
    "status" "GachaRipPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "network" "SolanaNetwork" NOT NULL DEFAULT 'DEVNET',
    "payerWallet" TEXT NOT NULL,
    "destinationTokenAccount" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "amountMinor" TEXT NOT NULL,
    "amountCurrency" TEXT NOT NULL DEFAULT 'USDC',
    "amountDecimals" INTEGER NOT NULL DEFAULT 6,
    "memoNonce" TEXT NOT NULL,
    "signature" TEXT,
    "mintVerifiedOnChain" BOOLEAN NOT NULL DEFAULT false,
    "consumedByRipId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GachaRipPayment_pkey" PRIMARY KEY ("id")
);

-- The memo nonce is the only thing binding a landed transfer to one intent, so
-- reusing one would let a single payment answer two intents. The signature index
-- closes the other direction: one settled transaction can fund at most one row.
CREATE UNIQUE INDEX "GachaRipPayment_memoNonce_key"
ON "GachaRipPayment"("memoNonce");

CREATE UNIQUE INDEX "GachaRipPayment_signature_key"
ON "GachaRipPayment"("signature");

CREATE UNIQUE INDEX "GachaRipPayment_consumedByRipId_key"
ON "GachaRipPayment"("consumedByRipId");

CREATE INDEX "GachaRipPayment_machineKey_createdAt_idx"
ON "GachaRipPayment"("machineKey", "createdAt");

CREATE INDEX "GachaRipPayment_status_expiresAt_idx"
ON "GachaRipPayment"("status", "expiresAt");

CREATE INDEX "GachaRipPayment_payerWallet_createdAt_idx"
ON "GachaRipPayment"("payerWallet", "createdAt");

ALTER TABLE "GachaRipPayment"
ADD CONSTRAINT "GachaRipPayment_machineKey_fkey"
FOREIGN KEY ("machineKey") REFERENCES "GachaMachine"("machineKey")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GachaRipPayment"
ADD CONSTRAINT "GachaRipPayment_consumedByRipId_fkey"
FOREIGN KEY ("consumedByRipId") REFERENCES "GachaRip"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GachaRipPayment"
ADD CONSTRAINT "GachaRipPayment_contract_check" CHECK (
  "machineKey" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  AND "memoNonce" ~ '^gachapay_[a-f0-9]{32}$'
  AND "payerWallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  AND "destinationTokenAccount" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  AND "mint" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  AND "amountMinor" ~ '^[0-9]+$'
  AND "amountCurrency" = 'USDC'
  AND "amountDecimals" = 6
  AND "expiresAt" > "createdAt"
  AND (
    (
      "status" = 'PENDING'
      AND "signature" IS NULL
      AND "verifiedAt" IS NULL
      AND "consumedByRipId" IS NULL
      AND "consumedAt" IS NULL
    )
    OR (
      "status" = 'VERIFIED'
      AND "signature" IS NOT NULL
      AND "verifiedAt" IS NOT NULL
      AND "consumedByRipId" IS NULL
      AND "consumedAt" IS NULL
    )
    OR (
      "status" = 'CONSUMED'
      AND "signature" IS NOT NULL
      AND "verifiedAt" IS NOT NULL
      AND "consumedByRipId" IS NOT NULL
      AND "consumedAt" IS NOT NULL
    )
    OR (
      -- An intent can only expire before it is verified; once a transfer has
      -- landed the evidence stays on the row rather than being timed out.
      "status" = 'EXPIRED'
      AND "signature" IS NULL
      AND "verifiedAt" IS NULL
      AND "consumedByRipId" IS NULL
      AND "consumedAt" IS NULL
    )
  )
  AND ("signature" IS NULL OR "signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$')
);
