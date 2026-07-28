CREATE TYPE "FlipSessionStatus" AS ENUM (
  'AWAITING_STAKE',
  'STAKE_CONFIRMED',
  'POOL_COMMITTED',
  'SELECTION_RECORDED',
  'PURCHASE_RECORDED',
  'TRANSFER_RECORDED',
  'REVEAL_READY',
  'RECOVERY_REQUIRED',
  'SETTLED',
  'RECOVERED',
  'FAILED'
);

CREATE TYPE "FlipSessionTransitionKind" AS ENUM (
  'SESSION_STARTED',
  'STAKE_CONFIRMED',
  'POOL_COMMITTED',
  'SELECTION_RECORDED',
  'PURCHASE_RECORDED',
  'TRANSFER_RECORDED',
  'REVEAL_READY',
  'SETTLED',
  'RECOVERY_REQUESTED',
  'RECOVERY_COMPLETED',
  'TERMINATED'
);

CREATE TABLE "FlipSession" (
  "id" TEXT NOT NULL,
  "activationMode" TEXT NOT NULL DEFAULT 'fixture-only',
  "stateMachineVersion" TEXT NOT NULL,
  "status" "FlipSessionStatus" NOT NULL DEFAULT 'AWAITING_STAKE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "playerWalletReference" TEXT NOT NULL,
  "stakeAmount" TEXT,
  "stakeCurrency" TEXT,
  "stakeDecimals" INTEGER,
  "poolCommitmentId" TEXT,
  "poolCommitmentHash" TEXT,
  "rulesHash" TEXT,
  "snapshotContentHash" TEXT,
  "selectedOrdinal" INTEGER,
  "selectedBandLabel" TEXT,
  "selectedAssetReference" TEXT,
  "selectedListingReference" TEXT,
  "selectedValueAmount" TEXT,
  "purchaseReference" TEXT,
  "purchasedAt" TIMESTAMP(3),
  "transferReference" TEXT,
  "transferredAt" TIMESTAMP(3),
  "revealReadyReference" TEXT,
  "revealReadyAt" TIMESTAMP(3),
  "terminalReason" TEXT,
  "terminalAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlipSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipSession_fixture_only_check"
    CHECK (
      "activationMode" = 'fixture-only'
      AND "id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
      AND "stateMachineVersion" = 'dailydraft.flip-session-state.v1'
      AND "playerWalletReference" ~ '^fixture-wallet:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
  CONSTRAINT "FlipSession_positive_version_check"
    CHECK ("version" > 0),
  CONSTRAINT "FlipSession_stake_check"
    CHECK (
      (
        "stakeAmount" IS NULL
        AND "stakeCurrency" IS NULL
        AND "stakeDecimals" IS NULL
      )
      OR
      (
        "stakeAmount" ~ '^(0|[1-9][0-9]*)$'
        AND "stakeAmount"::NUMERIC <= 18446744073709551615
        AND "stakeCurrency" = 'USDC'
        AND "stakeDecimals" = 6
      )
    ),
  CONSTRAINT "FlipSession_pool_binding_check"
    CHECK (
      (
        "poolCommitmentId" IS NULL
        AND "poolCommitmentHash" IS NULL
        AND "rulesHash" IS NULL
        AND "snapshotContentHash" IS NULL
      )
      OR
      (
        "poolCommitmentId" IS NOT NULL
        AND "poolCommitmentHash" ~ '^[a-f0-9]{64}$'
        AND "rulesHash" ~ '^[a-f0-9]{64}$'
        AND "snapshotContentHash" ~ '^[a-f0-9]{64}$'
      )
    ),
  CONSTRAINT "FlipSession_selection_check"
    CHECK (
      (
        "selectedOrdinal" IS NULL
        AND "selectedBandLabel" IS NULL
        AND "selectedAssetReference" IS NULL
        AND "selectedListingReference" IS NULL
        AND "selectedValueAmount" IS NULL
      )
      OR
      (
        "selectedOrdinal" >= 0
        AND "selectedBandLabel" IS NOT NULL
        AND "selectedAssetReference" IS NOT NULL
        AND "selectedListingReference" IS NOT NULL
        AND "selectedValueAmount" ~ '^(0|[1-9][0-9]*)$'
        AND "selectedValueAmount"::NUMERIC <= 18446744073709551615
      )
    ),
  CONSTRAINT "FlipSession_purchase_check"
    CHECK (
      ("purchaseReference" IS NULL AND "purchasedAt" IS NULL)
      OR
      ("purchaseReference" IS NOT NULL AND "purchasedAt" IS NOT NULL)
    ),
  CONSTRAINT "FlipSession_transfer_check"
    CHECK (
      ("transferReference" IS NULL AND "transferredAt" IS NULL)
      OR
      ("transferReference" IS NOT NULL AND "transferredAt" IS NOT NULL)
    ),
  CONSTRAINT "FlipSession_reveal_ready_check"
    CHECK (
      ("revealReadyReference" IS NULL AND "revealReadyAt" IS NULL)
      OR
      (
        "revealReadyReference" IS NOT NULL
        AND "revealReadyAt" IS NOT NULL
        AND "purchaseReference" IS NOT NULL
        AND "purchasedAt" IS NOT NULL
        AND "transferReference" IS NOT NULL
        AND "transferredAt" IS NOT NULL
      )
    ),
  CONSTRAINT "FlipSession_terminal_check"
    CHECK (
      (
        "status" IN ('SETTLED', 'RECOVERED', 'FAILED')
        AND "terminalAt" IS NOT NULL
        AND "terminalReason" IS NOT NULL
      )
      OR
      (
        "status" NOT IN ('SETTLED', 'RECOVERED', 'FAILED')
        AND "terminalAt" IS NULL
        AND "terminalReason" IS NULL
      )
    ),
  CONSTRAINT "FlipSession_status_milestone_check"
    CHECK (
      (
        "status" = 'AWAITING_STAKE'
        AND "stakeAmount" IS NULL
        AND "poolCommitmentId" IS NULL
        AND "selectedOrdinal" IS NULL
        AND "purchaseReference" IS NULL
        AND "transferReference" IS NULL
        AND "revealReadyReference" IS NULL
      )
      OR (
        "status" = 'STAKE_CONFIRMED'
        AND "stakeAmount" IS NOT NULL
        AND "poolCommitmentId" IS NULL
        AND "selectedOrdinal" IS NULL
        AND "purchaseReference" IS NULL
        AND "transferReference" IS NULL
        AND "revealReadyReference" IS NULL
      )
      OR (
        "status" = 'POOL_COMMITTED'
        AND "stakeAmount" IS NOT NULL
        AND "poolCommitmentId" IS NOT NULL
        AND "selectedOrdinal" IS NULL
        AND "purchaseReference" IS NULL
        AND "transferReference" IS NULL
        AND "revealReadyReference" IS NULL
      )
      OR (
        "status" = 'SELECTION_RECORDED'
        AND "stakeAmount" IS NOT NULL
        AND "poolCommitmentId" IS NOT NULL
        AND "selectedOrdinal" IS NOT NULL
        AND "purchaseReference" IS NULL
        AND "transferReference" IS NULL
        AND "revealReadyReference" IS NULL
      )
      OR (
        "status" = 'PURCHASE_RECORDED'
        AND "stakeAmount" IS NOT NULL
        AND "poolCommitmentId" IS NOT NULL
        AND "selectedOrdinal" IS NOT NULL
        AND "purchaseReference" IS NOT NULL
        AND "transferReference" IS NULL
        AND "revealReadyReference" IS NULL
      )
      OR (
        "status" = 'TRANSFER_RECORDED'
        AND "stakeAmount" IS NOT NULL
        AND "poolCommitmentId" IS NOT NULL
        AND "selectedOrdinal" IS NOT NULL
        AND "purchaseReference" IS NOT NULL
        AND "transferReference" IS NOT NULL
        AND "revealReadyReference" IS NULL
      )
      OR (
        "status" IN ('REVEAL_READY', 'SETTLED')
        AND "stakeAmount" IS NOT NULL
        AND "poolCommitmentId" IS NOT NULL
        AND "selectedOrdinal" IS NOT NULL
        AND "purchaseReference" IS NOT NULL
        AND "transferReference" IS NOT NULL
        AND "revealReadyReference" IS NOT NULL
      )
      OR (
        "status" IN ('RECOVERY_REQUIRED', 'RECOVERED', 'FAILED')
        AND (
          (
            "stakeAmount" IS NULL
            AND "poolCommitmentId" IS NULL
            AND "selectedOrdinal" IS NULL
            AND "purchaseReference" IS NULL
            AND "transferReference" IS NULL
            AND "revealReadyReference" IS NULL
          )
          OR (
            "stakeAmount" IS NOT NULL
            AND "poolCommitmentId" IS NULL
            AND "selectedOrdinal" IS NULL
            AND "purchaseReference" IS NULL
            AND "transferReference" IS NULL
            AND "revealReadyReference" IS NULL
          )
          OR (
            "stakeAmount" IS NOT NULL
            AND "poolCommitmentId" IS NOT NULL
            AND "selectedOrdinal" IS NULL
            AND "purchaseReference" IS NULL
            AND "transferReference" IS NULL
            AND "revealReadyReference" IS NULL
          )
          OR (
            "stakeAmount" IS NOT NULL
            AND "poolCommitmentId" IS NOT NULL
            AND "selectedOrdinal" IS NOT NULL
            AND "purchaseReference" IS NULL
            AND "transferReference" IS NULL
            AND "revealReadyReference" IS NULL
          )
          OR (
            "stakeAmount" IS NOT NULL
            AND "poolCommitmentId" IS NOT NULL
            AND "selectedOrdinal" IS NOT NULL
            AND "purchaseReference" IS NOT NULL
            AND "transferReference" IS NULL
            AND "revealReadyReference" IS NULL
          )
          OR (
            "stakeAmount" IS NOT NULL
            AND "poolCommitmentId" IS NOT NULL
            AND "selectedOrdinal" IS NOT NULL
            AND "purchaseReference" IS NOT NULL
            AND "transferReference" IS NOT NULL
            AND "revealReadyReference" IS NULL
          )
          OR (
            "stakeAmount" IS NOT NULL
            AND "poolCommitmentId" IS NOT NULL
            AND "selectedOrdinal" IS NOT NULL
            AND "purchaseReference" IS NOT NULL
            AND "transferReference" IS NOT NULL
            AND "revealReadyReference" IS NOT NULL
          )
        )
      )
    )
);

CREATE TABLE "FlipSessionTransition" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "transitionKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestPayload" TEXT NOT NULL,
  "kind" "FlipSessionTransitionKind" NOT NULL,
  "fromStatus" "FlipSessionStatus",
  "toStatus" "FlipSessionStatus" NOT NULL,
  "evidence" JSONB,
  "poolCommitmentHash" TEXT,
  "selectedAssetReference" TEXT,
  "terminalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FlipSessionTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipSessionTransition_sequence_check"
    CHECK ("sequence" > 0),
  CONSTRAINT "FlipSessionTransition_hash_check"
    CHECK (
      "requestHash" ~ '^[a-f0-9]{64}$'
      AND "transitionKey" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
      AND length("requestPayload") > 0
      AND (
        "poolCommitmentHash" IS NULL
        OR "poolCommitmentHash" ~ '^[a-f0-9]{64}$'
      )
    )
);

