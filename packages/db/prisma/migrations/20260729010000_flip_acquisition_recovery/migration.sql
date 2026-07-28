CREATE TYPE "FlipAcquisitionStatus" AS ENUM ('PENDING', 'RECOVERY_REQUIRED', 'ACQUIRED');
CREATE TYPE "FlipAcquisitionOperationKind" AS ENUM ('PURCHASE', 'TRANSFER');
CREATE TYPE "FlipAcquisitionOperationStatus" AS ENUM ('PREPARED', 'RECOVERY_REQUIRED', 'FINALIZED');
CREATE TYPE "FlipAcquisitionRecoveryMode" AS ENUM ('NONE', 'RETRYABLE', 'RECONCILE_ONLY');
CREATE TYPE "FlipAcquisitionRecoveryBranch" AS ENUM ('REFUND', 'RESELECTION', 'SUBSTITUTE');

ALTER TYPE "HouseTreasuryLedgerType" ADD VALUE 'FLIP_RECOVERY_INVENTORY';

CREATE TABLE "FlipAcquisitionPolicy" (
  "id" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "activation" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerSourceCustodyReference" TEXT NOT NULL,
  "houseInventoryCustodyReference" TEXT NOT NULL,
  "failureBranches" JSONB NOT NULL,
  "policyCanonicalPreimage" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "reviewReference" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  "sealedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FlipAcquisitionPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipAcquisitionPolicy_contract_check" CHECK (
    "schemaVersion" = 'dailydraft.flip-acquisition-policy.v1'
    AND "activation" = 'fixture-only'
    AND "network" = 'solana-devnet'
    AND "provider" = 'fixture-marketplace'
    AND "policyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$'
    AND "providerSourceCustodyReference" ~ '^fixture-wallet:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    AND "houseInventoryCustodyReference" ~ '^fixture-wallet:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    AND "policyHash" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("failureBranches") = 'array'
    AND jsonb_array_length("failureBranches") = 3
  )
);

