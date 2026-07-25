CREATE TYPE "GachaSport" AS ENUM (
    'FOOTBALL',
    'SOCCER',
    'BASEBALL',
    'BASKETBALL'
);

CREATE TYPE "GachaRipStatus" AS ENUM (
    'SELECTED',
    'REVEALED',
    'ACQUIRED',
    'SETTLED',
    'FAILED'
);

CREATE TYPE "GachaInventoryExclusionReason" AS ENUM (
    'MISSING_INSURED_VALUE',
    'MISSING_ASSET_REFERENCE',
    'MISSING_VALUATION_SOURCE',
    'STALE_VALUATION',
    'FUTURE_VALUATION',
    'POOL_CLOSED',
    'TIER_DISABLED',
    'NOT_VAULTED',
    'UNGRADED',
    'SPORT_MISMATCH',
    'DUPLICATE_ASSET',
    'MAXIMUM_ITEM_COUNT'
);

CREATE TABLE "GachaMachine" (
    "id" TEXT NOT NULL,
    "machineKey" TEXT NOT NULL,
    "sport" "GachaSport" NOT NULL,
    "tierPriceMinor" TEXT NOT NULL,
    "tierPriceCurrency" TEXT NOT NULL DEFAULT 'USDC',
    "tierPriceDecimals" INTEGER NOT NULL DEFAULT 6,
    "displayName" TEXT NOT NULL,
    "committedPoolSize" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GachaMachine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GachaInventorySnapshot" (
    "id" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "machineKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "committedPoolSize" INTEGER NOT NULL,
    "maximumEligibleItems" INTEGER NOT NULL,
    "maximumSourceAgeMs" INTEGER NOT NULL,
    "maximumFutureSkewMs" INTEGER NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL,
    "eligibleValueMinor" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GachaInventorySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GachaInventorySnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "exclusionReasons" "GachaInventoryExclusionReason"[] NOT NULL,
    "providerCardReference" TEXT NOT NULL,
    "assetReference" TEXT,
    "displayName" TEXT NOT NULL,
    "sport" "GachaSport" NOT NULL,
    "graded" BOOLEAN NOT NULL,
    "graderReference" TEXT,
    "vaulted" BOOLEAN NOT NULL,
    "poolOpen" BOOLEAN NOT NULL,
    "tierEnabled" BOOLEAN NOT NULL,
    "insuredValueMinor" TEXT,
    "insuredValueCurrency" TEXT,
    "insuredValueDecimals" INTEGER,
    "insuredValueProviderReference" TEXT,
    "valuationSourceReference" TEXT,
    "valuationTimestamp" TIMESTAMP(3),
    "inventorySourceTimestamp" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GachaInventorySnapshotEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GachaPullOddsCommitment" (
    "id" TEXT NOT NULL,
    "machineKey" TEXT NOT NULL,
    "oddsKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "calculatorVersion" TEXT NOT NULL,
    "rulesHash" TEXT NOT NULL,
    "snapshotContentHash" TEXT NOT NULL,
    "probabilityScalePpm" INTEGER NOT NULL DEFAULT 1000000,
    "baseProbabilityPpm" INTEGER NOT NULL,
    "plusProbabilityPpm" INTEGER NOT NULL,
    "premiumProbabilityPpm" INTEGER NOT NULL,
    "chaseProbabilityPpm" INTEGER NOT NULL,
    "bandMinimums" JSONB NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GachaPullOddsCommitment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GachaRip" (
    "id" TEXT NOT NULL,
    "machineKey" TEXT NOT NULL,
    "oddsCommitmentId" TEXT NOT NULL,
    "status" "GachaRipStatus" NOT NULL,
    "snapshotContentHash" TEXT NOT NULL,
    "oddsRulesHash" TEXT NOT NULL,
    "seedCommitmentHash" TEXT NOT NULL,
    "selectedAssetReference" TEXT NOT NULL,
    "acquisitionReference" TEXT,
    "settlementReference" TEXT,
    "insuredValueMinor" TEXT NOT NULL,
    "insuredValueCurrency" TEXT NOT NULL DEFAULT 'USDC',
    "insuredValueDecimals" INTEGER NOT NULL DEFAULT 6,
    "selectedAt" TIMESTAMP(3) NOT NULL,
    "revealedAt" TIMESTAMP(3),
    "acquiredAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GachaRip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GachaMachine_machineKey_key"
ON "GachaMachine"("machineKey");

CREATE INDEX "GachaMachine_sport_tierPriceMinor_active_idx"
ON "GachaMachine"("sport", "tierPriceMinor", "active");

CREATE UNIQUE INDEX "GachaInventorySnapshot_poolKey_revision_key"
ON "GachaInventorySnapshot"("poolKey", "revision");

CREATE UNIQUE INDEX "GachaInventorySnapshot_poolKey_contentHash_key"
ON "GachaInventorySnapshot"("poolKey", "contentHash");

CREATE INDEX "GachaInventorySnapshot_machineKey_createdAt_idx"
ON "GachaInventorySnapshot"("machineKey", "createdAt");

CREATE INDEX "GachaInventorySnapshot_contentHash_idx"
ON "GachaInventorySnapshot"("contentHash");

CREATE UNIQUE INDEX "GachaInventorySnapshotEntry_snapshotId_ordinal_key"
ON "GachaInventorySnapshotEntry"("snapshotId", "ordinal");

CREATE UNIQUE INDEX "GachaInventorySnapshotEntry_snapshotId_providerCardReferenc_key"
ON "GachaInventorySnapshotEntry"("snapshotId", "providerCardReference");

CREATE INDEX "GachaInventorySnapshotEntry_snapshotId_eligible_ordinal_idx"
ON "GachaInventorySnapshotEntry"("snapshotId", "eligible", "ordinal");

CREATE INDEX "GachaInventorySnapshotEntry_assetReference_idx"
ON "GachaInventorySnapshotEntry"("assetReference");

CREATE UNIQUE INDEX "GachaPullOddsCommitment_oddsKey_version_key"
ON "GachaPullOddsCommitment"("oddsKey", "version");

CREATE INDEX "GachaPullOddsCommitment_machineKey_committedAt_idx"
ON "GachaPullOddsCommitment"("machineKey", "committedAt");

CREATE INDEX "GachaPullOddsCommitment_snapshotContentHash_idx"
ON "GachaPullOddsCommitment"("snapshotContentHash");

CREATE INDEX "GachaRip_machineKey_createdAt_idx"
ON "GachaRip"("machineKey", "createdAt");

CREATE INDEX "GachaRip_status_updatedAt_idx"
ON "GachaRip"("status", "updatedAt");

CREATE INDEX "GachaRip_snapshotContentHash_idx"
ON "GachaRip"("snapshotContentHash");

CREATE INDEX "GachaRip_oddsRulesHash_idx"
ON "GachaRip"("oddsRulesHash");

ALTER TABLE "GachaInventorySnapshot"
ADD CONSTRAINT "GachaInventorySnapshot_machineKey_fkey"
FOREIGN KEY ("machineKey") REFERENCES "GachaMachine"("machineKey")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GachaInventorySnapshotEntry"
ADD CONSTRAINT "GachaInventorySnapshotEntry_snapshotId_fkey"
FOREIGN KEY ("snapshotId") REFERENCES "GachaInventorySnapshot"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GachaPullOddsCommitment"
ADD CONSTRAINT "GachaPullOddsCommitment_machineKey_fkey"
FOREIGN KEY ("machineKey") REFERENCES "GachaMachine"("machineKey")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GachaRip"
ADD CONSTRAINT "GachaRip_machineKey_fkey"
FOREIGN KEY ("machineKey") REFERENCES "GachaMachine"("machineKey")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GachaRip"
ADD CONSTRAINT "GachaRip_oddsCommitmentId_fkey"
FOREIGN KEY ("oddsCommitmentId") REFERENCES "GachaPullOddsCommitment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GachaMachine"
ADD CONSTRAINT "GachaMachine_contract_check" CHECK (
  "machineKey" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  AND "tierPriceMinor" ~ '^[0-9]+$'
  AND "tierPriceMinor"::NUMERIC > 0
  AND "tierPriceCurrency" = 'USDC'
  AND "tierPriceDecimals" = 6
  AND "committedPoolSize" > 0
);

ALTER TABLE "GachaInventorySnapshot"
ADD CONSTRAINT "GachaInventorySnapshot_contract_check" CHECK (
  "revision" > 0
  AND "schemaVersion" = 'dailydraft.gacha-inventory.v1'
  AND "policyHash" ~ '^[a-f0-9]{64}$'
  AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND "committedPoolSize" > 0
  AND "maximumEligibleItems" > 0
  AND "maximumSourceAgeMs" > 0
  AND "maximumFutureSkewMs" >= 0
  AND "eligibleCount" > 0
  AND "eligibleCount" <= "maximumEligibleItems"
  AND "eligibleCount" <= "committedPoolSize"
  AND "excludedCount" >= 0
  AND "eligibleValueMinor" ~ '^[0-9]+$'
  AND jsonb_typeof("policy") = 'object'
);

ALTER TABLE "GachaInventorySnapshotEntry"
ADD CONSTRAINT "GachaInventorySnapshotEntry_decision_check" CHECK (
  "ordinal" >= 0
  AND (
    (
      "eligible"
      AND cardinality("exclusionReasons") = 0
      AND "assetReference" IS NOT NULL
      AND "graded"
      AND "graderReference" IS NOT NULL
      AND "vaulted"
      AND "poolOpen"
      AND "tierEnabled"
      AND "insuredValueMinor" IS NOT NULL
      AND "insuredValueCurrency" = 'USDC'
      AND "insuredValueDecimals" = 6
      AND "insuredValueProviderReference" IS NOT NULL
      AND "valuationSourceReference" IS NOT NULL
      AND "valuationTimestamp" IS NOT NULL
    )
    OR
    (NOT "eligible" AND cardinality("exclusionReasons") > 0)
  )
  AND (
    (
      "insuredValueMinor" IS NULL
      AND "insuredValueCurrency" IS NULL
      AND "insuredValueDecimals" IS NULL
      AND "insuredValueProviderReference" IS NULL
    )
    OR (
      "insuredValueMinor" ~ '^[0-9]+$'
      AND "insuredValueCurrency" = 'USDC'
      AND "insuredValueDecimals" = 6
      AND "insuredValueProviderReference" IS NOT NULL
    )
  )
);

ALTER TABLE "GachaPullOddsCommitment"
ADD CONSTRAINT "GachaPullOddsCommitment_contract_check" CHECK (
  "version" > 0
  AND "schemaVersion" = 'dailydraft.gacha-pull-odds.v1'
  AND "calculatorVersion" = 'dailydraft.gacha-pull-odds-calculator.v1'
  AND "rulesHash" ~ '^[a-f0-9]{64}$'
  AND "snapshotContentHash" ~ '^[a-f0-9]{64}$'
  AND "probabilityScalePpm" = 1000000
  AND "baseProbabilityPpm" >= 0
  AND "plusProbabilityPpm" >= 0
  AND "premiumProbabilityPpm" >= 0
  AND "chaseProbabilityPpm" >= 0
  AND "baseProbabilityPpm"
    + "plusProbabilityPpm"
    + "premiumProbabilityPpm"
    + "chaseProbabilityPpm" = 1000000
  AND jsonb_typeof("bandMinimums") = 'object'
);

ALTER TABLE "GachaRip"
ADD CONSTRAINT "GachaRip_contract_check" CHECK (
  "snapshotContentHash" ~ '^[a-f0-9]{64}$'
  AND "oddsRulesHash" ~ '^[a-f0-9]{64}$'
  AND "seedCommitmentHash" ~ '^[a-f0-9]{64}$'
  AND "insuredValueMinor" ~ '^[0-9]+$'
  AND "insuredValueCurrency" = 'USDC'
  AND "insuredValueDecimals" = 6
  AND (
    (
      "status" = 'SELECTED'
      AND "revealedAt" IS NULL
      AND "acquisitionReference" IS NULL
      AND "acquiredAt" IS NULL
      AND "settlementReference" IS NULL
      AND "settledAt" IS NULL
      AND "failedAt" IS NULL
    )
    OR (
      "status" = 'REVEALED'
      AND "revealedAt" IS NOT NULL
      AND "acquisitionReference" IS NULL
      AND "acquiredAt" IS NULL
      AND "settlementReference" IS NULL
      AND "settledAt" IS NULL
      AND "failedAt" IS NULL
    )
    OR (
      "status" = 'ACQUIRED'
      AND "revealedAt" IS NOT NULL
      AND "acquisitionReference" IS NOT NULL
      AND "acquiredAt" IS NOT NULL
      AND "settlementReference" IS NULL
      AND "settledAt" IS NULL
      AND "failedAt" IS NULL
    )
    OR (
      "status" = 'SETTLED'
      AND "revealedAt" IS NOT NULL
      AND "acquisitionReference" IS NOT NULL
      AND "acquiredAt" IS NOT NULL
      AND "settlementReference" IS NOT NULL
      AND "settledAt" IS NOT NULL
      AND "failedAt" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "failedAt" IS NOT NULL
      AND "failureReason" IS NOT NULL
    )
  )
);

CREATE FUNCTION "reject_gacha_inventory_snapshot_mutation"() RETURNS trigger AS $$
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
    RAISE EXCEPTION 'Gacha inventory snapshots must be created unsealed';
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
      COALESCE(sum("insuredValueMinor"::NUMERIC) FILTER (WHERE "eligible"), 0),
      min("ordinal"),
      max("ordinal")
    INTO
      actual_total_count,
      actual_eligible_count,
      actual_eligible_value,
      actual_minimum_ordinal,
      actual_maximum_ordinal
    FROM "GachaInventorySnapshotEntry"
    WHERE "snapshotId" = NEW."id";

    IF (
      actual_total_count <> NEW."eligibleCount" + NEW."excludedCount"
      OR actual_eligible_count <> NEW."eligibleCount"
      OR actual_eligible_value <> NEW."eligibleValueMinor"::NUMERIC
      OR actual_minimum_ordinal <> 0
      OR actual_maximum_ordinal <> actual_total_count - 1
    ) THEN
      RAISE EXCEPTION 'Gacha inventory snapshot contents do not match metadata';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Gacha inventory snapshots are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GachaInventorySnapshot_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "GachaInventorySnapshot"
FOR EACH ROW EXECUTE FUNCTION "reject_gacha_inventory_snapshot_mutation"();

CREATE FUNCTION "require_gacha_inventory_snapshot_sealed"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "GachaInventorySnapshot"
    WHERE "id" = NEW."id"
      AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Gacha inventory snapshot must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "GachaInventorySnapshot_sealed_before_commit"
AFTER INSERT ON "GachaInventorySnapshot"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_gacha_inventory_snapshot_sealed"();

CREATE FUNCTION "reject_gacha_inventory_entry_after_seal"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "GachaInventorySnapshot"
    WHERE "id" = NEW."snapshotId"
      AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Gacha inventory snapshot entries are sealed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GachaInventorySnapshotEntry_sealed"
BEFORE INSERT ON "GachaInventorySnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION "reject_gacha_inventory_entry_after_seal"();

CREATE FUNCTION "reject_gacha_inventory_entry_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Gacha inventory snapshots are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GachaInventorySnapshotEntry_append_only"
BEFORE UPDATE OR DELETE ON "GachaInventorySnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION "reject_gacha_inventory_entry_mutation"();

CREATE FUNCTION "reject_gacha_odds_commitment_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."sealedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Gacha odds commitments must be sealed when created';
  END IF;
  RAISE EXCEPTION 'Gacha odds commitments are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GachaPullOddsCommitment_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "GachaPullOddsCommitment"
FOR EACH ROW EXECUTE FUNCTION "reject_gacha_odds_commitment_mutation"();
