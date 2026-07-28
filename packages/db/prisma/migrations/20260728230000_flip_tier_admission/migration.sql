CREATE TABLE "FlipTierAdmissionDecision" (
  "id" TEXT NOT NULL,
  "sessionReference" TEXT NOT NULL,
  "tierKey" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "reason" TEXT,
  "reenableBoundary" TEXT,
  "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "providerHealth" JSONB,
  "providerHealthHash" TEXT,
  "poolCommitmentId" TEXT,
  "poolCommitmentHash" TEXT,
  "rulesHash" TEXT,
  "snapshotContentHash" TEXT,
  "inventoryPolicyHash" TEXT,
  "evaluatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FlipTierAdmissionDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipTierAdmissionDecision_contract_check" CHECK (
    "id" ~ '^flipadmission_[a-f0-9]{32}$'
    AND "sessionReference" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
    AND "tierKey" ~ '^USDC:6:(0|[1-9][0-9]*)$'
    AND "policyVersion" = 'dailydraft.flip-tier-admission.v1'
    AND "policyHash" ~ '^[a-f0-9]{64}$'
    AND ("providerHealthHash" IS NULL OR "providerHealthHash" ~ '^[a-f0-9]{64}$')
    AND ("poolCommitmentHash" IS NULL OR "poolCommitmentHash" ~ '^[a-f0-9]{64}$')
    AND ("rulesHash" IS NULL OR "rulesHash" ~ '^[a-f0-9]{64}$')
    AND ("snapshotContentHash" IS NULL OR "snapshotContentHash" ~ '^[a-f0-9]{64}$')
    AND ("inventoryPolicyHash" IS NULL OR "inventoryPolicyHash" ~ '^[a-f0-9]{64}$')
    AND (
      (
        "allowed"
        AND "reason" IS NULL
        AND "reenableBoundary" IS NULL
        AND "providerHealth" IS NOT NULL
        AND "providerHealthHash" IS NOT NULL
        AND "poolCommitmentId" IS NOT NULL
        AND "poolCommitmentHash" IS NOT NULL
        AND "rulesHash" IS NOT NULL
        AND "snapshotContentHash" IS NOT NULL
        AND "inventoryPolicyHash" IS NOT NULL
      )
      OR (
        NOT "allowed"
        AND (
          ("reason" = 'configuration_invalid' AND "reenableBoundary" = 'configuration_change')
          OR ("reason" = 'inventory_degraded' AND "reenableBoundary" = 'reviewed_pool_recovery')
          OR ("reason" = 'inventory_stale' AND "reenableBoundary" = 'fresh_inventory_snapshot')
          OR (
            "reason" IN ('provider_health_missing', 'provider_health_stale', 'provider_outage')
            AND "reenableBoundary" = 'fresh_provider_health'
          )
        )
      )
    )
  )
);

CREATE TABLE "FlipTierAdmissionState" (
  "tierKey" TEXT NOT NULL,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "reenableBoundary" TEXT,
  "policyHash" TEXT NOT NULL,
  "rulesHash" TEXT,
  "snapshotContentHash" TEXT,
  "providerHealthHash" TEXT,
  "evaluatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlipTierAdmissionState_pkey" PRIMARY KEY ("tierKey"),
  CONSTRAINT "FlipTierAdmissionState_contract_check" CHECK (
    "tierKey" ~ '^USDC:6:(0|[1-9][0-9]*)$'
    AND "policyHash" ~ '^[a-f0-9]{64}$'
    AND ("rulesHash" IS NULL OR "rulesHash" ~ '^[a-f0-9]{64}$')
    AND ("snapshotContentHash" IS NULL OR "snapshotContentHash" ~ '^[a-f0-9]{64}$')
    AND ("providerHealthHash" IS NULL OR "providerHealthHash" ~ '^[a-f0-9]{64}$')
    AND "version" > 0
    AND (
      (
        NOT "disabled"
        AND "reason" IS NULL
        AND "reenableBoundary" IS NULL
      )
      OR (
        "disabled"
        AND (
          ("reason" = 'configuration_invalid' AND "reenableBoundary" = 'configuration_change')
          OR ("reason" = 'inventory_degraded' AND "reenableBoundary" = 'reviewed_pool_recovery')
          OR ("reason" = 'inventory_stale' AND "reenableBoundary" = 'fresh_inventory_snapshot')
          OR (
            "reason" IN ('provider_health_missing', 'provider_health_stale', 'provider_outage')
            AND "reenableBoundary" = 'fresh_provider_health'
          )
        )
      )
    )
  )
);

