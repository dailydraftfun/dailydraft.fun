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
  "activePayerWallet" = "payerWallet",
  "activeMachineKey" = "machineKey",
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
