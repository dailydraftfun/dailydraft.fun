ALTER TABLE "GachaRipPayment"
ADD COLUMN "activePayerWallet" TEXT,
ADD COLUMN "activeMachineKey" TEXT,
ADD COLUMN "signatureClaimedAt" TIMESTAMP(3),
ADD COLUMN "terminalAt" TIMESTAMP(3),
ADD COLUMN "terminalReason" TEXT;

-- Never guess which unresolved payment should own a payer+machine slot. If an
-- older deployment already issued duplicates, stop the migration so operators
-- can reconcile them on chain instead of silently releasing a possible payment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "GachaRipPayment"
    WHERE "status" IN ('PENDING', 'VERIFIED')
    GROUP BY "payerWallet", "machineKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'duplicate unresolved Gacha payments require reconciliation before migration';
  END IF;
END
$$;

UPDATE "GachaRipPayment"
SET
  "activePayerWallet" = CASE
    WHEN "status" IN ('PENDING', 'VERIFIED') THEN "payerWallet"
    ELSE NULL
  END,
  "activeMachineKey" = CASE
    WHEN "status" IN ('PENDING', 'VERIFIED') THEN "machineKey"
    ELSE NULL
  END,
  "signatureClaimedAt" = CASE
    WHEN "signature" IS NOT NULL THEN COALESCE("verifiedAt", "updatedAt")
    ELSE NULL
  END,
  "terminalAt" = CASE
    WHEN "status" = 'CONSUMED' THEN COALESCE("consumedAt", "updatedAt")
    WHEN "status" = 'EXPIRED' THEN "updatedAt"
    ELSE NULL
  END,
  "terminalReason" = CASE
    WHEN "status" = 'CONSUMED' THEN 'CONSUMED_BY_RIP'
    WHEN "status" = 'EXPIRED' THEN 'UNCLAIMED_INTENT_EXPIRED'
    ELSE NULL
  END;

CREATE UNIQUE INDEX "GachaRipPayment_activePayerWallet_activeMachineKey_key"
ON "GachaRipPayment"("activePayerWallet", "activeMachineKey");

ALTER TABLE "GachaRipPayment"
DROP CONSTRAINT "GachaRipPayment_contract_check",
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
      "status" = 'EXPIRED'
      AND "signature" IS NULL
      AND "verifiedAt" IS NULL
      AND "consumedByRipId" IS NULL
      AND "consumedAt" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "signature" IS NOT NULL
      AND "verifiedAt" IS NULL
      AND "consumedByRipId" IS NULL
      AND "consumedAt" IS NULL
    )
  )
  AND ("signature" IS NULL OR "signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$')
);

ALTER TABLE "GachaRipPayment"
ADD CONSTRAINT "GachaRipPayment_active_slot_check" CHECK (
  (
    "status" IN ('PENDING', 'VERIFIED')
    AND "activePayerWallet" = "payerWallet"
    AND "activeMachineKey" = "machineKey"
  )
  OR (
    "status" IN ('CONSUMED', 'EXPIRED', 'FAILED')
    AND "activePayerWallet" IS NULL
    AND "activeMachineKey" IS NULL
  )
),
ADD CONSTRAINT "GachaRipPayment_signature_claim_check" CHECK (
  ("signature" IS NULL AND "signatureClaimedAt" IS NULL)
  OR ("signature" IS NOT NULL AND "signatureClaimedAt" IS NOT NULL)
),
ADD CONSTRAINT "GachaRipPayment_terminal_evidence_check" CHECK (
  (
    "status" IN ('PENDING', 'VERIFIED')
    AND "terminalAt" IS NULL
    AND "terminalReason" IS NULL
  )
  OR (
    "status" IN ('CONSUMED', 'EXPIRED', 'FAILED')
    AND "terminalAt" IS NOT NULL
    AND "terminalReason" IS NOT NULL
  )
);
