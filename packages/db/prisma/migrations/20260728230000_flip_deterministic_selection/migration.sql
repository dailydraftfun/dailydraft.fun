CREATE TABLE "FlipOutcomeSelectionProof" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "poolCommitmentId" TEXT NOT NULL,
  "terminalTransitionId" TEXT,
  "schemaVersion" TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "resultHash" TEXT NOT NULL,
  "entropySchemaVersion" TEXT NOT NULL,
  "entropySource" TEXT NOT NULL,
  "entropyReference" TEXT NOT NULL,
  "entropyApprovedAt" TIMESTAMP(3) NOT NULL,
  "entropyHash" TEXT NOT NULL,
  "poolCommitmentHash" TEXT NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "snapshotContentHash" TEXT NOT NULL,
  "rollPpm" INTEGER NOT NULL,
  "selectedBandLabel" TEXT NOT NULL,
  "selectedBandOutcomeIndex" INTEGER NOT NULL,
  "selectedBandOutcomeCount" INTEGER NOT NULL,
  "selectedOrdinal" INTEGER NOT NULL,
  "transitionKey" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FlipOutcomeSelectionProof_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipOutcomeSelectionProof_fixture_contract_check"
    CHECK (
      "schemaVersion" = 'dailydraft.flip-selection-proof.v1'
      AND "algorithmVersion" = 'dailydraft.flip-sha256-rejection-v1'
      AND "entropySchemaVersion" = 'dailydraft.flip-approved-entropy.v1'
      AND "entropySource" = 'fixture-approved'
      AND "id" ~ '^fixture-selection-proof:[a-f0-9]{48}$'
      AND "entropyReference" ~ '^fixture-entropy:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
      AND "requestHash" ~ '^[a-f0-9]{64}$'
      AND "resultHash" ~ '^[a-f0-9]{64}$'
      AND "entropyHash" ~ '^[a-f0-9]{64}$'
      AND "poolCommitmentHash" ~ '^[a-f0-9]{64}$'
      AND "rulesHash" ~ '^[a-f0-9]{64}$'
      AND "snapshotContentHash" ~ '^[a-f0-9]{64}$'
      AND "rollPpm" >= 0
      AND "rollPpm" < 1000000
      AND "selectedOrdinal" >= 0
      AND "selectedBandOutcomeCount" > 0
      AND "selectedBandOutcomeIndex" >= 0
      AND "selectedBandOutcomeIndex" < "selectedBandOutcomeCount"
      AND (
        (
          "terminalTransitionId" IS NULL
          AND "finalizedAt" IS NULL
        )
        OR
        (
          "terminalTransitionId" IS NOT NULL
          AND "finalizedAt" IS NOT NULL
        )
      )
    )
);

CREATE UNIQUE INDEX "FlipOutcomeSelectionProof_sessionId_key"
ON "FlipOutcomeSelectionProof"("sessionId");

CREATE UNIQUE INDEX "FlipOutcomeSelectionProof_poolCommitmentId_key"
ON "FlipOutcomeSelectionProof"("poolCommitmentId");

CREATE UNIQUE INDEX "FlipOutcomeSelectionProof_terminalTransitionId_key"
ON "FlipOutcomeSelectionProof"("terminalTransitionId");

CREATE UNIQUE INDEX "FlipOutcomeSelectionProof_resultHash_key"
ON "FlipOutcomeSelectionProof"("resultHash");

CREATE UNIQUE INDEX "FlipOutcomeSelectionProof_sessionId_transitionKey_key"
ON "FlipOutcomeSelectionProof"("sessionId", "transitionKey");

CREATE INDEX "FlipOutcomeSelectionProof_rulesHash_createdAt_idx"
ON "FlipOutcomeSelectionProof"("rulesHash", "createdAt");

CREATE INDEX "FlipOutcomeSelectionProof_entropyHash_idx"
ON "FlipOutcomeSelectionProof"("entropyHash");