CREATE UNIQUE INDEX "FlipSession_poolCommitmentId_key"
ON "FlipSession"("poolCommitmentId");

CREATE INDEX "FlipSession_status_updatedAt_idx"
ON "FlipSession"("status", "updatedAt");

CREATE INDEX "FlipSession_playerWalletReference_createdAt_idx"
ON "FlipSession"("playerWalletReference", "createdAt");

CREATE INDEX "FlipSession_rulesHash_createdAt_idx"
ON "FlipSession"("rulesHash", "createdAt");

CREATE UNIQUE INDEX "FlipSessionTransition_sessionId_sequence_key"
ON "FlipSessionTransition"("sessionId", "sequence");

CREATE UNIQUE INDEX "FlipSessionTransition_sessionId_transitionKey_key"
ON "FlipSessionTransition"("sessionId", "transitionKey");

CREATE INDEX "FlipSessionTransition_sessionId_createdAt_idx"
ON "FlipSessionTransition"("sessionId", "createdAt");

CREATE INDEX "FlipSessionTransition_requestHash_idx"
ON "FlipSessionTransition"("requestHash");

ALTER TABLE "FlipSession"
ADD CONSTRAINT "FlipSession_poolCommitmentId_fkey"
FOREIGN KEY ("poolCommitmentId") REFERENCES "FlipSessionPoolCommitment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FlipSessionTransition"
ADD CONSTRAINT "FlipSessionTransition_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "FlipSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "protect_flip_session_contract"() RETURNS trigger AS $$
BEGIN
  IF
    NEW."activationMode" IS DISTINCT FROM OLD."activationMode"
    OR NEW."stateMachineVersion" IS DISTINCT FROM OLD."stateMachineVersion"
    OR NEW."playerWalletReference" IS DISTINCT FROM OLD."playerWalletReference"
    OR NEW."version" <> OLD."version" + 1
  THEN
    RAISE EXCEPTION 'Flip session contract references are immutable';
  END IF;

  IF
    (OLD."poolCommitmentId" IS NOT NULL AND NEW."poolCommitmentId" IS DISTINCT FROM OLD."poolCommitmentId")
    OR (OLD."poolCommitmentHash" IS NOT NULL AND NEW."poolCommitmentHash" IS DISTINCT FROM OLD."poolCommitmentHash")
    OR (OLD."rulesHash" IS NOT NULL AND NEW."rulesHash" IS DISTINCT FROM OLD."rulesHash")
    OR (OLD."snapshotContentHash" IS NOT NULL AND NEW."snapshotContentHash" IS DISTINCT FROM OLD."snapshotContentHash")
    OR (OLD."selectedOrdinal" IS NOT NULL AND NEW."selectedOrdinal" IS DISTINCT FROM OLD."selectedOrdinal")
    OR (OLD."selectedBandLabel" IS NOT NULL AND NEW."selectedBandLabel" IS DISTINCT FROM OLD."selectedBandLabel")
    OR (OLD."selectedAssetReference" IS NOT NULL AND NEW."selectedAssetReference" IS DISTINCT FROM OLD."selectedAssetReference")
    OR (OLD."selectedListingReference" IS NOT NULL AND NEW."selectedListingReference" IS DISTINCT FROM OLD."selectedListingReference")
    OR (OLD."selectedValueAmount" IS NOT NULL AND NEW."selectedValueAmount" IS DISTINCT FROM OLD."selectedValueAmount")
    OR (OLD."purchaseReference" IS NOT NULL AND NEW."purchaseReference" IS DISTINCT FROM OLD."purchaseReference")
    OR (OLD."purchasedAt" IS NOT NULL AND NEW."purchasedAt" IS DISTINCT FROM OLD."purchasedAt")
    OR (OLD."transferReference" IS NOT NULL AND NEW."transferReference" IS DISTINCT FROM OLD."transferReference")
    OR (OLD."transferredAt" IS NOT NULL AND NEW."transferredAt" IS DISTINCT FROM OLD."transferredAt")
    OR (OLD."revealReadyReference" IS NOT NULL AND NEW."revealReadyReference" IS DISTINCT FROM OLD."revealReadyReference")
    OR (OLD."revealReadyAt" IS NOT NULL AND NEW."revealReadyAt" IS DISTINCT FROM OLD."revealReadyAt")
  THEN
    RAISE EXCEPTION 'Flip session completed milestones are immutable';
  END IF;

  IF (
    (
      NEW."stakeAmount" IS DISTINCT FROM OLD."stakeAmount"
      OR NEW."stakeCurrency" IS DISTINCT FROM OLD."stakeCurrency"
      OR NEW."stakeDecimals" IS DISTINCT FROM OLD."stakeDecimals"
    )
    AND NOT (OLD."status" = 'AWAITING_STAKE' AND NEW."status" = 'STAKE_CONFIRMED')
  ) OR (
    (
      NEW."poolCommitmentId" IS DISTINCT FROM OLD."poolCommitmentId"
      OR NEW."poolCommitmentHash" IS DISTINCT FROM OLD."poolCommitmentHash"
      OR NEW."rulesHash" IS DISTINCT FROM OLD."rulesHash"
      OR NEW."snapshotContentHash" IS DISTINCT FROM OLD."snapshotContentHash"
    )
    AND NOT (OLD."status" = 'STAKE_CONFIRMED' AND NEW."status" = 'POOL_COMMITTED')
  ) OR (
    (
      NEW."selectedOrdinal" IS DISTINCT FROM OLD."selectedOrdinal"
      OR NEW."selectedBandLabel" IS DISTINCT FROM OLD."selectedBandLabel"
      OR NEW."selectedAssetReference" IS DISTINCT FROM OLD."selectedAssetReference"
      OR NEW."selectedListingReference" IS DISTINCT FROM OLD."selectedListingReference"
      OR NEW."selectedValueAmount" IS DISTINCT FROM OLD."selectedValueAmount"
    )
    AND NOT (OLD."status" = 'POOL_COMMITTED' AND NEW."status" = 'SELECTION_RECORDED')
  ) OR (
    (
      NEW."purchaseReference" IS DISTINCT FROM OLD."purchaseReference"
      OR NEW."purchasedAt" IS DISTINCT FROM OLD."purchasedAt"
    )
    AND NOT (OLD."status" = 'SELECTION_RECORDED' AND NEW."status" = 'PURCHASE_RECORDED')
  ) OR (
    (
      NEW."transferReference" IS DISTINCT FROM OLD."transferReference"
      OR NEW."transferredAt" IS DISTINCT FROM OLD."transferredAt"
    )
    AND NOT (OLD."status" = 'PURCHASE_RECORDED' AND NEW."status" = 'TRANSFER_RECORDED')
  ) OR (
    (
      NEW."revealReadyReference" IS DISTINCT FROM OLD."revealReadyReference"
      OR NEW."revealReadyAt" IS DISTINCT FROM OLD."revealReadyAt"
    )
    AND NOT (OLD."status" = 'TRANSFER_RECORDED' AND NEW."status" = 'REVEAL_READY')
  ) OR (
    (
      NEW."terminalReason" IS DISTINCT FROM OLD."terminalReason"
      OR NEW."terminalAt" IS DISTINCT FROM OLD."terminalAt"
    )
    AND NOT (
      (OLD."status" = 'REVEAL_READY' AND NEW."status" = 'SETTLED')
      OR (OLD."status" = 'RECOVERY_REQUIRED' AND NEW."status" IN ('RECOVERED', 'FAILED'))
    )
  ) THEN
    RAISE EXCEPTION 'Flip session milestones may only advance with their exact lifecycle action';
  END IF;

  IF NOT (
    (OLD."status" = 'AWAITING_STAKE' AND NEW."status" IN ('STAKE_CONFIRMED', 'RECOVERY_REQUIRED'))
    OR (OLD."status" = 'STAKE_CONFIRMED' AND NEW."status" IN ('POOL_COMMITTED', 'RECOVERY_REQUIRED'))
    OR (OLD."status" = 'POOL_COMMITTED' AND NEW."status" IN ('SELECTION_RECORDED', 'RECOVERY_REQUIRED'))
    OR (OLD."status" = 'SELECTION_RECORDED' AND NEW."status" IN ('PURCHASE_RECORDED', 'RECOVERY_REQUIRED'))
    OR (OLD."status" = 'PURCHASE_RECORDED' AND NEW."status" IN ('TRANSFER_RECORDED', 'RECOVERY_REQUIRED'))
    OR (OLD."status" = 'TRANSFER_RECORDED' AND NEW."status" IN ('REVEAL_READY', 'RECOVERY_REQUIRED'))
    OR (OLD."status" = 'REVEAL_READY' AND NEW."status" IN ('SETTLED', 'RECOVERY_REQUIRED'))
    OR (OLD."status" = 'RECOVERY_REQUIRED' AND NEW."status" IN ('RECOVERED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'Flip session transition is invalid';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipSession_contract_immutable"
BEFORE UPDATE ON "FlipSession"
FOR EACH ROW EXECUTE FUNCTION "protect_flip_session_contract"();

CREATE FUNCTION "flip_jsonb_has_exact_keys"(value JSONB, expected_keys TEXT[])
RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'object' THEN FALSE
    ELSE ARRAY(SELECT jsonb_object_keys(value) ORDER BY 1)
      = ARRAY(SELECT unnest(expected_keys) ORDER BY 1)
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE FUNCTION "flip_valid_money"(value JSONB)
RETURNS BOOLEAN AS $$
  SELECT
    "flip_jsonb_has_exact_keys"(value, ARRAY['amount', 'currency', 'decimals'])
    AND value->>'amount' ~ '^(0|[1-9][0-9]*)$'
    AND (value->>'amount')::NUMERIC <= 18446744073709551615
    AND value->>'currency' = 'USDC'
    AND value->>'decimals' = '6'
    AND jsonb_typeof(value->'amount') = 'string'
    AND jsonb_typeof(value->'currency') = 'string'
    AND jsonb_typeof(value->'decimals') = 'number';
$$ LANGUAGE sql IMMUTABLE;

CREATE FUNCTION "validate_flip_session_transition_contract"() RETURNS trigger AS $$
DECLARE
  stored_session "FlipSession"%ROWTYPE;
  stored_commitment "FlipSessionPoolCommitment"%ROWTYPE;
  stored_ruleset "FlipRuleSet"%ROWTYPE;
  request_json JSONB;
  action_json JSONB;
  expected_action_kind TEXT;
  expected_request_evidence JSONB;
BEGIN
  IF NEW."evidence" IS NULL OR jsonb_typeof(NEW."evidence") <> 'object' THEN
    RAISE EXCEPTION 'Flip session transition evidence must be an object';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(NEW."evidence")
    WHERE value = 'null'::JSONB
  ) THEN
    RAISE EXCEPTION 'Flip session transition evidence cannot contain null fields';
  END IF;
  request_json := NEW."requestPayload"::JSONB;
  IF NEW."requestPayload" IS DISTINCT FROM "dailydraft_canonical_jsonb"(request_json) THEN
    RAISE EXCEPTION 'Flip session transition request payload is not canonical';
  END IF;
  IF
    encode(sha256(convert_to(NEW."requestPayload", 'UTF8')), 'hex')
      <> NEW."requestHash"
  THEN
    RAISE EXCEPTION 'Flip session transition request hash is invalid';
  END IF;

  SELECT *
  INTO stored_session
  FROM "FlipSession"
  WHERE "id" = NEW."sessionId";

  IF NOT FOUND
    OR stored_session."version" <> NEW."sequence"
    OR stored_session."status" <> NEW."toStatus"
    OR NEW."requestHash" !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Flip session transition does not match the durable aggregate';
  END IF;

  IF NEW."kind" = 'SESSION_STARTED' THEN
    IF
      NOT "flip_jsonb_has_exact_keys"(
        request_json,
        ARRAY['playerWalletReference', 'sessionReference', 'stateMachineVersion']
      )
      OR request_json->>'playerWalletReference'
        IS DISTINCT FROM stored_session."playerWalletReference"
      OR request_json->>'sessionReference' IS DISTINCT FROM stored_session."id"
      OR request_json->>'stateMachineVersion'
        IS DISTINCT FROM stored_session."stateMachineVersion"
    THEN
      RAISE EXCEPTION 'Flip session start request payload is invalid';
    END IF;
  ELSE
    expected_action_kind := CASE NEW."kind"
      WHEN 'STAKE_CONFIRMED' THEN 'confirm-stake'
      WHEN 'POOL_COMMITTED' THEN 'commit-pool'
      WHEN 'SELECTION_RECORDED' THEN 'record-selection'
      WHEN 'PURCHASE_RECORDED' THEN 'record-purchase'
      WHEN 'TRANSFER_RECORDED' THEN 'record-transfer'
      WHEN 'REVEAL_READY' THEN 'mark-reveal-ready'
      WHEN 'SETTLED' THEN 'settle'
      WHEN 'RECOVERY_REQUESTED' THEN 'request-recovery'
      WHEN 'RECOVERY_COMPLETED' THEN 'complete-recovery'
      WHEN 'TERMINATED' THEN 'terminate'
    END;
    expected_request_evidence := CASE NEW."kind"
      WHEN 'POOL_COMMITTED' THEN jsonb_build_object(
        'poolCommitmentId',
        NEW."evidence"->'poolCommitmentId'
      )
      ELSE NEW."evidence"
    END;
    action_json := request_json->'action';
    IF
      NOT "flip_jsonb_has_exact_keys"(
        request_json,
        ARRAY['action', 'stateMachineVersion']
      )
      OR request_json->>'stateMachineVersion'
        IS DISTINCT FROM stored_session."stateMachineVersion"
      OR NOT "flip_jsonb_has_exact_keys"(
        action_json,
        ARRAY['evidence', 'expectedVersion', 'kind', 'transitionKey']
      )
      OR action_json->>'kind' IS DISTINCT FROM expected_action_kind
      OR action_json->>'transitionKey' IS DISTINCT FROM NEW."transitionKey"
      OR jsonb_typeof(action_json->'expectedVersion') IS DISTINCT FROM 'number'
      OR action_json->>'expectedVersion' !~ '^[1-9][0-9]*$'
      OR (action_json->>'expectedVersion')::NUMERIC <> NEW."sequence" - 1
      OR action_json->'evidence' IS DISTINCT FROM expected_request_evidence
    THEN
      RAISE EXCEPTION 'Flip session transition request payload is invalid';
    END IF;
  END IF;

  CASE NEW."kind"
    WHEN 'SESSION_STARTED' THEN
      IF
        NEW."sequence" <> 1
        OR NEW."transitionKey" <> 'session-started'
        OR NEW."fromStatus" IS NOT NULL
        OR NEW."toStatus" <> 'AWAITING_STAKE'
        OR NEW."poolCommitmentHash" IS NOT NULL
        OR NEW."selectedAssetReference" IS NOT NULL
        OR NEW."terminalReason" IS NOT NULL
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY['playerWalletReference', 'stateMachineVersion']
        )
        OR NEW."evidence"->>'playerWalletReference' <> stored_session."playerWalletReference"
        OR NEW."evidence"->>'stateMachineVersion' <> stored_session."stateMachineVersion"
      THEN
        RAISE EXCEPTION 'Flip session start evidence is invalid';
      END IF;
    WHEN 'STAKE_CONFIRMED' THEN
      IF
        NEW."fromStatus" <> 'AWAITING_STAKE'
        OR NEW."toStatus" <> 'STAKE_CONFIRMED'
        OR NEW."poolCommitmentHash" IS NOT NULL
        OR NEW."selectedAssetReference" IS NOT NULL
        OR NEW."terminalReason" IS NOT NULL
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY['amount', 'reference', 'schemaVersion', 'status']
        )
        OR NOT "flip_valid_money"(NEW."evidence"->'amount')
        OR NEW."evidence"->>'reference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'schemaVersion' <> 'dailydraft.flip-stake-fixture.v1'
        OR NEW."evidence"->>'status' <> 'fixture-confirmed'
        OR NEW."evidence"->'amount'->>'amount' <> stored_session."stakeAmount"
        OR NEW."evidence"->'amount'->>'currency' <> stored_session."stakeCurrency"
        OR (NEW."evidence"->'amount'->>'decimals')::INTEGER
          <> stored_session."stakeDecimals"
      THEN
        RAISE EXCEPTION 'Flip stake transition evidence is invalid';
      END IF;
    WHEN 'POOL_COMMITTED' THEN
      SELECT *
      INTO stored_commitment
      FROM "FlipSessionPoolCommitment"
      WHERE "id" = stored_session."poolCommitmentId";

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Flip pool transition has no durable commitment';
      END IF;

      SELECT *
      INTO stored_ruleset
      FROM "FlipRuleSet"
      WHERE "id" = stored_commitment."rulesetId";

      IF
        NOT FOUND
        OR stored_commitment."sessionReference" <> stored_session."id"
        OR stored_commitment."sealedAt" IS NULL
        OR stored_ruleset."sealedAt" IS NULL
        OR stored_ruleset."activation" <> 'fixture-only'
        OR stored_ruleset."currency" <> 'USDC'
        OR stored_ruleset."decimals" <> 6
        OR stored_commitment."rulesHash" <> stored_ruleset."rulesHash"
        OR stored_session."stakeAmount" <> stored_ruleset."stakeAmount"
        OR stored_session."stakeCurrency" <> stored_ruleset."currency"
        OR stored_session."stakeDecimals" <> stored_ruleset."decimals"
        OR stored_session."poolCommitmentHash" <> stored_commitment."poolCommitmentHash"
        OR stored_session."rulesHash" <> stored_commitment."rulesHash"
        OR stored_session."snapshotContentHash" <> stored_commitment."snapshotContentHash"
        OR NEW."fromStatus" <> 'STAKE_CONFIRMED'
        OR NEW."toStatus" <> 'POOL_COMMITTED'
        OR NEW."poolCommitmentHash" IS DISTINCT FROM stored_session."poolCommitmentHash"
        OR NEW."selectedAssetReference" IS NOT NULL
        OR NEW."terminalReason" IS NOT NULL
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY[
            'eligibleOutcomeCount',
            'poolCommitmentHash',
            'poolCommitmentId',
            'rulesHash',
            'snapshotContentHash'
          ]
        )
        OR jsonb_typeof(NEW."evidence"->'eligibleOutcomeCount') <> 'number'
        OR NEW."evidence"->>'eligibleOutcomeCount' !~ '^[1-9][0-9]*$'
        OR (NEW."evidence"->>'eligibleOutcomeCount')::NUMERIC
          <> stored_commitment."eligibleOutcomeCount"
        OR stored_session."poolCommitmentId"
          !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
        OR NEW."evidence"->>'poolCommitmentId' <> stored_session."poolCommitmentId"
        OR NEW."evidence"->>'poolCommitmentHash' <> stored_session."poolCommitmentHash"
        OR NEW."evidence"->>'rulesHash' <> stored_session."rulesHash"
        OR NEW."evidence"->>'snapshotContentHash' <> stored_session."snapshotContentHash"
      THEN
        RAISE EXCEPTION 'Flip pool transition evidence is invalid';
      END IF;
    WHEN 'SELECTION_RECORDED' THEN
      SELECT *
      INTO stored_commitment
      FROM "FlipSessionPoolCommitment"
      WHERE "id" = stored_session."poolCommitmentId";

      IF
        NOT FOUND
        OR stored_commitment."sessionReference" <> stored_session."id"
        OR stored_commitment."sealedAt" IS NULL
        OR stored_session."poolCommitmentHash" <> stored_commitment."poolCommitmentHash"
        OR stored_session."rulesHash" <> stored_commitment."rulesHash"
        OR stored_session."snapshotContentHash" <> stored_commitment."snapshotContentHash"
        OR NEW."fromStatus" <> 'POOL_COMMITTED'
        OR NEW."toStatus" <> 'SELECTION_RECORDED'
        OR NEW."poolCommitmentHash" IS DISTINCT FROM stored_session."poolCommitmentHash"
        OR NEW."selectedAssetReference" IS DISTINCT FROM stored_session."selectedAssetReference"
        OR NEW."terminalReason" IS NOT NULL
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY[
            'bandLabel',
            'listingValueAmount',
            'ordinal',
            'providerAssetReference',
            'providerListingReference',
            'reference',
            'resultHash',
            'schemaVersion'
          ]
        )
        OR NEW."evidence"->>'schemaVersion' <> 'dailydraft.flip-selection-fixture.v1'
        OR NEW."evidence"->>'resultHash' !~ '^[a-f0-9]{64}$'
        OR NEW."evidence"->>'reference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR jsonb_typeof(NEW."evidence"->'ordinal') <> 'number'
        OR NEW."evidence"->>'ordinal' !~ '^(0|[1-9][0-9]*)$'
        OR (NEW."evidence"->>'ordinal')::NUMERIC <> stored_session."selectedOrdinal"
        OR NEW."evidence"->>'bandLabel' <> stored_session."selectedBandLabel"
        OR NEW."evidence"->>'providerAssetReference'
          <> stored_session."selectedAssetReference"
        OR NEW."evidence"->>'providerListingReference'
          <> stored_session."selectedListingReference"
        OR NEW."evidence"->>'listingValueAmount' <> stored_session."selectedValueAmount"
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(stored_commitment."outcomeSpace") AS outcome
          WHERE jsonb_typeof(outcome) = 'object'
            AND jsonb_typeof(outcome->'ordinal') = 'number'
            AND (outcome->>'ordinal')::NUMERIC = stored_session."selectedOrdinal"
            AND outcome->>'bandLabel' = stored_session."selectedBandLabel"
            AND outcome->>'providerAssetReference' = stored_session."selectedAssetReference"
            AND outcome->>'providerListingReference' = stored_session."selectedListingReference"
            AND outcome->>'listingValueAmount' = stored_session."selectedValueAmount"
        )
      THEN
        RAISE EXCEPTION 'Flip selection transition evidence is invalid';
      END IF;
    WHEN 'PURCHASE_RECORDED' THEN
      IF
        NEW."fromStatus" <> 'SELECTION_RECORDED'
        OR NEW."toStatus" <> 'PURCHASE_RECORDED'
        OR NEW."poolCommitmentHash" IS DISTINCT FROM stored_session."poolCommitmentHash"
        OR NEW."selectedAssetReference" IS DISTINCT FROM stored_session."selectedAssetReference"
        OR NEW."terminalReason" IS NOT NULL
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY[
            'amount',
            'provider',
            'providerAssetReference',
            'providerListingReference',
            'reference',
            'schemaVersion',
            'status'
          ]
        )
        OR NOT "flip_valid_money"(NEW."evidence"->'amount')
        OR NEW."evidence"->>'provider' <> 'fixture-marketplace'
        OR NEW."evidence"->>'schemaVersion' <> 'dailydraft.flip-purchase-fixture.v1'
        OR NEW."evidence"->>'status' <> 'fixture-acquired'
        OR NEW."evidence"->>'reference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'reference' <> stored_session."purchaseReference"
        OR NEW."evidence"->>'providerAssetReference'
          <> stored_session."selectedAssetReference"
        OR NEW."evidence"->>'providerListingReference'
          <> stored_session."selectedListingReference"
        OR NEW."evidence"->'amount'->>'amount' <> stored_session."selectedValueAmount"
      THEN
        RAISE EXCEPTION 'Flip purchase transition evidence is invalid';
      END IF;
    WHEN 'TRANSFER_RECORDED' THEN
      IF
        NEW."fromStatus" <> 'PURCHASE_RECORDED'
        OR NEW."toStatus" <> 'TRANSFER_RECORDED'
        OR NEW."poolCommitmentHash" IS DISTINCT FROM stored_session."poolCommitmentHash"
        OR NEW."selectedAssetReference" IS DISTINCT FROM stored_session."selectedAssetReference"
        OR NEW."terminalReason" IS NOT NULL
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY[
            'destinationWalletReference',
            'providerAssetReference',
            'reference',
            'schemaVersion',
            'sourceCustodyReference',
            'status'
          ]
        )
        OR NEW."evidence"->>'schemaVersion' <> 'dailydraft.flip-transfer-fixture.v1'
        OR NEW."evidence"->>'status' <> 'fixture-transferred'
        OR NEW."evidence"->>'reference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'sourceCustodyReference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'reference' <> stored_session."transferReference"
        OR NEW."evidence"->>'providerAssetReference'
          <> stored_session."selectedAssetReference"
        OR NEW."evidence"->>'destinationWalletReference'
          <> stored_session."playerWalletReference"
      THEN
        RAISE EXCEPTION 'Flip transfer transition evidence is invalid';
      END IF;
    WHEN 'REVEAL_READY' THEN
      IF
        NEW."fromStatus" <> 'TRANSFER_RECORDED'
        OR NEW."toStatus" <> 'REVEAL_READY'
        OR NEW."poolCommitmentHash" IS DISTINCT FROM stored_session."poolCommitmentHash"
        OR NEW."selectedAssetReference" IS DISTINCT FROM stored_session."selectedAssetReference"
        OR NEW."terminalReason" IS NOT NULL
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY['purchaseReference', 'reference', 'schemaVersion', 'status', 'transferReference']
        )
        OR NEW."evidence"->>'schemaVersion' <> 'dailydraft.flip-reveal-ready-fixture.v1'
        OR NEW."evidence"->>'status' <> 'fixture-ready'
        OR NEW."evidence"->>'reference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'purchaseReference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'transferReference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'reference' <> stored_session."revealReadyReference"
        OR NEW."evidence"->>'purchaseReference' <> stored_session."purchaseReference"
        OR NEW."evidence"->>'transferReference' <> stored_session."transferReference"
      THEN
        RAISE EXCEPTION 'Flip reveal transition evidence is invalid';
      END IF;
    WHEN 'SETTLED' THEN
      IF
        NEW."fromStatus" <> 'REVEAL_READY'
        OR NEW."toStatus" <> 'SETTLED'
        OR NEW."poolCommitmentHash" IS DISTINCT FROM stored_session."poolCommitmentHash"
        OR NEW."selectedAssetReference" IS DISTINCT FROM stored_session."selectedAssetReference"
        OR NEW."terminalReason" <> 'FIXTURE_SETTLED'
        OR NEW."terminalReason" <> stored_session."terminalReason"
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY[
            'payout',
            'providerAssetReference',
            'reference',
            'resultHash',
            'schemaVersion',
            'status'
          ]
        )
        OR NOT "flip_valid_money"(NEW."evidence"->'payout')
        OR NEW."evidence"->>'schemaVersion' <> 'dailydraft.flip-settlement-fixture.v1'
        OR NEW."evidence"->>'status' <> 'fixture-recorded'
        OR NEW."evidence"->>'resultHash' !~ '^[a-f0-9]{64}$'
        OR NEW."evidence"->>'reference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'providerAssetReference'
          <> stored_session."selectedAssetReference"
      THEN
        RAISE EXCEPTION 'Flip settlement transition evidence is invalid';
      END IF;
    WHEN 'RECOVERY_REQUESTED' THEN
      IF
        NEW."fromStatus" IS NULL
        OR NEW."fromStatus" IN ('RECOVERY_REQUIRED', 'SETTLED', 'RECOVERED', 'FAILED')
        OR NEW."toStatus" <> 'RECOVERY_REQUIRED'
        OR NEW."poolCommitmentHash" IS DISTINCT FROM stored_session."poolCommitmentHash"
        OR NEW."selectedAssetReference" IS DISTINCT FROM stored_session."selectedAssetReference"
        OR NEW."terminalReason" IS NOT NULL
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY['reasonCode', 'reference', 'schemaVersion', 'status']
        )
        OR NEW."evidence"->>'schemaVersion' <> 'dailydraft.flip-recovery-fixture.v1'
        OR NEW."evidence"->>'status' <> 'fixture-recovery-required'
        OR NEW."evidence"->>'reference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'reasonCode'
          !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
      THEN
        RAISE EXCEPTION 'Flip recovery request transition evidence is invalid';
      END IF;
    WHEN 'RECOVERY_COMPLETED' THEN
      IF
        NEW."fromStatus" <> 'RECOVERY_REQUIRED'
        OR NEW."toStatus" <> 'RECOVERED'
        OR NEW."poolCommitmentHash" IS DISTINCT FROM stored_session."poolCommitmentHash"
        OR NEW."selectedAssetReference" IS DISTINCT FROM stored_session."selectedAssetReference"
        OR NEW."terminalReason" <> 'FIXTURE_RECOVERY_COMPLETED'
        OR NEW."terminalReason" <> stored_session."terminalReason"
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY['payout', 'reference', 'resultHash', 'schemaVersion', 'status']
        )
        OR NOT "flip_valid_money"(NEW."evidence"->'payout')
        OR NEW."evidence"->>'schemaVersion' <> 'dailydraft.flip-recovery-fixture.v1'
        OR NEW."evidence"->>'status' <> 'fixture-recovered'
        OR NEW."evidence"->>'resultHash' !~ '^[a-f0-9]{64}$'
        OR NEW."evidence"->>'reference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
      THEN
        RAISE EXCEPTION 'Flip recovery completion transition evidence is invalid';
      END IF;
    WHEN 'TERMINATED' THEN
      IF
        NEW."fromStatus" <> 'RECOVERY_REQUIRED'
        OR NEW."toStatus" <> 'FAILED'
        OR NEW."poolCommitmentHash" IS DISTINCT FROM stored_session."poolCommitmentHash"
        OR NEW."selectedAssetReference" IS DISTINCT FROM stored_session."selectedAssetReference"
        OR NEW."terminalReason" IS DISTINCT FROM stored_session."terminalReason"
        OR NOT "flip_jsonb_has_exact_keys"(
          NEW."evidence",
          ARRAY['reasonCode', 'reference', 'schemaVersion', 'status']
        )
        OR NEW."evidence"->>'schemaVersion' <> 'dailydraft.flip-recovery-fixture.v1'
        OR NEW."evidence"->>'status' <> 'fixture-failed'
        OR NEW."evidence"->>'reference'
          !~ '^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$'
        OR NEW."evidence"->>'reasonCode'
          !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
        OR NEW."terminalReason" <> 'FIXTURE_TERMINATED:' || (NEW."evidence"->>'reasonCode')
      THEN
        RAISE EXCEPTION 'Flip terminal failure transition evidence is invalid';
      END IF;
  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "FlipSessionTransition_validate_contract"