ALTER TABLE "FlipSession" ADD COLUMN "admissionDecisionId" TEXT;

CREATE UNIQUE INDEX "FlipSession_admissionDecisionId_key"
  ON "FlipSession"("admissionDecisionId");
CREATE INDEX "FlipTierAdmissionDecision_sessionReference_evaluatedAt_idx"
  ON "FlipTierAdmissionDecision"("sessionReference", "evaluatedAt");
CREATE INDEX "FlipTierAdmissionDecision_tierKey_evaluatedAt_idx"
  ON "FlipTierAdmissionDecision"("tierKey", "evaluatedAt");
CREATE INDEX "FlipTierAdmissionDecision_allowed_reason_evaluatedAt_idx"
  ON "FlipTierAdmissionDecision"("allowed", "reason", "evaluatedAt");

ALTER TABLE "FlipTierAdmissionDecision"
  ADD CONSTRAINT "FlipTierAdmissionDecision_poolCommitmentId_fkey"
  FOREIGN KEY ("poolCommitmentId") REFERENCES "FlipSessionPoolCommitment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FlipSession"
  ADD CONSTRAINT "FlipSession_admissionDecisionId_fkey"
  FOREIGN KEY ("admissionDecisionId") REFERENCES "FlipTierAdmissionDecision"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FlipSession"
  ADD CONSTRAINT "FlipSession_admission_binding_check" CHECK (
    (
      "status" = 'AWAITING_STAKE'
      AND "stakeAmount" IS NULL
      AND "admissionDecisionId" IS NULL
    )
    OR (
      "status" IN (
        'STAKE_CONFIRMED',
        'POOL_COMMITTED',
        'SELECTION_RECORDED',
        'PURCHASE_RECORDED',
        'TRANSFER_RECORDED',
        'REVEAL_READY',
        'SETTLED'
      )
      AND "stakeAmount" IS NOT NULL
      AND "admissionDecisionId" IS NOT NULL
    )
    OR (
      "status" IN ('RECOVERY_REQUIRED', 'RECOVERED', 'FAILED')
      AND (
        ("stakeAmount" IS NULL AND "admissionDecisionId" IS NULL)
        OR ("stakeAmount" IS NOT NULL AND "admissionDecisionId" IS NOT NULL)
      )
    )
  );

CREATE FUNCTION "protect_flip_tier_admission_decision"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Flip tier admission decisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_flip_tier_admission_decision"() RETURNS trigger AS $$
DECLARE
  commitment "FlipSessionPoolCommitment"%ROWTYPE;
  snapshot "FlipInventorySnapshot"%ROWTYPE;
