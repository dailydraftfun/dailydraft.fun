CREATE TYPE "GachaRipPaymentStatus" AS ENUM (
    'PENDING',
    'VERIFIED',
    'CONSUMED',
    'EXPIRED'
);

-- Persist the delivery target and serialize resumable post-commit provider work.
-- Existing fixture rows predate recovery and remain nullable; every new rip
-- writes recipientWallet before a payment or seed can be consumed.
ALTER TABLE "GachaRip"
ADD COLUMN "recipientWallet" TEXT,
ADD COLUMN "lifecycleLeaseOwner" TEXT,
ADD COLUMN "lifecycleLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "GachaRip_status_lifecycleLeaseExpiresAt_idx"
ON "GachaRip"("status", "lifecycleLeaseExpiresAt");

ALTER TABLE "GachaRip"
ADD CONSTRAINT "GachaRip_lifecycle_recovery_check" CHECK (
  (
    "recipientWallet" IS NULL
    OR (
      length("recipientWallet") BETWEEN 1 AND 240
      AND btrim("recipientWallet") = "recipientWallet"
    )
  )
  AND (
    (
      "lifecycleLeaseOwner" IS NULL
      AND "lifecycleLeaseExpiresAt" IS NULL
    )
    OR (
      "lifecycleLeaseOwner" IS NOT NULL
      AND length("lifecycleLeaseOwner") BETWEEN 1 AND 120
      AND "lifecycleLeaseExpiresAt" IS NOT NULL
    )
  )
  AND (
    "status" NOT IN ('SETTLED', 'FAILED')
    OR (
      "lifecycleLeaseOwner" IS NULL
      AND "lifecycleLeaseExpiresAt" IS NULL
    )
  )
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
