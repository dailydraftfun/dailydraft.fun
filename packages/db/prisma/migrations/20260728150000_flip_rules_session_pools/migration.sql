CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    "rulesCanonicalPreimage" TEXT NOT NULL,
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
    "poolCanonicalPreimage" TEXT NOT NULL,
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
  AND "stakeAmount"::NUMERIC <= 18446744073709551615
  AND "feeAmount" ~ '^(0|[1-9][0-9]*)$'
  AND "feeAmount"::NUMERIC <= "stakeAmount"::NUMERIC
  AND "feeAmount"::NUMERIC <= 18446744073709551615
  AND "houseEdgePpm" BETWEEN 0 AND 1000000
  AND "probabilityScalePpm" = 1000000
  AND jsonb_typeof("bands") = 'array'
  AND jsonb_array_length("bands") BETWEEN 1 AND 16
  AND octet_length("rulesCanonicalPreimage") BETWEEN 1 AND 65536
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
  AND octet_length("poolCanonicalPreimage") BETWEEN 1 AND 1048576
  AND "eligibleOutcomeCount" > 0
  AND jsonb_typeof("outcomeSpace") = 'array'
  AND jsonb_array_length("outcomeSpace") = "eligibleOutcomeCount"
);

-- Canonicalizes the bounded nested JSON shapes in this migration. Top-level
-- preimages are assembled explicitly below because JavaScript localeCompare
-- ordering is not equivalent to PostgreSQL's bytewise C collation for
-- camel-cased keys.
CREATE FUNCTION "dailydraft_canonical_jsonb"(candidate JSONB) RETURNS TEXT AS $$
DECLARE
  canonical TEXT;
BEGIN
  CASE jsonb_typeof(candidate)
    WHEN 'object' THEN
      SELECT
        '{' || COALESCE(
          string_agg(
            to_jsonb(entry.key)::TEXT
              || ':'
              || "dailydraft_canonical_jsonb"(entry.value),
            ',' ORDER BY entry.key COLLATE "C"
          ),
          ''
        ) || '}'
      INTO canonical
      FROM jsonb_each(candidate) entry;
      RETURN canonical;
    WHEN 'array' THEN
      SELECT
        '[' || COALESCE(
          string_agg(
            "dailydraft_canonical_jsonb"(entry.value),
            ',' ORDER BY entry.ordinality
          ),
          ''
        ) || ']'
      INTO canonical
      FROM jsonb_array_elements(candidate) WITH ORDINALITY entry(value, ordinality);
      RETURN canonical;
    ELSE
      RETURN candidate::TEXT;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- Both records follow the existing Flip inventory sealing model: create
-- unsealed inside a transaction, reconcile metadata, seal exactly once, and
-- reject every later update or delete.