AFTER INSERT ON "FlipSessionTransition"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_flip_session_transition_contract"();

CREATE FUNCTION "require_flip_session_transition_append"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF
      NEW."status" <> 'AWAITING_STAKE'
      OR NEW."version" <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM "FlipSessionTransition"
        WHERE "sessionId" = NEW."id"
          AND "sequence" = 1
          AND "transitionKey" = 'session-started'
          AND "kind" = 'SESSION_STARTED'
          AND "fromStatus" IS NULL
          AND "toStatus" = 'AWAITING_STAKE'
      )
    THEN
      RAISE EXCEPTION 'Flip session insert requires exact session-started evidence';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "FlipSessionTransition"
    WHERE "sessionId" = NEW."id"
      AND "sequence" = NEW."version"
      AND "fromStatus" = OLD."status"
      AND "toStatus" = NEW."status"
  ) THEN
    RAISE EXCEPTION 'Flip session aggregate update requires matching append-only evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "FlipSession_require_transition_append"
AFTER INSERT OR UPDATE ON "FlipSession"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_flip_session_transition_append"();

CREATE FUNCTION "reject_flip_session_transition_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Flip session transitions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipSessionTransition_append_only"
BEFORE UPDATE OR DELETE ON "FlipSessionTransition"
FOR EACH ROW EXECUTE FUNCTION "reject_flip_session_transition_mutation"();