CREATE UNIQUE INDEX "FlipAcquisitionPolicy_rulesetId_key"
ON "FlipAcquisitionPolicy"("rulesetId");
CREATE UNIQUE INDEX "FlipAcquisitionPolicy_policyHash_key"
ON "FlipAcquisitionPolicy"("policyHash");
CREATE INDEX "FlipAcquisitionPolicy_policyVersion_createdAt_idx"
ON "FlipAcquisitionPolicy"("policyVersion", "createdAt");
ALTER TABLE "FlipAcquisitionPolicy"
ADD CONSTRAINT "FlipAcquisitionPolicy_rulesetId_fkey"
FOREIGN KEY ("rulesetId") REFERENCES "FlipRuleSet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FlipAcquisition" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "selectionProofId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "activationMode" TEXT NOT NULL DEFAULT 'fixture-only',
  "network" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "rulesVersion" INTEGER NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "FlipAcquisitionStatus" NOT NULL DEFAULT 'PENDING',
  "recoveryBranch" "FlipAcquisitionRecoveryBranch",
  "failureCode" TEXT,
  "selectedOrdinal" INTEGER NOT NULL,
  "selectedBandLabel" TEXT NOT NULL,
  "selectedAssetReference" TEXT NOT NULL,
  "selectedListingReference" TEXT NOT NULL,
  "selectedValueAmount" TEXT NOT NULL,
  "playerWalletReference" TEXT NOT NULL,
  "sourceCustodyReference" TEXT NOT NULL,
  "houseInventoryCustodyReference" TEXT NOT NULL,
  "expectedOperationCount" INTEGER NOT NULL DEFAULT 2,
  "finalizedOperationCount" INTEGER NOT NULL DEFAULT 0,
  "receipt" JSONB,
  "receiptHash" TEXT,
  "acquiredAt" TIMESTAMP(3),
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlipAcquisition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipAcquisition_contract_check" CHECK (
    "schemaVersion" = 'dailydraft.flip-acquisition.v1'
    AND "activationMode" = 'fixture-only'
    AND "network" = 'solana-devnet'
    AND "provider" = 'fixture-marketplace'
    AND "rulesVersion" > 0
    AND "rulesHash" ~ '^[a-f0-9]{64}$'
    AND "requestKey" ~ '^flip-acquisition:[a-f0-9]{40}$'
    AND "requestHash" ~ '^[a-f0-9]{64}$'
    AND "selectedOrdinal" >= 0
    AND "selectedValueAmount" ~ '^(0|[1-9][0-9]*)$'
    AND "expectedOperationCount" = 2
    AND "finalizedOperationCount" BETWEEN 0 AND 2
    AND "version" > 0
    AND (("leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
      OR ("leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL))
    AND (
      ("status" = 'PENDING' AND "recoveryBranch" IS NULL AND "receipt" IS NULL
        AND "receiptHash" IS NULL AND "acquiredAt" IS NULL)
      OR
      ("status" = 'RECOVERY_REQUIRED' AND "failureCode" IS NOT NULL
        AND "receipt" IS NULL AND "receiptHash" IS NULL AND "acquiredAt" IS NULL)
      OR
      ("status" = 'ACQUIRED' AND "recoveryBranch" IS NULL AND "failureCode" IS NULL
        AND "finalizedOperationCount" = 2 AND "receipt" IS NOT NULL
        AND "receiptHash" ~ '^[a-f0-9]{64}$' AND "acquiredAt" IS NOT NULL
        AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
    )
  )
);

CREATE UNIQUE INDEX "FlipAcquisition_sessionId_key" ON "FlipAcquisition"("sessionId");
CREATE UNIQUE INDEX "FlipAcquisition_selectionProofId_key" ON "FlipAcquisition"("selectionProofId");
CREATE UNIQUE INDEX "FlipAcquisition_requestKey_key" ON "FlipAcquisition"("requestKey");
CREATE UNIQUE INDEX "FlipAcquisition_sessionId_requestKey_key"
ON "FlipAcquisition"("sessionId", "requestKey");
CREATE INDEX "FlipAcquisition_status_leaseExpiresAt_updatedAt_idx"
ON "FlipAcquisition"("status", "leaseExpiresAt", "updatedAt");

ALTER TABLE "FlipAcquisition"
ADD CONSTRAINT "FlipAcquisition_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "FlipSession"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FlipAcquisition"
ADD CONSTRAINT "FlipAcquisition_selectionProofId_fkey"
FOREIGN KEY ("selectionProofId") REFERENCES "FlipOutcomeSelectionProof"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FlipAcquisition"
ADD CONSTRAINT "FlipAcquisition_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "FlipAcquisitionPolicy"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FlipAcquisitionOperation" (
  "id" TEXT NOT NULL,
  "acquisitionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "operationKey" TEXT NOT NULL,
  "providerRequestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "expectedSessionVersion" INTEGER NOT NULL,
  "kind" "FlipAcquisitionOperationKind" NOT NULL,
  "status" "FlipAcquisitionOperationStatus" NOT NULL DEFAULT 'PREPARED',
  "recoveryMode" "FlipAcquisitionRecoveryMode" NOT NULL DEFAULT 'NONE',
  "assetReference" TEXT NOT NULL,
  "listingReference" TEXT NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "destinationReference" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "decimals" INTEGER NOT NULL DEFAULT 6,
  "providerReference" TEXT,
  "providerResultHash" TEXT,
  "providerEvidence" JSONB,
  "failureCode" TEXT,
  "submissionCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FlipAcquisitionOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipAcquisitionOperation_contract_check" CHECK (
    "sequence" IN (1, 2)
    AND "expectedSessionVersion" > 0
    AND "requestHash" ~ '^[a-f0-9]{64}$'
    AND "providerRequestKey" ~ '^fixture-acquisition:[a-f0-9]{40}$'
    AND "amount" ~ '^(0|[1-9][0-9]*)$'
    AND "currency" = 'USDC'
    AND "decimals" = 6
    AND "submissionCount" >= 0
    AND (
      ("status" = 'PREPARED' AND "recoveryMode" = 'NONE'
        AND "providerReference" IS NULL AND "providerResultHash" IS NULL
        AND "providerEvidence" IS NULL AND "failureCode" IS NULL AND "finalizedAt" IS NULL)
      OR
      ("status" = 'RECOVERY_REQUIRED' AND "recoveryMode" IN ('RETRYABLE', 'RECONCILE_ONLY')
        AND "providerResultHash" IS NULL AND "providerEvidence" IS NULL
        AND "failureCode" IS NOT NULL AND "finalizedAt" IS NULL)
      OR
      ("status" = 'FINALIZED' AND "recoveryMode" = 'NONE'
        AND "providerReference" IS NOT NULL AND "providerResultHash" ~ '^[a-f0-9]{64}$'
        AND "providerEvidence" IS NOT NULL AND "failureCode" IS NULL AND "finalizedAt" IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX "FlipAcquisitionOperation_providerRequestKey_key"
ON "FlipAcquisitionOperation"("providerRequestKey");
CREATE UNIQUE INDEX "FlipAcquisitionOperation_providerReference_key"
ON "FlipAcquisitionOperation"("providerReference");
CREATE UNIQUE INDEX "FlipAcquisitionOperation_acquisitionId_sequence_key"
ON "FlipAcquisitionOperation"("acquisitionId", "sequence");
CREATE UNIQUE INDEX "FlipAcquisitionOperation_acquisitionId_operationKey_key"
ON "FlipAcquisitionOperation"("acquisitionId", "operationKey");
CREATE INDEX "FlipAcquisitionOperation_status_recoveryMode_updatedAt_idx"
ON "FlipAcquisitionOperation"("status", "recoveryMode", "updatedAt");
ALTER TABLE "FlipAcquisitionOperation"
ADD CONSTRAINT "FlipAcquisitionOperation_acquisitionId_fkey"
FOREIGN KEY ("acquisitionId") REFERENCES "FlipAcquisition"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HouseInventoryAsset"
  ADD COLUMN "flipSessionId" TEXT,
  ADD COLUMN "flipAcquisitionOperationId" TEXT;
CREATE UNIQUE INDEX "HouseInventoryAsset_flipAcquisitionOperationId_key"
ON "HouseInventoryAsset"("flipAcquisitionOperationId");
CREATE INDEX "HouseInventoryAsset_flipSessionId_createdAt_idx"
ON "HouseInventoryAsset"("flipSessionId", "createdAt");
ALTER TABLE "HouseInventoryAsset"
ADD CONSTRAINT "HouseInventoryAsset_flipSessionId_fkey"
FOREIGN KEY ("flipSessionId") REFERENCES "FlipSession"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseInventoryAsset"
ADD CONSTRAINT "HouseInventoryAsset_flipAcquisitionOperationId_fkey"
FOREIGN KEY ("flipAcquisitionOperationId") REFERENCES "FlipAcquisitionOperation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HouseInventoryAsset"
DROP CONSTRAINT "HouseInventoryAsset_source_contract_check";
ALTER TABLE "HouseInventoryAsset"
ADD CONSTRAINT "HouseInventoryAsset_source_contract_check" CHECK (
  (
    "duelId" IS NOT NULL AND "outcomeId" IS NOT NULL
    AND "crashRoundId" IS NULL AND "crashSettlementOperationId" IS NULL
    AND "flipSessionId" IS NULL AND "flipAcquisitionOperationId" IS NULL
  )
  OR
  (
    "duelId" IS NULL AND "outcomeId" IS NULL
    AND "crashRoundId" IS NOT NULL AND "crashSettlementOperationId" IS NOT NULL
    AND "flipSessionId" IS NULL AND "flipAcquisitionOperationId" IS NULL
  )
  OR
  (
    "duelId" IS NULL AND "outcomeId" IS NULL
    AND "crashRoundId" IS NULL AND "crashSettlementOperationId" IS NULL
    AND "flipSessionId" IS NOT NULL AND "flipAcquisitionOperationId" IS NOT NULL
  )
);

ALTER TABLE "HouseTreasuryLedgerEntry" ADD COLUMN "flipSessionId" TEXT;
CREATE INDEX "HouseTreasuryLedgerEntry_flipSessionId_createdAt_idx"
ON "HouseTreasuryLedgerEntry"("flipSessionId", "createdAt");
ALTER TABLE "HouseTreasuryLedgerEntry"
ADD CONSTRAINT "HouseTreasuryLedgerEntry_flipSessionId_fkey"
FOREIGN KEY ("flipSessionId") REFERENCES "FlipSession"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_flip_acquisition_policy_mutation"() RETURNS trigger AS $$
DECLARE
  expected_preimage TEXT;
  stored_rules "FlipRuleSet"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."sealedAt" IS NULL THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Flip acquisition policies must be created unsealed';
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD."sealedAt" IS NULL
    AND NEW."sealedAt" IS NOT NULL
    AND (to_jsonb(NEW) - 'sealedAt') = (to_jsonb(OLD) - 'sealedAt')
  THEN
    SELECT * INTO stored_rules FROM "FlipRuleSet" WHERE "id" = NEW."rulesetId";
    expected_preimage := "dailydraft_canonical_jsonb"(
      jsonb_build_object(
        'activation', NEW."activation",
        'failureBranches', NEW."failureBranches",
        'houseInventoryCustodyReference', NEW."houseInventoryCustodyReference",
        'network', NEW."network",
        'policyVersion', NEW."policyVersion",
        'provider', NEW."provider",
        'providerSourceCustodyReference', NEW."providerSourceCustodyReference",
        'reviewReference', NEW."reviewReference",
        'reviewedAt', to_char(NEW."reviewedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'rulesHash', stored_rules."rulesHash",
        'rulesVersion', stored_rules."version",
        'schemaVersion', NEW."schemaVersion"
      )
    );
    IF NOT FOUND
      OR stored_rules."sealedAt" IS NULL
      OR NEW."reviewedAt" < stored_rules."reviewedAt"
      OR NEW."policyCanonicalPreimage" IS DISTINCT FROM expected_preimage
      OR NEW."policyHash" IS DISTINCT FROM encode(
        digest(convert_to(expected_preimage, 'UTF8'), 'sha256'), 'hex'
      )
      OR (
        SELECT array_agg(value->>'branch' ORDER BY value->>'branch')
        FROM jsonb_array_elements(NEW."failureBranches")
      ) IS DISTINCT FROM ARRAY['refund', 'reselection', 'substitute']
      OR (
        SELECT count(DISTINCT value->>'failureCode')
        FROM jsonb_array_elements(NEW."failureBranches")
      ) <> 3
    THEN
      RAISE EXCEPTION 'Flip acquisition policy does not match its sealed rules binding';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Flip acquisition policies are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipAcquisitionPolicy_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "FlipAcquisitionPolicy"
FOR EACH ROW EXECUTE FUNCTION "reject_flip_acquisition_policy_mutation"();

CREATE FUNCTION "require_flip_acquisition_policy_sealed"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "FlipAcquisitionPolicy"
    WHERE "id" = NEW."id" AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Flip acquisition policy must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "FlipAcquisitionPolicy_sealed_before_commit"
AFTER INSERT ON "FlipAcquisitionPolicy"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_flip_acquisition_policy_sealed"();

CREATE FUNCTION "validate_flip_acquisition_plan"() RETURNS trigger AS $$
DECLARE
  commitment "FlipSessionPoolCommitment"%ROWTYPE;
  operation_row RECORD;
  operations_json JSONB;
  policy "FlipAcquisitionPolicy"%ROWTYPE;
  proof "FlipOutcomeSelectionProof"%ROWTYPE;
  session_row "FlipSession"%ROWTYPE;
  expected_request_hash TEXT;
BEGIN
  SELECT * INTO session_row FROM "FlipSession" WHERE "id" = NEW."sessionId" FOR UPDATE;
  SELECT * INTO proof FROM "FlipOutcomeSelectionProof" WHERE "id" = NEW."selectionProofId";
  SELECT * INTO policy FROM "FlipAcquisitionPolicy" WHERE "id" = NEW."policyId";
  SELECT * INTO commitment FROM "FlipSessionPoolCommitment"
  WHERE "id" = session_row."poolCommitmentId";

  SELECT jsonb_agg(
    jsonb_build_object(
      'amount', operation."amount",
      'assetReference', operation."assetReference",
      'destinationReference', operation."destinationReference",
      'expectedSessionVersion', operation."expectedSessionVersion",
      'kind', operation."kind"::TEXT,
      'listingReference', operation."listingReference",
      'operationKey', operation."operationKey",
      'providerRequestKey', operation."providerRequestKey",
      'requestHash', operation."requestHash",
      'sequence', operation."sequence",
      'sourceReference', operation."sourceReference"
    ) ORDER BY operation."sequence"
  ) INTO operations_json
  FROM "FlipAcquisitionOperation" operation
  WHERE operation."acquisitionId" = NEW."id";

  expected_request_hash := encode(
    digest(
      convert_to(
        "dailydraft_canonical_jsonb"(
          jsonb_build_object(
            'operations', operations_json,
            'policyHash', policy."policyHash",
            'poolCommitmentHash', session_row."poolCommitmentHash",
            'requestKey', NEW."requestKey",
            'rulesHash', session_row."rulesHash",
            'selectionProofId', proof."id",
            'selectionResultHash', proof."resultHash",
            'sessionReference', session_row."id",
            'snapshotContentHash', session_row."snapshotContentHash"
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  IF session_row."status" <> 'SELECTION_RECORDED'
    OR proof."sessionId" IS DISTINCT FROM session_row."id"
    OR proof."terminalTransitionId" IS NULL
    OR proof."finalizedAt" IS NULL
    OR proof."selectedOrdinal" IS DISTINCT FROM session_row."selectedOrdinal"
    OR policy."sealedAt" IS NULL
    OR policy."rulesetId" IS DISTINCT FROM commitment."rulesetId"
    OR policy."createdAt" > commitment."committedAt"
    OR policy."reviewedAt" > commitment."committedAt"
    OR NEW."rulesVersion" IS DISTINCT FROM commitment."rulesVersion"
    OR NEW."rulesHash" IS DISTINCT FROM commitment."rulesHash"
    OR NEW."selectedOrdinal" IS DISTINCT FROM session_row."selectedOrdinal"
    OR NEW."selectedBandLabel" IS DISTINCT FROM session_row."selectedBandLabel"
    OR NEW."selectedAssetReference" IS DISTINCT FROM session_row."selectedAssetReference"
    OR NEW."selectedListingReference" IS DISTINCT FROM session_row."selectedListingReference"
    OR NEW."selectedValueAmount" IS DISTINCT FROM session_row."selectedValueAmount"
    OR NEW."playerWalletReference" IS DISTINCT FROM session_row."playerWalletReference"
    OR NEW."sourceCustodyReference" IS DISTINCT FROM policy."providerSourceCustodyReference"
    OR NEW."houseInventoryCustodyReference" IS DISTINCT FROM policy."houseInventoryCustodyReference"
    OR NEW."requestKey" IS DISTINCT FROM
      'flip-acquisition:' || substr(proof."resultHash", 1, 40)
    OR jsonb_array_length(operations_json) <> 2
    OR NEW."requestHash" IS DISTINCT FROM expected_request_hash
  THEN
    RAISE EXCEPTION 'Flip acquisition plan does not match finalized selection and reviewed policy';
  END IF;

  FOR operation_row IN
    SELECT
      operation.*,
      "dailydraft_canonical_jsonb"(
        jsonb_build_object(
          'amount', operation."amount",
          'assetReference', operation."assetReference",
          'currency', operation."currency",
          'decimals', operation."decimals",
          'destinationReference', operation."destinationReference",
          'kind', lower(operation."kind"::TEXT),
          'listingReference', operation."listingReference",
          'operationKey', operation."operationKey",
          'providerRequestKey', operation."providerRequestKey",
          'sessionReference', NEW."sessionId",
          'sourceReference', operation."sourceReference"
        )
      ) AS request_preimage,
      "dailydraft_canonical_jsonb"(
        jsonb_build_object(
          'operationKey', operation."operationKey",
          'sessionReference', NEW."sessionId"
        )
      ) AS provider_key_preimage
    FROM "FlipAcquisitionOperation" operation
    WHERE operation."acquisitionId" = NEW."id"
  LOOP
    IF operation_row."operationKey" IS DISTINCT FROM
        'flip-acquisition:' || operation_row."sequence" || ':' ||
        lower(operation_row."kind"::TEXT)
      OR operation_row."providerRequestKey" IS DISTINCT FROM
        'fixture-acquisition:' || substr(encode(
          digest(convert_to(operation_row.provider_key_preimage, 'UTF8'), 'sha256'),
          'hex'
        ), 1, 40)
      OR operation_row."requestHash" IS DISTINCT FROM encode(
        digest(convert_to(operation_row.request_preimage, 'UTF8'), 'sha256'), 'hex'
      )
    THEN
      RAISE EXCEPTION 'Flip acquisition operation request hash is invalid';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "FlipAcquisition_validate_plan"
AFTER INSERT ON "FlipAcquisition"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_flip_acquisition_plan"();

CREATE FUNCTION "protect_flip_acquisition"() RETURNS trigger AS $$
BEGIN
  IF NEW."sessionId" IS DISTINCT FROM OLD."sessionId"
    OR NEW."selectionProofId" IS DISTINCT FROM OLD."selectionProofId"
    OR NEW."policyId" IS DISTINCT FROM OLD."policyId"
    OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
    OR NEW."activationMode" IS DISTINCT FROM OLD."activationMode"
    OR NEW."network" IS DISTINCT FROM OLD."network"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."rulesVersion" IS DISTINCT FROM OLD."rulesVersion"
    OR NEW."rulesHash" IS DISTINCT FROM OLD."rulesHash"
    OR NEW."requestKey" IS DISTINCT FROM OLD."requestKey"
    OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
    OR NEW."selectedOrdinal" IS DISTINCT FROM OLD."selectedOrdinal"
    OR NEW."selectedBandLabel" IS DISTINCT FROM OLD."selectedBandLabel"
    OR NEW."selectedAssetReference" IS DISTINCT FROM OLD."selectedAssetReference"
    OR NEW."selectedListingReference" IS DISTINCT FROM OLD."selectedListingReference"
    OR NEW."selectedValueAmount" IS DISTINCT FROM OLD."selectedValueAmount"
    OR NEW."playerWalletReference" IS DISTINCT FROM OLD."playerWalletReference"
    OR NEW."sourceCustodyReference" IS DISTINCT FROM OLD."sourceCustodyReference"
    OR NEW."houseInventoryCustodyReference" IS DISTINCT FROM OLD."houseInventoryCustodyReference"
    OR NEW."expectedOperationCount" IS DISTINCT FROM OLD."expectedOperationCount"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."version" <> OLD."version" + 1
    OR OLD."status" = 'ACQUIRED'
    OR (NEW."receiptHash" IS NOT NULL AND NEW."receiptHash" IS DISTINCT FROM encode(
      digest(convert_to("dailydraft_canonical_jsonb"(NEW."receipt"), 'UTF8'), 'sha256'), 'hex'
    ))
  THEN
    RAISE EXCEPTION 'Flip acquisition plan is immutable or terminal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FlipAcquisition_immutable"
BEFORE UPDATE ON "FlipAcquisition"
FOR EACH ROW EXECUTE FUNCTION "protect_flip_acquisition"();

CREATE FUNCTION "protect_flip_acquisition_operation"() RETURNS trigger AS $$
BEGIN
  IF NEW."acquisitionId" IS DISTINCT FROM OLD."acquisitionId"
    OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
    OR NEW."operationKey" IS DISTINCT FROM OLD."operationKey"
    OR NEW."providerRequestKey" IS DISTINCT FROM OLD."providerRequestKey"
    OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
    OR NEW."expectedSessionVersion" IS DISTINCT FROM OLD."expectedSessionVersion"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."assetReference" IS DISTINCT FROM OLD."assetReference"
    OR NEW."listingReference" IS DISTINCT FROM OLD."listingReference"
    OR NEW."sourceReference" IS DISTINCT FROM OLD."sourceReference"
    OR NEW."destinationReference" IS DISTINCT FROM OLD."destinationReference"
    OR NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."decimals" IS DISTINCT FROM OLD."decimals"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR OLD."status" = 'FINALIZED'
    OR (OLD."providerReference" IS NOT NULL
      AND NEW."providerReference" IS DISTINCT FROM OLD."providerReference")
  THEN
    RAISE EXCEPTION 'Flip acquisition operation request or finality is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FlipAcquisitionOperation_immutable"
BEFORE UPDATE ON "FlipAcquisitionOperation"
FOR EACH ROW EXECUTE FUNCTION "protect_flip_acquisition_operation"();

CREATE FUNCTION "prevent_flip_acquisition_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Flip acquisition evidence is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FlipAcquisition_append_only"
BEFORE DELETE ON "FlipAcquisition"
FOR EACH ROW EXECUTE FUNCTION "prevent_flip_acquisition_delete"();
CREATE TRIGGER "FlipAcquisitionOperation_append_only"
BEFORE DELETE ON "FlipAcquisitionOperation"
FOR EACH ROW EXECUTE FUNCTION "prevent_flip_acquisition_delete"();

CREATE FUNCTION "validate_flip_acquisition_transition"() RETURNS trigger AS $$
DECLARE
  acquisition "FlipAcquisition"%ROWTYPE;
  operation "FlipAcquisitionOperation"%ROWTYPE;
BEGIN
  IF NEW."kind" IN ('PURCHASE_RECORDED', 'TRANSFER_RECORDED', 'REVEAL_READY') THEN
    SELECT * INTO acquisition FROM "FlipAcquisition" WHERE "sessionId" = NEW."sessionId";
    IF NOT FOUND THEN
      IF EXISTS (
        SELECT 1
        FROM "FlipSession" session_row
        JOIN "FlipSessionPoolCommitment" commitment
          ON commitment."id" = session_row."poolCommitmentId"
        JOIN "FlipAcquisitionPolicy" policy
          ON policy."rulesetId" = commitment."rulesetId"
        WHERE session_row."id" = NEW."sessionId"
          AND policy."sealedAt" IS NOT NULL
          AND policy."createdAt" <= commitment."committedAt"
          AND policy."reviewedAt" <= commitment."committedAt"
      ) THEN
        RAISE EXCEPTION 'Flip lifecycle transition requires durable acquisition proof';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF NEW."kind" = 'REVEAL_READY' THEN
    IF acquisition."status" <> 'ACQUIRED'
      OR acquisition."receiptHash" IS NULL
      OR acquisition."finalizedOperationCount" <> 2
    THEN
      RAISE EXCEPTION 'Flip reveal requires finalized purchase and transfer acquisition proof';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO operation
  FROM "FlipAcquisitionOperation"
  WHERE "acquisitionId" = acquisition."id"
    AND "kind" = CASE
      WHEN NEW."kind" = 'PURCHASE_RECORDED'
        THEN 'PURCHASE'::"FlipAcquisitionOperationKind"
      ELSE 'TRANSFER'::"FlipAcquisitionOperationKind"
    END;

  IF NOT FOUND
    OR operation."status" <> 'FINALIZED'
    OR operation."expectedSessionVersion" <> NEW."sequence" - 1
    OR operation."operationKey" IS DISTINCT FROM NEW."transitionKey"
    OR operation."providerReference" IS DISTINCT FROM NEW."evidence"->>'reference'
    OR operation."assetReference" IS DISTINCT FROM NEW."selectedAssetReference"
    OR operation."assetReference" IS DISTINCT FROM NEW."evidence"->>'providerAssetReference'
    OR (
      NEW."kind" = 'PURCHASE_RECORDED'
      AND operation."listingReference" IS DISTINCT FROM NEW."evidence"->>'providerListingReference'
    )
    OR (
      NEW."kind" = 'TRANSFER_RECORDED'
      AND operation."destinationReference" IS DISTINCT FROM NEW."evidence"->>'destinationWalletReference'
    )
  THEN
    RAISE EXCEPTION 'Flip lifecycle transition does not match finalized acquisition operation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FlipSessionTransition_acquisition_contract"
BEFORE INSERT ON "FlipSessionTransition"
FOR EACH ROW EXECUTE FUNCTION "validate_flip_acquisition_transition"();

CREATE FUNCTION "validate_flip_recovery_inventory_binding"() RETURNS trigger AS $$
DECLARE
  acquisition "FlipAcquisition"%ROWTYPE;
  operation "FlipAcquisitionOperation"%ROWTYPE;
BEGIN
  IF NEW."flipSessionId" IS NULL AND NEW."flipAcquisitionOperationId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."flipSessionId" IS DISTINCT FROM OLD."flipSessionId"
    OR NEW."flipAcquisitionOperationId" IS DISTINCT FROM OLD."flipAcquisitionOperationId"
    OR NEW."assetReference" IS DISTINCT FROM OLD."assetReference"
    OR NEW."acquisitionValueAmount" IS DISTINCT FROM OLD."acquisitionValueAmount"
    OR NEW."acquisitionValueCurrency" IS DISTINCT FROM OLD."acquisitionValueCurrency"
    OR NEW."acquisitionValueDecimals" IS DISTINCT FROM OLD."acquisitionValueDecimals"
    OR NEW."custodyWallet" IS DISTINCT FROM OLD."custodyWallet"
  ) THEN
    RAISE EXCEPTION 'Flip recovery inventory custody binding is immutable';
  END IF;
  SELECT * INTO operation
  FROM "FlipAcquisitionOperation"
  WHERE "id" = NEW."flipAcquisitionOperationId";
  SELECT * INTO acquisition
  FROM "FlipAcquisition"
  WHERE "id" = operation."acquisitionId";
  IF operation."kind" <> 'TRANSFER'
    OR operation."status" <> 'RECOVERY_REQUIRED'
    OR operation."recoveryMode" <> 'RETRYABLE'
    OR acquisition."status" <> 'RECOVERY_REQUIRED'
    OR acquisition."sessionId" IS DISTINCT FROM NEW."flipSessionId"
    OR acquisition."selectedAssetReference" IS DISTINCT FROM NEW."assetReference"
    OR acquisition."selectedValueAmount" IS DISTINCT FROM NEW."acquisitionValueAmount"
    OR acquisition."houseInventoryCustodyReference" IS DISTINCT FROM NEW."custodyWallet"
    OR NEW."acquisitionValueCurrency" <> 'USDC'
    OR NEW."acquisitionValueDecimals" <> 6
    OR (
      TG_OP = 'INSERT'
      AND (
        NEW."status" <> 'HELD'
        OR NEW."listingState" <> 'UNLISTED'
        OR NEW."disposition" <> 'MANUAL_REVIEW'
      )
    )
  THEN
    RAISE EXCEPTION 'Flip recovery inventory does not match acquisition custody evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "HouseInventoryAsset_flip_acquisition_contract"
BEFORE INSERT OR UPDATE ON "HouseInventoryAsset"
FOR EACH ROW EXECUTE FUNCTION "validate_flip_recovery_inventory_binding"();

CREATE FUNCTION "validate_flip_recovery_ledger_binding"() RETURNS trigger AS $$
DECLARE
  acquisition "FlipAcquisition"%ROWTYPE;
  inventory "HouseInventoryAsset"%ROWTYPE;
  operation "FlipAcquisitionOperation"%ROWTYPE;
BEGIN
  IF NEW."type"::TEXT <> 'FLIP_RECOVERY_INVENTORY' THEN
    IF NEW."flipSessionId" IS NOT NULL THEN
      RAISE EXCEPTION 'Non-Flip treasury ledger entry cannot bind a Flip session';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO inventory
  FROM "HouseInventoryAsset"
  WHERE "id" = NEW."inventoryId";
  SELECT * INTO operation
  FROM "FlipAcquisitionOperation"
  WHERE "id" = inventory."flipAcquisitionOperationId";
  SELECT * INTO acquisition
  FROM "FlipAcquisition"
  WHERE "id" = operation."acquisitionId";
  IF NOT FOUND
    OR NEW."flipSessionId" IS NULL
    OR inventory."flipSessionId" IS DISTINCT FROM NEW."flipSessionId"
    OR NEW."amount" IS DISTINCT FROM inventory."acquisitionValueAmount"
    OR NEW."currency" IS DISTINCT FROM inventory."acquisitionValueCurrency"
    OR NEW."decimals" IS DISTINCT FROM inventory."acquisitionValueDecimals"
    OR NEW."idempotencyKey" IS DISTINCT FROM
      'flip-recovery-inventory:' || inventory."flipAcquisitionOperationId"
    OR NEW."metadata"->>'selectionProofId' IS DISTINCT FROM acquisition."selectionProofId"
  THEN
    RAISE EXCEPTION 'Flip recovery ledger does not match retained inventory evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "HouseTreasuryLedgerEntry_flip_acquisition_contract"
BEFORE INSERT ON "HouseTreasuryLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "validate_flip_recovery_ledger_binding"();