CREATE FUNCTION "reject_flip_ruleset_mutation"() RETURNS trigger AS $$
DECLARE
  band JSONB;
  band_index INTEGER;
  band_key_count INTEGER;
  band_label TEXT;
  band_minimum NUMERIC;
  band_probability NUMERIC;
  expected_canonical_preimage TEXT;
  expected_preimage JSONB;
  labels TEXT[] := ARRAY[]::TEXT[];
  parsed_preimage JSONB;
  previous_minimum NUMERIC := -1;
  probability_total NUMERIC := 0;
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
    FOR band, band_index IN
      SELECT value, ordinality::INTEGER
      FROM jsonb_array_elements(NEW."bands") WITH ORDINALITY
      ORDER BY ordinality
    LOOP
      IF jsonb_typeof(band) <> 'object' THEN
        RAISE EXCEPTION 'Flip ruleset bands are invalid';
      END IF;
      SELECT count(*) INTO band_key_count FROM jsonb_object_keys(band);
      IF (
        band_key_count <> 3
        OR NOT band ? 'label'
        OR NOT band ? 'minimumValueAmount'
        OR NOT band ? 'probabilityPpm'
        OR jsonb_typeof(band->'label') <> 'string'
        OR jsonb_typeof(band->'minimumValueAmount') <> 'string'
        OR jsonb_typeof(band->'probabilityPpm') <> 'number'
      ) THEN
        RAISE EXCEPTION 'Flip ruleset bands are invalid';
      END IF;

      band_label := band->>'label';
      IF (
        band_label !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
        OR band_label = ANY(labels)
      ) THEN
        RAISE EXCEPTION 'Flip ruleset band labels are invalid';
      END IF;
      labels := array_append(labels, band_label);

      IF (band->>'minimumValueAmount') !~ '^(0|[1-9][0-9]*)$' THEN
        RAISE EXCEPTION 'Flip ruleset band minimum is invalid';
      END IF;
      band_minimum := (band->>'minimumValueAmount')::NUMERIC;
      IF (
        band_minimum > 18446744073709551615
        OR band_minimum <= previous_minimum
        OR (band_index = 1 AND band_minimum <> 0)
      ) THEN
        RAISE EXCEPTION 'Flip ruleset band minimum is invalid';
      END IF;
      previous_minimum := band_minimum;

      IF (band->>'probabilityPpm') !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'Flip ruleset band probability is invalid';
      END IF;
      band_probability := (band->>'probabilityPpm')::NUMERIC;
      IF band_probability > 1000000 THEN
        RAISE EXCEPTION 'Flip ruleset band probability is invalid';
      END IF;
      probability_total := probability_total + band_probability;
    END LOOP;

    IF probability_total <> 1000000 THEN
      RAISE EXCEPTION 'Flip ruleset probabilities must total 1000000 PPM';
    END IF;

    BEGIN
      parsed_preimage := NEW."rulesCanonicalPreimage"::JSONB;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'Flip ruleset canonical preimage is invalid JSON';
    END;
    expected_preimage := jsonb_build_object(
      'activation', NEW."activation",
      'bands', NEW."bands",
      'calculatorVersion', NEW."calculatorVersion",
      'currency', NEW."currency",
      'decimals', NEW."decimals",
      'feeAmount', NEW."feeAmount",
      'houseEdgePpm', NEW."houseEdgePpm",
      'inventoryPolicyVersion', NEW."inventoryPolicyVersion",
      'poolKey', NEW."poolKey",
      'probabilityScalePpm', NEW."probabilityScalePpm",
      'reviewedAt', to_char(NEW."reviewedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'reviewReference', NEW."reviewReference",
      'rulesKey', NEW."rulesKey",
      'schemaVersion', NEW."schemaVersion",
      'stakeAmount', NEW."stakeAmount",
      'version', NEW."version"
    );
    IF parsed_preimage <> expected_preimage THEN
      RAISE EXCEPTION 'Flip ruleset canonical preimage does not match authoritative fields';
    END IF;
    expected_canonical_preimage :=
      '{"activation":' || to_jsonb(NEW."activation")::TEXT
      || ',"bands":' || "dailydraft_canonical_jsonb"(NEW."bands")
      || ',"calculatorVersion":' || to_jsonb(NEW."calculatorVersion")::TEXT
      || ',"currency":' || to_jsonb(NEW."currency")::TEXT
      || ',"decimals":' || NEW."decimals"::TEXT
      || ',"feeAmount":' || to_jsonb(NEW."feeAmount")::TEXT
      || ',"houseEdgePpm":' || NEW."houseEdgePpm"::TEXT
      || ',"inventoryPolicyVersion":' || to_jsonb(NEW."inventoryPolicyVersion")::TEXT
      || ',"poolKey":' || to_jsonb(NEW."poolKey")::TEXT
      || ',"probabilityScalePpm":' || NEW."probabilityScalePpm"::TEXT
      || ',"reviewedAt":'
      || to_jsonb(to_char(NEW."reviewedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::TEXT
      || ',"reviewReference":' || to_jsonb(NEW."reviewReference")::TEXT
      || ',"rulesKey":' || to_jsonb(NEW."rulesKey")::TEXT
      || ',"schemaVersion":' || to_jsonb(NEW."schemaVersion")::TEXT
      || ',"stakeAmount":' || to_jsonb(NEW."stakeAmount")::TEXT
      || ',"version":' || NEW."version"::TEXT
      || '}';
    IF NEW."rulesCanonicalPreimage" <> expected_canonical_preimage THEN
      RAISE EXCEPTION 'Flip ruleset canonical preimage is not canonical';
    END IF;
    IF (
      encode(
        digest(convert_to(NEW."rulesCanonicalPreimage", 'UTF8'), 'sha256'),
        'hex'
      ) <> NEW."rulesHash"
    ) THEN
      RAISE EXCEPTION 'Flip ruleset hash does not match canonical preimage';
    END IF;
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
DECLARE
  actual_outcome_count BIGINT;
  expected_canonical_preimage TEXT;
  expected_outcome_space JSONB;
  expected_preimage JSONB;
  parsed_preimage JSONB;
  rules_found BOOLEAN;
  snapshot_found BOOLEAN;
  stored_rules RECORD;
  stored_snapshot RECORD;
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
    SELECT "bands", "rulesHash", "sealedAt"
    INTO stored_rules
    FROM "FlipRuleSet"
    WHERE "id" = NEW."rulesetId";
    rules_found := FOUND;

    SELECT "contentHash", "eligibleCount", "sealedAt"
    INTO stored_snapshot
    FROM "FlipInventorySnapshot"
    WHERE "id" = NEW."snapshotId";
    snapshot_found := FOUND;

    IF NOT rules_found OR NOT snapshot_found THEN
      RAISE EXCEPTION 'Flip session pool commitment sources are invalid or unsealed';
    END IF;
    IF stored_rules."sealedAt" IS NULL OR stored_snapshot."sealedAt" IS NULL THEN
      RAISE EXCEPTION 'Flip session pool commitment sources are invalid or unsealed';
    END IF;

    SELECT
      count(*),
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'bandLabel', selected_band.label,
            'listingValueAmount', entry."eligibilityListingValueAmount",
            'ordinal', entry."ordinal",
            'providerAssetReference', entry."providerAssetReference",
            'providerListingReference', entry."providerListingReference"
          )
          ORDER BY entry."ordinal"
        ),
        '[]'::JSONB
      )
    INTO actual_outcome_count, expected_outcome_space
    FROM "FlipInventorySnapshotEntry" entry
    CROSS JOIN LATERAL (
      SELECT band->>'label' AS label
      FROM jsonb_array_elements(stored_rules."bands") band
      WHERE (band->>'minimumValueAmount')::NUMERIC
        <= entry."eligibilityListingValueAmount"::NUMERIC
      ORDER BY (band->>'minimumValueAmount')::NUMERIC DESC
      LIMIT 1
    ) selected_band
    WHERE entry."snapshotId" = NEW."snapshotId"
      AND entry."eligible";

    IF (
      actual_outcome_count <> NEW."eligibleOutcomeCount"
      OR actual_outcome_count <> stored_snapshot."eligibleCount"
      OR NEW."outcomeSpace" <> expected_outcome_space
    ) THEN
      RAISE EXCEPTION 'Flip session pool outcome space does not match eligible snapshot entries';
    END IF;

    BEGIN
      parsed_preimage := NEW."poolCanonicalPreimage"::JSONB;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'Flip session pool canonical preimage is invalid JSON';
    END;
    expected_preimage := jsonb_build_object(
      'outcomeSpace', expected_outcome_space,
      'rulesHash', stored_rules."rulesHash",
      'schemaVersion', 'dailydraft.flip-session-pool-commitment.v1',
      'snapshotContentHash', stored_snapshot."contentHash"
    );
    IF parsed_preimage <> expected_preimage THEN
      RAISE EXCEPTION 'Flip session pool canonical preimage does not match authoritative evidence';
    END IF;
    expected_canonical_preimage :=
      '{"outcomeSpace":' || "dailydraft_canonical_jsonb"(expected_outcome_space)
      || ',"rulesHash":' || to_jsonb(stored_rules."rulesHash")::TEXT
      || ',"schemaVersion":"dailydraft.flip-session-pool-commitment.v1"'
      || ',"snapshotContentHash":' || to_jsonb(stored_snapshot."contentHash")::TEXT
      || '}';
    IF NEW."poolCanonicalPreimage" <> expected_canonical_preimage THEN
      RAISE EXCEPTION 'Flip session pool canonical preimage is not canonical';
    END IF;
    IF (
      encode(
        digest(convert_to(NEW."poolCanonicalPreimage", 'UTF8'), 'sha256'),
        'hex'
      ) <> NEW."poolCommitmentHash"
    ) THEN
      RAISE EXCEPTION 'Flip session pool hash does not match canonical preimage';
    END IF;
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
    "currency",
    "decimals",
    "inventoryPolicyVersion",
    "poolKey",
    "stakeAmount",
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
    "policyVersion",
    "revision",
    "contentHash",
    "eligibleCount",
    "evaluatedAt",
    "sealedAt",
    "stakeAmount",
    "stakeCurrency",
    "stakeDecimals"
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
    OR stored_rules."inventoryPolicyVersion" <> stored_snapshot."policyVersion"
    OR stored_rules."stakeAmount" <> stored_snapshot."stakeAmount"
    OR stored_rules."currency" <> stored_snapshot."stakeCurrency"
    OR stored_rules."decimals" <> stored_snapshot."stakeDecimals"
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
