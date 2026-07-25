-- Brand rename: OpenPacksDuel -> DailyDraft.
--
-- The application code now emits DailyDraft-branded schema version identifiers
-- and the DAILYDRAFT_DEVNET provider mode. Those identifiers are pinned by CHECK
-- constraints written in earlier migrations, so the database has to move forward
-- with the code or every write to these tables fails the constraint.
--
-- Earlier migrations are applied history and are deliberately left untouched:
-- editing them would break their recorded checksums and leave the database
-- describing objects that never existed under those names.
--
-- Each constraint is dropped before its rows are rewritten and re-added
-- afterwards, because the old constraint pins the exact value being replaced.

ALTER TYPE "ProviderMode" RENAME VALUE 'OPENPACKSDUEL_DEVNET' TO 'DAILYDRAFT_DEVNET';

-- FlipInventorySnapshot

ALTER TABLE "FlipInventorySnapshot" DROP CONSTRAINT "FlipInventorySnapshot_contract_check";

UPDATE "FlipInventorySnapshot"
SET "schemaVersion" = 'dailydraft.flip-inventory.v1'
WHERE "schemaVersion" = 'openpacksduel.flip-inventory.v1';

ALTER TABLE "FlipInventorySnapshot"
ADD CONSTRAINT "FlipInventorySnapshot_contract_check" CHECK (
  "revision" > 0
  AND "schemaVersion" = 'dailydraft.flip-inventory.v1'
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

-- RealValuePolicyDecision

ALTER TABLE "RealValuePolicyDecision" DROP CONSTRAINT "RealValuePolicyDecision_contract_check";

UPDATE "RealValuePolicyDecision"
SET "schemaVersion" = 'dailydraft.real-value-policy.v1'
WHERE "schemaVersion" = 'openpacksduel.real-value-policy.v1';

ALTER TABLE "RealValuePolicyDecision"
ADD CONSTRAINT "RealValuePolicyDecision_contract_check" CHECK (
  "runtimeMode" IN ('fixture', 'devnet', 'production', 'unclassified')
  AND "schemaVersion" = 'dailydraft.real-value-policy.v1'
  AND char_length("policyVersion") BETWEEN 3 AND 128
  AND "policyHash" ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof("evidence") = 'object'
  AND (
    ("allowed" AND "denialReason" IS NULL)
    OR (NOT "allowed" AND "denialReason" IS NOT NULL)
  )
);

-- GachaInventorySnapshot

ALTER TABLE "GachaInventorySnapshot" DROP CONSTRAINT "GachaInventorySnapshot_contract_check";

UPDATE "GachaInventorySnapshot"
SET "schemaVersion" = 'dailydraft.gacha-inventory.v1'
WHERE "schemaVersion" = 'openpacksduel.gacha-inventory.v1';

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

-- GachaPullOddsCommitment

ALTER TABLE "GachaPullOddsCommitment" DROP CONSTRAINT "GachaPullOddsCommitment_contract_check";

UPDATE "GachaPullOddsCommitment"
SET
  "schemaVersion" = 'dailydraft.gacha-pull-odds.v1',
  "calculatorVersion" = 'dailydraft.gacha-pull-odds-calculator.v1'
WHERE
  "schemaVersion" = 'openpacksduel.gacha-pull-odds.v1'
  OR "calculatorVersion" = 'openpacksduel.gacha-pull-odds-calculator.v1';

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

-- FantasyKickoffSnapshot

ALTER TABLE "FantasyKickoffSnapshot" DROP CONSTRAINT "FantasyKickoffSnapshot_contract_check";

UPDATE "FantasyKickoffSnapshot"
SET "schemaVersion" = 'dailydraft.fantasy-kickoff.v1'
WHERE "schemaVersion" = 'openpacksduel.fantasy-kickoff.v1';

ALTER TABLE "FantasyKickoffSnapshot"
ADD CONSTRAINT "FantasyKickoffSnapshot_contract_check" CHECK (
  "revision" > 0
  AND "schemaVersion" = 'dailydraft.fantasy-kickoff.v1'
  AND "policyHash" ~ '^[a-f0-9]{64}$'
  AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND "eligibleShareTotal" ~ '^[0-9]+$'
  AND "entryCount" >= 0
  AND "playerCount" >= 0
  AND "playerCount" <= "entryCount"
  AND jsonb_typeof("policy") = 'object'
);
