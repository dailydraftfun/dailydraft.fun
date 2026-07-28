CREATE TABLE "FlipRuleSet" (
    "id" TEXT NOT NULL,
    "rulesKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "calculatorVersion" TEXT NOT NULL,
    "activation" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "inventoryPolicyVersion" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "decimals" INTEGER NOT NULL DEFAULT 6,
    "stakeAmount" TEXT NOT NULL,
    "feeAmount" TEXT NOT NULL,
    "houseEdgePpm" INTEGER NOT NULL,
    "probabilityScalePpm" INTEGER NOT NULL DEFAULT 1000000,
    "bands" JSONB NOT NULL,
    "rulesHash" TEXT NOT NULL,
    "reviewReference" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlipRuleSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlipSessionPoolCommitment" (
    "id" TEXT NOT NULL,
    "sessionReference" TEXT NOT NULL,
    "rulesetId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "snapshotRevision" INTEGER NOT NULL,
    "rulesHash" TEXT NOT NULL,
    "snapshotContentHash" TEXT NOT NULL,
    "poolCommitmentHash" TEXT NOT NULL,
    "eligibleOutcomeCount" INTEGER NOT NULL,
    "outcomeSpace" JSONB NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlipSessionPoolCommitment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlipRuleSet_rulesKey_version_key"
ON "FlipRuleSet"("rulesKey", "version");

CREATE UNIQUE INDEX "FlipRuleSet_rulesKey_rulesHash_key"
ON "FlipRuleSet"("rulesKey", "rulesHash");

CREATE INDEX "FlipRuleSet_poolKey_createdAt_idx"
ON "FlipRuleSet"("poolKey", "createdAt");

CREATE UNIQUE INDEX "FlipSessionPoolCommitment_sessionReference_key"
ON "FlipSessionPoolCommitment"("sessionReference");

CREATE INDEX "FlipSessionPoolCommitment_rulesetId_committedAt_idx"
ON "FlipSessionPoolCommitment"("rulesetId", "committedAt");

CREATE INDEX "FlipSessionPoolCommitment_snapshotId_committedAt_idx"
ON "FlipSessionPoolCommitment"("snapshotId", "committedAt");

CREATE INDEX "FlipSessionPoolCommitment_poolKey_committedAt_idx"
ON "FlipSessionPoolCommitment"("poolKey", "committedAt");

ALTER TABLE "FlipSessionPoolCommitment"
ADD CONSTRAINT "FlipSessionPoolCommitment_rulesetId_fkey"
FOREIGN KEY ("rulesetId") REFERENCES "FlipRuleSet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FlipSessionPoolCommitment"
ADD CONSTRAINT "FlipSessionPoolCommitment_snapshotId_fkey"
FOREIGN KEY ("snapshotId") REFERENCES "FlipInventorySnapshot"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FlipRuleSet"
ADD CONSTRAINT "FlipRuleSet_contract_check" CHECK (
  "version" > 0
  AND "schemaVersion" = 'dailydraft.flip-rules.v1'
  AND "calculatorVersion" = 'dailydraft.flip-outcome-bands.v1'
  AND "activation" = 'fixture-only'
  AND "rulesKey" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  AND "poolKey" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  AND "inventoryPolicyVersion" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  AND "currency" = 'USDC'
  AND "decimals" = 6
  AND "stakeAmount" ~ '^(0|[1-9][0-9]*)$'
  AND "stakeAmount"::NUMERIC > 0
  AND "feeAmount" ~ '^(0|[1-9][0-9]*)$'
  AND "feeAmount"::NUMERIC <= "stakeAmount"::NUMERIC
  AND "houseEdgePpm" BETWEEN 0 AND 1000000
  AND "probabilityScalePpm" = 1000000
  AND jsonb_typeof("bands") = 'array'
  AND jsonb_array_length("bands") BETWEEN 1 AND 16
  AND "rulesHash" ~ '^[a-f0-9]{64}$'
  AND char_length("reviewReference") BETWEEN 1 AND 240
);

ALTER TABLE "FlipSessionPoolCommitment"
ADD CONSTRAINT "FlipSessionPoolCommitment_contract_check" CHECK (
  "rulesVersion" > 0
  AND "snapshotRevision" > 0
  AND "poolKey" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  AND "rulesHash" ~ '^[a-f0-9]{64}$'
  AND "snapshotContentHash" ~ '^[a-f0-9]{64}$'
  AND "poolCommitmentHash" ~ '^[a-f0-9]{64}$'
  AND "eligibleOutcomeCount" > 0
  AND jsonb_typeof("outcomeSpace") = 'array'
  AND jsonb_array_length("outcomeSpace") = "eligibleOutcomeCount"
);

-- Both records follow the existing Flip inventory sealing model: create
-- unsealed inside a transaction, reconcile metadata, seal exactly once, and
-- reject every later update or delete.

CREATE FUNCTION "reject_flip_ruleset_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."sealedAt" IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Flip rulesets must be created unsealed';
  END IF;
  IF (
    TG_OP = 'UPDATE'
    AND OLD."sealedAt" IS NULL
    AND NEW."sealedAt" IS NOT NULL
    AND (to_jsonb(NEW) - 'sealedAt') = (to_jsonb(OLD) - 'sealedAt')
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Flip rulesets are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipRuleSet_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "FlipRuleSet"
FOR EACH ROW EXECUTE FUNCTION "reject_flip_ruleset_mutation"();

CREATE FUNCTION "require_flip_ruleset_sealed"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FlipRuleSet"
    WHERE "id" = NEW."id"
      AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Flip ruleset must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "FlipRuleSet_sealed_before_commit"
AFTER INSERT ON "FlipRuleSet"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_flip_ruleset_sealed"();

CREATE FUNCTION "reject_flip_session_pool_commitment_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."sealedAt" IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Flip session pool commitments must be created unsealed';
  END IF;
  IF (
    TG_OP = 'UPDATE'
    AND OLD."sealedAt" IS NULL
    AND NEW."sealedAt" IS NOT NULL
    AND (to_jsonb(NEW) - 'sealedAt') = (to_jsonb(OLD) - 'sealedAt')
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Flip session pool commitments are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipSessionPoolCommitment_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "FlipSessionPoolCommitment"
FOR EACH ROW EXECUTE FUNCTION "reject_flip_session_pool_commitment_mutation"();

CREATE FUNCTION "validate_flip_session_pool_sources"() RETURNS trigger AS $$
DECLARE
  rules_found BOOLEAN;
  snapshot_found BOOLEAN;
  stored_rules RECORD;
  stored_snapshot RECORD;
BEGIN
  SELECT
    "poolKey",
    "version",
    "rulesHash",
    "reviewedAt",
    "sealedAt"
  INTO stored_rules
  FROM "FlipRuleSet"
  WHERE "id" = NEW."rulesetId";
  rules_found := FOUND;

  SELECT
    "poolKey",
    "revision",
    "contentHash",
    "eligibleCount",
    "evaluatedAt",
    "sealedAt"
  INTO stored_snapshot
  FROM "FlipInventorySnapshot"
  WHERE "id" = NEW."snapshotId";
  snapshot_found := FOUND;

  IF NOT rules_found OR NOT snapshot_found THEN
    RAISE EXCEPTION 'Flip session pool commitment sources are invalid or unsealed';
  END IF;

  IF (
    stored_rules."sealedAt" IS NULL
    OR stored_snapshot."sealedAt" IS NULL
    OR NEW."poolKey" <> stored_rules."poolKey"
    OR NEW."poolKey" <> stored_snapshot."poolKey"
    OR NEW."rulesVersion" <> stored_rules."version"
    OR NEW."snapshotRevision" <> stored_snapshot."revision"
    OR NEW."rulesHash" <> stored_rules."rulesHash"
    OR NEW."snapshotContentHash" <> stored_snapshot."contentHash"
    OR NEW."eligibleOutcomeCount" <> stored_snapshot."eligibleCount"
    OR NEW."committedAt" < stored_rules."reviewedAt"
    OR NEW."committedAt" < stored_snapshot."evaluatedAt"
  ) THEN
    RAISE EXCEPTION 'Flip session pool commitment sources are invalid or unsealed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipSessionPoolCommitment_validate_sources"
BEFORE INSERT ON "FlipSessionPoolCommitment"
FOR EACH ROW EXECUTE FUNCTION "validate_flip_session_pool_sources"();

CREATE FUNCTION "require_flip_session_pool_commitment_sealed"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FlipSessionPoolCommitment"
    WHERE "id" = NEW."id"
      AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Flip session pool commitment must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "FlipSessionPoolCommitment_sealed_before_commit"
AFTER INSERT ON "FlipSessionPoolCommitment"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_flip_session_pool_commitment_sealed"();