BEGIN
  IF NEW."poolCommitmentId" IS NULL THEN
    IF
      NEW."poolCommitmentHash" IS NOT NULL
      OR NEW."rulesHash" IS NOT NULL
      OR NEW."snapshotContentHash" IS NOT NULL
      OR NEW."inventoryPolicyHash" IS NOT NULL
    THEN
      RAISE EXCEPTION 'Flip tier admission has incomplete pool bindings';
    END IF;
  ELSE
    SELECT * INTO commitment
    FROM "FlipSessionPoolCommitment"
    WHERE "id" = NEW."poolCommitmentId";
    SELECT * INTO snapshot
    FROM "FlipInventorySnapshot"
    WHERE "id" = commitment."snapshotId";
    IF
      commitment."id" IS NULL
      OR snapshot."id" IS NULL
      OR commitment."sessionReference" <> NEW."sessionReference"
      OR commitment."poolCommitmentHash" <> NEW."poolCommitmentHash"
      OR commitment."rulesHash" <> NEW."rulesHash"
      OR commitment."snapshotContentHash" <> NEW."snapshotContentHash"
      OR snapshot."contentHash" <> NEW."snapshotContentHash"
      OR snapshot."policyHash" <> NEW."inventoryPolicyHash"
    THEN
      RAISE EXCEPTION 'Flip tier admission pool bindings are invalid';
    END IF;
  END IF;

  IF NEW."providerHealth" IS NULL THEN
    IF NEW."providerHealthHash" IS NOT NULL THEN
      RAISE EXCEPTION 'Flip tier admission provider health binding is invalid';
    END IF;
  ELSIF
    NEW."providerHealthHash" IS NULL
    OR NOT "flip_jsonb_has_exact_keys"(
      NEW."providerHealth",
      ARRAY['observedAt', 'poolKey', 'provider', 'schemaVersion', 'status']
    )
    OR NEW."providerHealth"->>'schemaVersion' <> 'dailydraft.flip-provider-health-fixture.v1'
    OR NEW."providerHealth"->>'status' NOT IN ('healthy', 'outage')
    OR NEW."providerHealth"->>'observedAt'
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR NEW."providerHealth"->>'poolKey' !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR NEW."providerHealth"->>'provider' !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    OR NEW."providerHealthHash" <> encode(
      digest(
        convert_to("dailydraft_canonical_jsonb"(NEW."providerHealth"), 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  THEN
    RAISE EXCEPTION 'Flip tier admission provider health binding is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipTierAdmissionDecision_validate_contract"
BEFORE INSERT ON "FlipTierAdmissionDecision"
FOR EACH ROW EXECUTE FUNCTION "validate_flip_tier_admission_decision"();

CREATE TRIGGER "FlipTierAdmissionDecision_append_only"
BEFORE UPDATE OR DELETE ON "FlipTierAdmissionDecision"
FOR EACH ROW EXECUTE FUNCTION "protect_flip_tier_admission_decision"();

CREATE FUNCTION "protect_flip_tier_admission_state"() RETURNS trigger AS $$
BEGIN
  IF
    NEW."tierKey" IS DISTINCT FROM OLD."tierKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."evaluatedAt" < OLD."evaluatedAt"
    OR NEW."version" <> OLD."version" + 1
  THEN
    RAISE EXCEPTION 'Flip tier admission state may only advance monotonically';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipTierAdmissionState_monotonic"
BEFORE UPDATE ON "FlipTierAdmissionState"
FOR EACH ROW EXECUTE FUNCTION "protect_flip_tier_admission_state"();

CREATE FUNCTION "protect_flip_session_admission_binding"() RETURNS trigger AS $$
DECLARE
  decision "FlipTierAdmissionDecision"%ROWTYPE;
BEGIN
  IF NEW."admissionDecisionId" IS NOT DISTINCT FROM OLD."admissionDecisionId" THEN
    RETURN NEW;
  END IF;
  IF
    OLD."admissionDecisionId" IS NOT NULL
    OR OLD."status" <> 'AWAITING_STAKE'
    OR NEW."status" <> 'STAKE_CONFIRMED'
    OR NEW."admissionDecisionId" IS NULL
  THEN
    RAISE EXCEPTION 'Flip session admission binding is immutable';
  END IF;

  SELECT * INTO decision
  FROM "FlipTierAdmissionDecision"
  WHERE "id" = NEW."admissionDecisionId";
  IF
    decision."id" IS NULL
    OR NOT decision."allowed"
    OR decision."sessionReference" <> NEW."id"
    OR decision."tierKey" <> NEW."stakeCurrency" || ':' || NEW."stakeDecimals" || ':' || NEW."stakeAmount"
  THEN
    RAISE EXCEPTION 'Flip stake requires an allowed admission decision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipSession_admission_binding_immutable"
BEFORE UPDATE ON "FlipSession"
FOR EACH ROW EXECUTE FUNCTION "protect_flip_session_admission_binding"();
