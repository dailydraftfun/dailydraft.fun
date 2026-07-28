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

CREATE FUNCTION "validate_flip_outcome_selection_proof"() RETURNS trigger AS $$
DECLARE
  stored_commitment "FlipSessionPoolCommitment"%ROWTYPE;
  selected_outcome JSONB;
  band_outcome_count INTEGER;
  selected_band_outcome_index INTEGER;
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

  SELECT
    selected_entry.value,
    (
      SELECT count(*)::INTEGER
      FROM jsonb_array_elements(stored_commitment."outcomeSpace")
        WITH ORDINALITY AS preceding_entry(value, position)
      WHERE preceding_entry.value->>'bandLabel' = NEW."selectedBandLabel"
        AND preceding_entry.position < selected_entry.position
    )
  INTO selected_outcome, selected_band_outcome_index
  FROM jsonb_array_elements(stored_commitment."outcomeSpace")
    WITH ORDINALITY AS selected_entry(value, position)
  WHERE (selected_entry.value->>'ordinal')::INTEGER = NEW."selectedOrdinal";

  SELECT count(*)
  INTO band_outcome_count
  FROM jsonb_array_elements(stored_commitment."outcomeSpace")
  WHERE value->>'bandLabel' = NEW."selectedBandLabel";

  IF selected_outcome IS NULL
    OR selected_outcome->>'bandLabel' IS DISTINCT FROM NEW."selectedBandLabel"
    OR band_outcome_count IS DISTINCT FROM NEW."selectedBandOutcomeCount"
    OR selected_band_outcome_index IS DISTINCT FROM NEW."selectedBandOutcomeIndex"
  THEN
    RAISE EXCEPTION 'Flip selection proof does not select an eligible committed outcome';
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
  IF NEW."kind" <> 'SELECTION_RECORDED'
    OR NEW."evidence"->>'reference' NOT LIKE 'fixture-selection-proof:%'
  THEN
    RETURN NEW;
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
