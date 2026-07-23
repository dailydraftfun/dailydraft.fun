CREATE TYPE "FlipInventoryExclusionReason" AS ENUM (
    'EXPLICIT_EXCLUSION',
    'COLLECTION_NOT_ALLOWED',
    'GRADER_NOT_ALLOWED',
    'INVENTORY_STALE',
    'INVENTORY_FROM_FUTURE',
    'LIQUIDITY_BELOW_MINIMUM',
    'VALUE_UNAVAILABLE',
    'VALUE_STALE',
    'VALUE_FROM_FUTURE',
    'VALUE_BELOW_MINIMUM',
    'VALUE_ABOVE_MAXIMUM',
    'MAXIMUM_ITEM_COUNT',
    'MAXIMUM_EXPOSURE'
);

CREATE TABLE "FlipInventorySnapshot" (
    "id" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "stakeAmount" TEXT NOT NULL,
    "stakeCurrency" TEXT NOT NULL DEFAULT 'USDC',
    "stakeDecimals" INTEGER NOT NULL DEFAULT 6,
    "minimumValueAmount" TEXT NOT NULL,
    "maximumValueAmount" TEXT NOT NULL,
    "minimumLiquidityBasisPoints" INTEGER NOT NULL,
    "minimumEligibleItems" INTEGER NOT NULL,
    "maximumEligibleItems" INTEGER NOT NULL,
    "maximumExposureAmount" TEXT NOT NULL,
    "maximumSourceAgeMs" INTEGER NOT NULL,
    "maximumFutureSkewMs" INTEGER NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL,
    "eligibleValueAmount" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlipInventorySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlipInventorySnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "exclusionReasons" "FlipInventoryExclusionReason"[] NOT NULL,
    "providerAssetReference" TEXT NOT NULL,
    "providerListingReference" TEXT NOT NULL,
    "providerCollectionReference" TEXT NOT NULL,
    "providerGraderReference" TEXT NOT NULL,
    "normalizedCollection" TEXT NOT NULL,
    "normalizedGrader" TEXT NOT NULL,
    "liquidityBasisPoints" INTEGER NOT NULL,
    "inventorySourceTimestamp" TIMESTAMP(3) NOT NULL,
    "listingValueAmount" TEXT,
    "listingValueCurrency" TEXT,
    "listingValueDecimals" INTEGER,
    "listingValueProviderReference" TEXT,
    "listingValueSourceTimestamp" TIMESTAMP(3),
    "insuredValueAmount" TEXT,
    "insuredValueCurrency" TEXT,
    "insuredValueDecimals" INTEGER,
    "insuredValueProviderReference" TEXT,
    "insuredValueSourceTimestamp" TIMESTAMP(3),
    "buybackValueAmount" TEXT,
    "buybackValueCurrency" TEXT,
    "buybackValueDecimals" INTEGER,
    "buybackValueProviderReference" TEXT,
    "buybackValueSourceTimestamp" TIMESTAMP(3),
    "displayedValueAmount" TEXT,
    "displayedValueCurrency" TEXT,
    "displayedValueDecimals" INTEGER,
    "displayedValueProviderReference" TEXT,
    "displayedValueSourceTimestamp" TIMESTAMP(3),
    "eligibilityListingValueAmount" TEXT,
    "eligibilityListingValueCurrency" TEXT,
    "eligibilityListingValueDecimals" INTEGER,
    "eligibilityListingValueSourceTimestamp" TIMESTAMP(3),
    CONSTRAINT "FlipInventorySnapshotEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlipInventorySnapshot_poolKey_revision_key"
ON "FlipInventorySnapshot"("poolKey", "revision");

CREATE UNIQUE INDEX "FlipInventorySnapshot_poolKey_contentHash_key"
ON "FlipInventorySnapshot"("poolKey", "contentHash");

CREATE INDEX "FlipInventorySnapshot_poolKey_createdAt_idx"
ON "FlipInventorySnapshot"("poolKey", "createdAt");

CREATE UNIQUE INDEX "FlipInventorySnapshotEntry_snapshotId_ordinal_key"
ON "FlipInventorySnapshotEntry"("snapshotId", "ordinal");

CREATE UNIQUE INDEX "FlipInventorySnapshotEntry_snapshotId_providerAssetReference_key"
ON "FlipInventorySnapshotEntry"("snapshotId", "providerAssetReference");

CREATE UNIQUE INDEX "FlipInventorySnapshotEntry_snapshotId_providerListingReference_key"
ON "FlipInventorySnapshotEntry"("snapshotId", "providerListingReference");

CREATE INDEX "FlipInventorySnapshotEntry_snapshotId_eligible_ordinal_idx"
ON "FlipInventorySnapshotEntry"("snapshotId", "eligible", "ordinal");

ALTER TABLE "FlipInventorySnapshotEntry"
ADD CONSTRAINT "FlipInventorySnapshotEntry_snapshotId_fkey"
FOREIGN KEY ("snapshotId") REFERENCES "FlipInventorySnapshot"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FlipInventorySnapshot"
ADD CONSTRAINT "FlipInventorySnapshot_contract_check" CHECK (
  "revision" > 0
  AND "schemaVersion" = 'openpacksduel.flip-inventory.v1'
  AND "policyHash" ~ '^[a-f0-9]{64}$'
  AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND "stakeAmount" ~ '^[0-9]+$'
  AND "stakeCurrency" = 'USDC'
  AND "stakeDecimals" = 6
  AND "minimumValueAmount" ~ '^[0-9]+$'
  AND "maximumValueAmount" ~ '^[0-9]+$'
  AND "maximumExposureAmount" ~ '^[0-9]+$'
  AND "eligibleValueAmount" ~ '^[0-9]+$'
  AND "minimumLiquidityBasisPoints" BETWEEN 0 AND 10000
  AND "minimumEligibleItems" > 0
  AND "maximumEligibleItems" >= "minimumEligibleItems"
  AND "maximumSourceAgeMs" > 0
  AND "maximumFutureSkewMs" >= 0
  AND "eligibleCount" >= "minimumEligibleItems"
  AND "eligibleCount" <= "maximumEligibleItems"
  AND "excludedCount" >= 0
  AND jsonb_typeof("policy") = 'object'
);

ALTER TABLE "FlipInventorySnapshotEntry"
ADD CONSTRAINT "FlipInventorySnapshotEntry_decision_check" CHECK (
  "ordinal" >= 0
  AND "liquidityBasisPoints" BETWEEN 0 AND 10000
  AND (
    (
      "eligible"
      AND cardinality("exclusionReasons") = 0
      AND "eligibilityListingValueAmount" IS NOT NULL
      AND "eligibilityListingValueCurrency" IS NOT NULL
      AND "eligibilityListingValueDecimals" IS NOT NULL
      AND "eligibilityListingValueSourceTimestamp" IS NOT NULL
    )
    OR
    (NOT "eligible" AND cardinality("exclusionReasons") > 0)
  )
);

ALTER TABLE "FlipInventorySnapshotEntry"
ADD CONSTRAINT "FlipInventorySnapshotEntry_listing_value_check" CHECK (
  (
    "listingValueAmount" IS NULL
    AND "listingValueCurrency" IS NULL
    AND "listingValueDecimals" IS NULL
    AND "listingValueProviderReference" IS NULL
    AND "listingValueSourceTimestamp" IS NULL
  )
  OR (
    "listingValueAmount" IS NOT NULL
    AND "listingValueCurrency" IS NOT NULL
    AND "listingValueDecimals" IS NOT NULL
    AND "listingValueProviderReference" IS NOT NULL
    AND "listingValueSourceTimestamp" IS NOT NULL
    AND "listingValueAmount" ~ '^[0-9]+$'
    AND "listingValueCurrency" = 'USDC'
    AND "listingValueDecimals" BETWEEN 0 AND 18
  )
);

ALTER TABLE "FlipInventorySnapshotEntry"
ADD CONSTRAINT "FlipInventorySnapshotEntry_insured_value_check" CHECK (
  (
    "insuredValueAmount" IS NULL
    AND "insuredValueCurrency" IS NULL
    AND "insuredValueDecimals" IS NULL
    AND "insuredValueProviderReference" IS NULL
    AND "insuredValueSourceTimestamp" IS NULL
  )
  OR (
    "insuredValueAmount" IS NOT NULL
    AND "insuredValueCurrency" IS NOT NULL
    AND "insuredValueDecimals" IS NOT NULL
    AND "insuredValueProviderReference" IS NOT NULL
    AND "insuredValueSourceTimestamp" IS NOT NULL
    AND "insuredValueAmount" ~ '^[0-9]+$'
    AND "insuredValueCurrency" = 'USDC'
    AND "insuredValueDecimals" BETWEEN 0 AND 18
  )
);

ALTER TABLE "FlipInventorySnapshotEntry"
ADD CONSTRAINT "FlipInventorySnapshotEntry_buyback_value_check" CHECK (
  (
    "buybackValueAmount" IS NULL
    AND "buybackValueCurrency" IS NULL
    AND "buybackValueDecimals" IS NULL
    AND "buybackValueProviderReference" IS NULL
    AND "buybackValueSourceTimestamp" IS NULL
  )
  OR (
    "buybackValueAmount" IS NOT NULL
    AND "buybackValueCurrency" IS NOT NULL
    AND "buybackValueDecimals" IS NOT NULL
    AND "buybackValueProviderReference" IS NOT NULL
    AND "buybackValueSourceTimestamp" IS NOT NULL
    AND "buybackValueAmount" ~ '^[0-9]+$'
    AND "buybackValueCurrency" = 'USDC'
    AND "buybackValueDecimals" BETWEEN 0 AND 18
  )
);

ALTER TABLE "FlipInventorySnapshotEntry"
ADD CONSTRAINT "FlipInventorySnapshotEntry_displayed_value_check" CHECK (
  (
    "displayedValueAmount" IS NULL
    AND "displayedValueCurrency" IS NULL
    AND "displayedValueDecimals" IS NULL
    AND "displayedValueProviderReference" IS NULL
    AND "displayedValueSourceTimestamp" IS NULL
  )
  OR (
    "displayedValueAmount" IS NOT NULL
    AND "displayedValueCurrency" IS NOT NULL
    AND "displayedValueDecimals" IS NOT NULL
    AND "displayedValueProviderReference" IS NOT NULL
    AND "displayedValueSourceTimestamp" IS NOT NULL
    AND "displayedValueAmount" ~ '^[0-9]+$'
    AND "displayedValueCurrency" = 'USDC'
    AND "displayedValueDecimals" BETWEEN 0 AND 18
  )
);

ALTER TABLE "FlipInventorySnapshotEntry"
ADD CONSTRAINT "FlipInventorySnapshotEntry_eligibility_listing_value_check" CHECK (
  (
    "eligibilityListingValueAmount" IS NULL
    AND "eligibilityListingValueCurrency" IS NULL
    AND "eligibilityListingValueDecimals" IS NULL
    AND "eligibilityListingValueSourceTimestamp" IS NULL
  )
  OR (
    "eligibilityListingValueAmount" IS NOT NULL
    AND "eligibilityListingValueCurrency" IS NOT NULL
    AND "eligibilityListingValueDecimals" IS NOT NULL
    AND "eligibilityListingValueSourceTimestamp" IS NOT NULL
    AND "eligibilityListingValueAmount" ~ '^[0-9]+$'
    AND "eligibilityListingValueCurrency" = 'USDC'
    AND "eligibilityListingValueDecimals" = 6
  )
);

CREATE FUNCTION "reject_flip_inventory_snapshot_mutation"() RETURNS trigger AS $$
DECLARE
  actual_eligible_count BIGINT;
  actual_eligible_value NUMERIC;
  actual_maximum_ordinal INTEGER;
  actual_minimum_ordinal INTEGER;
  actual_total_count BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."sealedAt" IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Flip inventory snapshots must be created unsealed';
  END IF;
  IF (
    TG_OP = 'UPDATE'
    AND OLD."sealedAt" IS NULL
    AND NEW."sealedAt" IS NOT NULL
    AND (to_jsonb(NEW) - 'sealedAt') = (to_jsonb(OLD) - 'sealedAt')
  ) THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE "eligible"),
      COALESCE(sum("eligibilityListingValueAmount"::NUMERIC) FILTER (WHERE "eligible"), 0),
      min("ordinal"),
      max("ordinal")
    INTO
      actual_total_count,
      actual_eligible_count,
      actual_eligible_value,
      actual_minimum_ordinal,
      actual_maximum_ordinal
    FROM "FlipInventorySnapshotEntry"
    WHERE "snapshotId" = NEW."id";

    IF (
      actual_total_count <> NEW."eligibleCount" + NEW."excludedCount"
      OR actual_eligible_count <> NEW."eligibleCount"
      OR actual_eligible_value <> NEW."eligibleValueAmount"::NUMERIC
      OR actual_minimum_ordinal <> 0
      OR actual_maximum_ordinal <> actual_total_count - 1
    ) THEN
      RAISE EXCEPTION 'Flip inventory snapshot contents do not match metadata';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Flip inventory snapshots are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipInventorySnapshot_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "FlipInventorySnapshot"
FOR EACH ROW EXECUTE FUNCTION "reject_flip_inventory_snapshot_mutation"();

CREATE FUNCTION "require_flip_inventory_snapshot_sealed"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FlipInventorySnapshot"
    WHERE "id" = NEW."id"
      AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Flip inventory snapshot must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "FlipInventorySnapshot_sealed_before_commit"
AFTER INSERT ON "FlipInventorySnapshot"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_flip_inventory_snapshot_sealed"();

CREATE FUNCTION "reject_flip_inventory_entry_after_seal"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FlipInventorySnapshot"
    WHERE "id" = NEW."snapshotId"
      AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Flip inventory snapshot entries are sealed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipInventorySnapshotEntry_sealed"
BEFORE INSERT ON "FlipInventorySnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION "reject_flip_inventory_entry_after_seal"();

CREATE FUNCTION "reject_flip_inventory_entry_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Flip inventory snapshots are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipInventorySnapshotEntry_append_only"
BEFORE UPDATE OR DELETE ON "FlipInventorySnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION "reject_flip_inventory_entry_mutation"();