ALTER TABLE "FlipOutcomeSelectionProof"
ADD CONSTRAINT "FlipOutcomeSelectionProof_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "FlipSession"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FlipOutcomeSelectionProof"
ADD CONSTRAINT "FlipOutcomeSelectionProof_poolCommitmentId_fkey"
FOREIGN KEY ("poolCommitmentId") REFERENCES "FlipSessionPoolCommitment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FlipOutcomeSelectionProof"
ADD CONSTRAINT "FlipOutcomeSelectionProof_terminalTransitionId_fkey"
FOREIGN KEY ("terminalTransitionId") REFERENCES "FlipSessionTransition"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "flip_selection_unbiased_index"(
  seed TEXT,
  domain TEXT,
  modulus INTEGER
) RETURNS INTEGER AS $$
DECLARE
  acceptance_limit NUMERIC;
  candidate NUMERIC;
  counter INTEGER;
  digest_bytes BYTEA;
  byte_index INTEGER;
BEGIN
  IF modulus < 1 THEN
    RAISE EXCEPTION 'Flip selection modulus is invalid';
  END IF;
  acceptance_limit :=
    18446744073709551616 - mod(18446744073709551616::NUMERIC, modulus::NUMERIC);
  FOR counter IN 0..1023 LOOP
    digest_bytes := digest(
      convert_to(seed || ':' || domain || ':' || counter::TEXT, 'UTF8'),
      'sha256'
    );
    candidate := 0;
    FOR byte_index IN 0..7 LOOP
      candidate := candidate * 256 + get_byte(digest_bytes, byte_index);
    END LOOP;
    IF candidate < acceptance_limit THEN
      RETURN mod(candidate, modulus::NUMERIC)::INTEGER;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'Flip selection could not derive an unbiased index';
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE FUNCTION "validate_flip_outcome_selection_proof"() RETURNS trigger AS $$
DECLARE
  band JSONB;
  stored_commitment "FlipSessionPoolCommitment"%ROWTYPE;
  stored_ruleset "FlipRuleSet"%ROWTYPE;
  stored_session "FlipSession"%ROWTYPE;
  selected_outcome JSONB;
  expected_band_label TEXT;
  expected_band_outcome_count INTEGER;
  expected_band_outcome_index INTEGER;
  expected_request_hash TEXT;
  expected_result_hash TEXT;
  expected_roll_ppm INTEGER;
  expected_seed TEXT;
  proof_preimage TEXT;
  seed_preimage TEXT;
  upper_bound INTEGER := 0;
