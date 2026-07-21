ALTER TABLE "HouseInventoryAsset"
ADD COLUMN "insuredValueAmount" TEXT,
ADD COLUMN "insuredValueCurrency" TEXT,
ADD COLUMN "insuredValueDecimals" INTEGER,
ADD COLUMN "listingValueAmount" TEXT,
ADD COLUMN "listingValueCurrency" TEXT,
ADD COLUMN "listingValueDecimals" INTEGER,
ADD COLUMN "buybackValueAmount" TEXT,
ADD COLUMN "buybackValueCurrency" TEXT,
ADD COLUMN "buybackValueDecimals" INTEGER,
ADD COLUMN "displayedValueAmount" TEXT,
ADD COLUMN "displayedValueCurrency" TEXT,
ADD COLUMN "displayedValueDecimals" INTEGER;

-- Existing inventory was acquired directly from the immutable insured-value outcome.
-- Preserve that snapshot separately from its acquisition basis before making it required.
UPDATE "HouseInventoryAsset"
SET
  "insuredValueAmount" = "acquisitionValueAmount",
  "insuredValueCurrency" = "acquisitionValueCurrency",
  "insuredValueDecimals" = "acquisitionValueDecimals";

ALTER TABLE "HouseInventoryAsset"
ALTER COLUMN "insuredValueAmount" SET NOT NULL,
ALTER COLUMN "insuredValueCurrency" SET NOT NULL,
ALTER COLUMN "insuredValueCurrency" SET DEFAULT 'USDC',
ALTER COLUMN "insuredValueDecimals" SET NOT NULL,
ALTER COLUMN "insuredValueDecimals" SET DEFAULT 6;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "HouseInventoryAsset"
    GROUP BY "assetReference"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HouseInventoryAsset contains duplicate canonical asset references';
  END IF;
END
$migration$;

DROP INDEX "HouseInventoryAsset_assetReference_idx";
CREATE UNIQUE INDEX "HouseInventoryAsset_assetReference_key"
ON "HouseInventoryAsset"("assetReference");

ALTER TABLE "HouseInventoryAsset"
ADD CONSTRAINT "HouseInventoryAsset_insured_value_check" CHECK (
  "insuredValueAmount" ~ '^[0-9]+$'
  AND "insuredValueCurrency" = 'USDC'
  AND "insuredValueDecimals" = 6
),
ADD CONSTRAINT "HouseInventoryAsset_listing_value_check" CHECK (
  ("listingValueAmount" IS NULL AND "listingValueCurrency" IS NULL AND "listingValueDecimals" IS NULL)
  OR (
    "listingValueAmount" ~ '^[0-9]+$'
    AND "listingValueCurrency" = 'USDC'
    AND "listingValueDecimals" = 6
  )
),
ADD CONSTRAINT "HouseInventoryAsset_buyback_value_check" CHECK (
  ("buybackValueAmount" IS NULL AND "buybackValueCurrency" IS NULL AND "buybackValueDecimals" IS NULL)
  OR (
    "buybackValueAmount" ~ '^[0-9]+$'
    AND "buybackValueCurrency" = 'USDC'
    AND "buybackValueDecimals" = 6
  )
),
ADD CONSTRAINT "HouseInventoryAsset_displayed_value_check" CHECK (
  ("displayedValueAmount" IS NULL AND "displayedValueCurrency" IS NULL AND "displayedValueDecimals" IS NULL)
  OR (
    "displayedValueAmount" ~ '^[0-9]+$'
    AND "displayedValueCurrency" = 'USDC'
    AND "displayedValueDecimals" = 6
  )
),
ADD CONSTRAINT "HouseInventoryAsset_buyback_state_check" CHECK (
  "buybackEligible"
  OR (
    "buybackExpiresAt" IS NULL
    AND "buybackValueAmount" IS NULL
    AND "buybackValueCurrency" IS NULL
    AND "buybackValueDecimals" IS NULL
  )
);
