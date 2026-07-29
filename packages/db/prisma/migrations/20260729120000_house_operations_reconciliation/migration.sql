ALTER TABLE "HouseTreasurySnapshot"
ADD COLUMN "observedSlot" TEXT DEFAULT '0';

UPDATE "HouseTreasurySnapshot"
SET "observedSlot" = '0'
WHERE "observedSlot" IS NULL;

ALTER TABLE "HouseTreasurySnapshot"
ALTER COLUMN "observedSlot" SET NOT NULL;

ALTER TABLE "HouseInventoryAsset"
ADD COLUMN "dispositionReason" TEXT,
ADD COLUMN "dispositionRequestedAt" TIMESTAMP(3),
ADD COLUMN "realizedFeeAmount" TEXT,
ADD COLUMN "realizedGainLossAmount" TEXT,
ADD COLUMN "lastReconciledSlot" TEXT;

CREATE TABLE "HouseReconciliationDiscrepancy" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityReference" TEXT NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "observedValue" TEXT NOT NULL,
    "observedSlot" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HouseReconciliationDiscrepancy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HouseReconciliationDiscrepancy_idempotencyKey_key"
ON "HouseReconciliationDiscrepancy"("idempotencyKey");

CREATE INDEX "HouseReconciliationDiscrepancy_resolvedAt_kind_firstObserve_idx"
ON "HouseReconciliationDiscrepancy"("resolvedAt", "kind", "firstObservedAt");

CREATE INDEX "HouseReconciliationDiscrepancy_entityReference_resolvedAt_idx"
ON "HouseReconciliationDiscrepancy"("entityReference", "resolvedAt");

ALTER TABLE "HouseTreasurySnapshot"
ADD CONSTRAINT "HouseTreasurySnapshot_observed_slot_check"
CHECK ("observedSlot" ~ '^[0-9]+$');

-- Legacy disposition completions stored proceeds directly in realizedAmount
-- without a fee field. Preserve those proceeds as zero-fee net proceeds and
-- derive their gain/loss before validating the expanded accounting contract.
UPDATE "HouseInventoryAsset"
SET
  "realizedFeeAmount" = '0',
  "realizedGainLossAmount" = (
    "realizedAmount"::NUMERIC - "acquisitionValueAmount"::NUMERIC
  )::TEXT
WHERE "realizedAmount" IS NOT NULL;

ALTER TABLE "HouseInventoryAsset"
ADD CONSTRAINT "HouseInventoryAsset_disposition_request_check" CHECK (
  ("dispositionRequestedAt" IS NULL AND "dispositionReason" IS NULL)
  OR ("dispositionRequestedAt" IS NOT NULL AND length("dispositionReason") BETWEEN 3 AND 160)
),
-- Keep the legacy realizedAmount-only write shape valid while the previous API
-- remains the rollback target. A later contract migration can require fee and
-- gain/loss after this release is fully promoted.
ADD CONSTRAINT "HouseInventoryAsset_realized_accounting_check" CHECK (
  (
    "realizedAmount" IS NULL
    AND "realizedFeeAmount" IS NULL
    AND "realizedGainLossAmount" IS NULL
  )
  OR (
    "realizedAmount" ~ '^[0-9]+$'
    AND (
      (
        "realizedFeeAmount" IS NULL
        AND "realizedGainLossAmount" IS NULL
      )
      OR (
        "realizedFeeAmount" ~ '^[0-9]+$'
        AND "realizedGainLossAmount" ~ '^-?[0-9]+$'
      )
    )
  )
) NOT VALID,
ADD CONSTRAINT "HouseInventoryAsset_reconciled_slot_check"
CHECK ("lastReconciledSlot" IS NULL OR "lastReconciledSlot" ~ '^[0-9]+$');

ALTER TABLE "HouseInventoryAsset"
VALIDATE CONSTRAINT "HouseInventoryAsset_realized_accounting_check";

ALTER TABLE "HouseReconciliationDiscrepancy"
ADD CONSTRAINT "HouseReconciliationDiscrepancy_slot_check"
CHECK ("observedSlot" ~ '^[0-9]+$'),
ADD CONSTRAINT "HouseReconciliationDiscrepancy_value_check"
CHECK (
  "expectedValue" ~ '^-?[0-9]+$'
  AND "observedValue" ~ '^-?[0-9]+$'
  AND length("detail") BETWEEN 3 AND 160
);