BEGIN
  SELECT *
  INTO stored_commitment
  FROM "FlipSessionPoolCommitment"
  WHERE "id" = NEW."poolCommitmentId";

  IF NOT FOUND
    OR stored_commitment."sealedAt" IS NULL
    OR stored_commitment."sessionReference" IS DISTINCT FROM NEW."sessionId"
    OR stored_commitment."poolCommitmentHash" IS DISTINCT FROM NEW."poolCommitmentHash"
    OR stored_commitment."rulesHash" IS DISTINCT FROM NEW."rulesHash"
    OR stored_commitment."snapshotContentHash" IS DISTINCT FROM NEW."snapshotContentHash"
  THEN
    RAISE EXCEPTION 'Flip selection proof does not match the sealed pool commitment';
  END IF;

  SELECT *
  INTO stored_ruleset
  FROM "FlipRuleSet"
  WHERE "id" = stored_commitment."rulesetId";

  SELECT *
  INTO stored_session
  FROM "FlipSession"
  WHERE "id" = NEW."sessionId"
  FOR UPDATE;

  IF NOT FOUND
    OR stored_ruleset."sealedAt" IS NULL
    OR stored_ruleset."rulesHash" IS DISTINCT FROM NEW."rulesHash"
    OR stored_session."status" <> 'POOL_COMMITTED'
    OR stored_session."poolCommitmentId" IS DISTINCT FROM NEW."poolCommitmentId"
    OR stored_session."poolCommitmentHash" IS DISTINCT FROM NEW."poolCommitmentHash"
    OR stored_session."rulesHash" IS DISTINCT FROM NEW."rulesHash"
    OR stored_session."snapshotContentHash" IS DISTINCT FROM NEW."snapshotContentHash"
    OR NEW."entropyApprovedAt" < stored_commitment."committedAt"
    OR EXISTS (
      SELECT 1
      FROM "FlipSessionTransition"
      WHERE "sessionId" = NEW."sessionId"
        AND "transitionKey" = NEW."transitionKey"
    )
  THEN
    RAISE EXCEPTION 'Flip selection proof does not match the exact prepared session boundary';
  END IF;

  seed_preimage :=
    '{"algorithmVersion":' || to_jsonb(NEW."algorithmVersion")::TEXT
    || ',"entropyHash":' || to_jsonb(NEW."entropyHash")::TEXT
    || ',"poolCommitmentHash":' || to_jsonb(NEW."poolCommitmentHash")::TEXT
    || ',"rulesHash":' || to_jsonb(NEW."rulesHash")::TEXT
    || ',"sessionReference":' || to_jsonb(NEW."sessionId")::TEXT
    || ',"snapshotContentHash":' || to_jsonb(NEW."snapshotContentHash")::TEXT
    || '}';
  expected_seed := encode(
    digest(convert_to(seed_preimage, 'UTF8'), 'sha256'),
    'hex'
  );
  expected_roll_ppm :=
    "flip_selection_unbiased_index"(expected_seed, 'band-roll', 1000000);

  FOR band IN SELECT value FROM jsonb_array_elements(stored_ruleset."bands") LOOP
    upper_bound := upper_bound + (band->>'probabilityPpm')::INTEGER;
    IF expected_roll_ppm < upper_bound THEN
      expected_band_label := band->>'label';
      EXIT;
    END IF;
  END LOOP;
  IF expected_band_label IS NULL THEN
    RAISE EXCEPTION 'Flip selection proof has no canonical probability band';
  END IF;

  SELECT count(*)::INTEGER
  INTO expected_band_outcome_count
  FROM jsonb_array_elements(stored_commitment."outcomeSpace")
  WHERE value->>'bandLabel' = expected_band_label;
  expected_band_outcome_index := "flip_selection_unbiased_index"(
    expected_seed,
    'band-outcome',
    expected_band_outcome_count
  );
  SELECT value
  INTO selected_outcome
  FROM jsonb_array_elements(stored_commitment."outcomeSpace")
  WHERE value->>'bandLabel' = expected_band_label
  OFFSET expected_band_outcome_index
  LIMIT 1;

  proof_preimage :=
    '{"algorithmVersion":' || to_jsonb(NEW."algorithmVersion")::TEXT
    || ',"entropyApprovedAt":'
    || to_jsonb(to_char(NEW."entropyApprovedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::TEXT
    || ',"entropyHash":' || to_jsonb(NEW."entropyHash")::TEXT
    || ',"entropyReference":' || to_jsonb(NEW."entropyReference")::TEXT
    || ',"entropySchemaVersion":' || to_jsonb(NEW."entropySchemaVersion")::TEXT
    || ',"entropySource":' || to_jsonb(NEW."entropySource")::TEXT
    || ',"poolCommitmentHash":' || to_jsonb(NEW."poolCommitmentHash")::TEXT
    || ',"rollPpm":' || expected_roll_ppm::TEXT
    || ',"rulesHash":' || to_jsonb(NEW."rulesHash")::TEXT
    || ',"schemaVersion":' || to_jsonb(NEW."schemaVersion")::TEXT
    || ',"selectedBandLabel":' || to_jsonb(expected_band_label)::TEXT
    || ',"selectedBandOutcomeCount":' || expected_band_outcome_count::TEXT
    || ',"selectedBandOutcomeIndex":' || expected_band_outcome_index::TEXT
    || ',"selectedOrdinal":' || (selected_outcome->>'ordinal')
    || ',"sessionReference":' || to_jsonb(NEW."sessionId")::TEXT
    || ',"snapshotContentHash":' || to_jsonb(NEW."snapshotContentHash")::TEXT
    || '}';
  expected_result_hash := encode(
    digest(convert_to(proof_preimage, 'UTF8'), 'sha256'),
    'hex'
  );
  expected_request_hash := encode(
    digest(
      convert_to(
        '{"entropyHash":' || to_jsonb(NEW."entropyHash")::TEXT
        || ',"expectedVersion":' || stored_session."version"::TEXT
        || ',"proofResultHash":' || to_jsonb(expected_result_hash)::TEXT
        || ',"sessionReference":' || to_jsonb(NEW."sessionId")::TEXT
        || ',"transitionKey":' || to_jsonb(NEW."transitionKey")::TEXT
        || '}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  IF selected_outcome IS NULL
    OR NEW."rollPpm" IS DISTINCT FROM expected_roll_ppm
    OR NEW."selectedBandLabel" IS DISTINCT FROM expected_band_label
    OR NEW."selectedBandOutcomeCount" IS DISTINCT FROM expected_band_outcome_count
    OR NEW."selectedBandOutcomeIndex" IS DISTINCT FROM expected_band_outcome_index
    OR NEW."selectedOrdinal" IS DISTINCT FROM (selected_outcome->>'ordinal')::INTEGER
    OR NEW."resultHash" IS DISTINCT FROM expected_result_hash
    OR NEW."requestHash" IS DISTINCT FROM expected_request_hash
    OR NEW."id" IS DISTINCT FROM
      'fixture-selection-proof:' || substr(expected_result_hash, 1, 48)
  THEN
    RAISE EXCEPTION 'Flip selection proof does not match canonical deterministic derivation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipOutcomeSelectionProof_insert_contract"
BEFORE INSERT ON "FlipOutcomeSelectionProof"
FOR EACH ROW EXECUTE FUNCTION "validate_flip_outcome_selection_proof"();

CREATE FUNCTION "validate_flip_selection_transition_proof"() RETURNS trigger AS $$
DECLARE
  stored_proof "FlipOutcomeSelectionProof"%ROWTYPE;
BEGIN
  IF NEW."kind" = 'SELECTION_RECORDED' THEN
    IF NEW."evidence"->>'reference' NOT LIKE 'fixture-selection-proof:%' THEN
      RAISE EXCEPTION 'Flip selection transition requires its prepared audit proof';
    END IF;
    SELECT *
    INTO stored_proof
    FROM "FlipOutcomeSelectionProof"
    WHERE "id" = NEW."evidence"->>'reference';

    IF NOT FOUND
      OR stored_proof."terminalTransitionId" IS NOT NULL
      OR stored_proof."finalizedAt" IS NOT NULL
      OR stored_proof."sessionId" IS DISTINCT FROM NEW."sessionId"
      OR stored_proof."transitionKey" IS DISTINCT FROM NEW."transitionKey"
      OR stored_proof."resultHash" IS DISTINCT FROM NEW."evidence"->>'resultHash'
      OR stored_proof."selectedOrdinal" IS DISTINCT FROM (NEW."evidence"->>'ordinal')::INTEGER
      OR stored_proof."selectedBandLabel" IS DISTINCT FROM NEW."evidence"->>'bandLabel'
    THEN
      RAISE EXCEPTION 'Flip selection transition does not match its prepared audit proof';
    END IF;
    RETURN NEW;
  END IF;

  SELECT *
  INTO stored_proof
  FROM "FlipOutcomeSelectionProof"
  WHERE "sessionId" = NEW."sessionId";

  IF FOUND
    AND (
      stored_proof."terminalTransitionId" IS NULL
      OR stored_proof."finalizedAt" IS NULL
      OR (
        NEW."selectedAssetReference" IS NOT NULL
        AND stored_proof."selectedOrdinal" IS DISTINCT FROM (
          SELECT "selectedOrdinal"
          FROM "FlipSession"
          WHERE "id" = NEW."sessionId"
        )
      )
    )
  THEN
    RAISE EXCEPTION 'Flip prepared selection requires its finalized audit proof';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipSessionTransition_selection_proof_contract"
BEFORE INSERT ON "FlipSessionTransition"
FOR EACH ROW EXECUTE FUNCTION "validate_flip_selection_transition_proof"();

CREATE FUNCTION "protect_flip_outcome_selection_proof"() RETURNS trigger AS $$
DECLARE
  stored_transition "FlipSessionTransition"%ROWTYPE;
BEGIN
  IF
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."sessionId" IS DISTINCT FROM OLD."sessionId"
    OR NEW."poolCommitmentId" IS DISTINCT FROM OLD."poolCommitmentId"
    OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
    OR NEW."algorithmVersion" IS DISTINCT FROM OLD."algorithmVersion"
    OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
    OR NEW."resultHash" IS DISTINCT FROM OLD."resultHash"
    OR NEW."entropySchemaVersion" IS DISTINCT FROM OLD."entropySchemaVersion"
    OR NEW."entropySource" IS DISTINCT FROM OLD."entropySource"
    OR NEW."entropyReference" IS DISTINCT FROM OLD."entropyReference"
    OR NEW."entropyApprovedAt" IS DISTINCT FROM OLD."entropyApprovedAt"
    OR NEW."entropyHash" IS DISTINCT FROM OLD."entropyHash"
    OR NEW."poolCommitmentHash" IS DISTINCT FROM OLD."poolCommitmentHash"
    OR NEW."rulesHash" IS DISTINCT FROM OLD."rulesHash"
    OR NEW."snapshotContentHash" IS DISTINCT FROM OLD."snapshotContentHash"
    OR NEW."rollPpm" IS DISTINCT FROM OLD."rollPpm"
    OR NEW."selectedBandLabel" IS DISTINCT FROM OLD."selectedBandLabel"
    OR NEW."selectedBandOutcomeIndex" IS DISTINCT FROM OLD."selectedBandOutcomeIndex"
    OR NEW."selectedBandOutcomeCount" IS DISTINCT FROM OLD."selectedBandOutcomeCount"
    OR NEW."selectedOrdinal" IS DISTINCT FROM OLD."selectedOrdinal"
    OR NEW."transitionKey" IS DISTINCT FROM OLD."transitionKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR OLD."terminalTransitionId" IS NOT NULL
    OR OLD."finalizedAt" IS NOT NULL
    OR NEW."terminalTransitionId" IS NULL
    OR NEW."finalizedAt" IS NULL
  THEN
    RAISE EXCEPTION 'Flip deterministic selection proof is immutable or terminal';
  END IF;

  SELECT *
  INTO stored_transition
  FROM "FlipSessionTransition"
  WHERE "id" = NEW."terminalTransitionId";

  IF NOT FOUND
    OR stored_transition."sessionId" IS DISTINCT FROM NEW."sessionId"
    OR stored_transition."transitionKey" IS DISTINCT FROM NEW."transitionKey"
    OR stored_transition."kind" <> 'SELECTION_RECORDED'
    OR stored_transition."evidence"->>'reference' IS DISTINCT FROM NEW."id"
    OR stored_transition."evidence"->>'resultHash' IS DISTINCT FROM NEW."resultHash"
    OR (stored_transition."evidence"->>'ordinal')::INTEGER IS DISTINCT FROM NEW."selectedOrdinal"
    OR stored_transition."evidence"->>'bandLabel' IS DISTINCT FROM NEW."selectedBandLabel"
  THEN
    RAISE EXCEPTION 'Flip selection proof terminal transition is invalid';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipOutcomeSelectionProof_update_contract"
BEFORE UPDATE ON "FlipOutcomeSelectionProof"
FOR EACH ROW EXECUTE FUNCTION "protect_flip_outcome_selection_proof"();

CREATE FUNCTION "prevent_flip_outcome_selection_proof_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Flip deterministic selection proof is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipOutcomeSelectionProof_append_only"
BEFORE DELETE ON "FlipOutcomeSelectionProof"
FOR EACH ROW EXECUTE FUNCTION "prevent_flip_outcome_selection_proof_delete"();
