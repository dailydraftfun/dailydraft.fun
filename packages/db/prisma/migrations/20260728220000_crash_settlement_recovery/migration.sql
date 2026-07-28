ALTER TYPE "HouseTreasuryLedgerType" ADD VALUE 'CRASH_FORFEIT_INVENTORY';

CREATE TYPE "CrashSettlementStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'RECOVERY_REQUIRED',
  'SETTLED'
);

CREATE TYPE "CrashSettlementKind" AS ENUM ('CASH_OUT', 'BUST');

CREATE TYPE "CrashSettlementOperationKind" AS ENUM (
  'PURCHASE',
  'OPEN',
  'TRANSFER',
  'LIQUIDATE'
);

CREATE TYPE "CrashSettlementOperationStatus" AS ENUM (
  'PREPARED',
  'RECOVERY_REQUIRED',
  'FINALIZED'
);

CREATE TYPE "CrashSettlementRecoveryMode" AS ENUM (
  'NONE',
  'RETRYABLE',
  'RECONCILE_ONLY'
);

ALTER TABLE "CrashRound"
  ADD COLUMN "settlementStatus" "CrashSettlementStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "settlementReceiptHash" TEXT,
  ADD COLUMN "settledAt" TIMESTAMP(3);

-- The risk migration's trigger required every CrashRound update to advance the
-- gameplay transition version. Settlement is an orthogonal lifecycle, so
-- replace that function before backfilling terminal settlement state.
CREATE OR REPLACE FUNCTION "protect_crash_round_contract"() RETURNS trigger AS $$
BEGIN
  IF
    NEW."activationMode" IS DISTINCT FROM OLD."activationMode"
    OR NEW."architectureVersion" IS DISTINCT FROM OLD."architectureVersion"
    OR NEW."stateMachineVersion" IS DISTINCT FROM OLD."stateMachineVersion"
    OR NEW."stateMachineRulesHash" IS DISTINCT FROM OLD."stateMachineRulesHash"
    OR NEW."calculatorVersion" IS DISTINCT FROM OLD."calculatorVersion"
    OR NEW."rulesVersion" IS DISTINCT FROM OLD."rulesVersion"
    OR NEW."rulesHash" IS DISTINCT FROM OLD."rulesHash"
    OR NEW."riskRulesVersion" IS DISTINCT FROM OLD."riskRulesVersion"
    OR NEW."riskRulesHash" IS DISTINCT FROM OLD."riskRulesHash"
    OR NEW."riskStartedAt" IS DISTINCT FROM OLD."riskStartedAt"
    OR NEW."riskExpiresAt" IS DISTINCT FROM OLD."riskExpiresAt"
    OR NEW."playerWalletReference" IS DISTINCT FROM OLD."playerWalletReference"
    OR NEW."defaultAction" IS DISTINCT FROM OLD."defaultAction"
  THEN
    RAISE EXCEPTION 'Crash round contract references are immutable';
  END IF;

  IF
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."stage" IS DISTINCT FROM OLD."stage"
    OR NEW."potAmount" IS DISTINCT FROM OLD."potAmount"
    OR NEW."potCurrency" IS DISTINCT FROM OLD."potCurrency"
    OR NEW."potDecimals" IS DISTINCT FROM OLD."potDecimals"
    OR NEW."decisionDeadline" IS DISTINCT FROM OLD."decisionDeadline"
    OR NEW."terminalReason" IS DISTINCT FROM OLD."terminalReason"
    OR NEW."terminalAt" IS DISTINCT FROM OLD."terminalAt"
  THEN
    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'Crash round transition version must advance exactly once';
    END IF;
  ELSIF NEW."version" <> OLD."version" THEN
    RAISE EXCEPTION 'Crash settlement updates cannot advance the transition version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE "CrashRound"
SET "settlementStatus" = 'PENDING'
WHERE "status" <> 'ACTIVE';

CREATE INDEX "CrashRound_settlementStatus_updatedAt_idx"
ON "CrashRound"("settlementStatus", "updatedAt");

CREATE TABLE "CrashSettlement" (
  "id" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "terminalTransitionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "kind" "CrashSettlementKind" NOT NULL,
  "status" "CrashSettlementStatus" NOT NULL DEFAULT 'PENDING',
  "activationMode" TEXT NOT NULL DEFAULT 'fixture-only',
  "network" TEXT NOT NULL DEFAULT 'solana-devnet',
  "playerWalletReference" TEXT NOT NULL,
  "custodyRecipient" TEXT NOT NULL,
  "custodyPolicyVersion" TEXT NOT NULL,
  "custodyPolicyHash" TEXT NOT NULL,
  "inventoryRecipient" TEXT NOT NULL,
  "settlementPolicyVersion" TEXT NOT NULL,
  "settlementPolicyHash" TEXT NOT NULL,
  "inventoryPolicyVersion" TEXT NOT NULL,
  "inventoryPolicyHash" TEXT NOT NULL,
  "architectureVersion" TEXT NOT NULL,
  "stateMachineVersion" TEXT NOT NULL,
  "stateMachineRulesHash" TEXT NOT NULL,
  "calculatorVersion" TEXT NOT NULL,
  "rulesVersion" TEXT NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "riskRulesVersion" TEXT NOT NULL,
  "riskRulesHash" TEXT NOT NULL,
  "expectedOperationCount" INTEGER NOT NULL,
  "finalizedOperationCount" INTEGER NOT NULL DEFAULT 0,
  "recoveryReason" TEXT,
  "receipt" JSONB,
  "receiptHash" TEXT,
  "settledAt" TIMESTAMP(3),
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrashSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrashSettlementOperation" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "operationKey" TEXT NOT NULL,
  "providerRequestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "kind" "CrashSettlementOperationKind" NOT NULL,
  "status" "CrashSettlementOperationStatus" NOT NULL DEFAULT 'PREPARED',
  "recoveryMode" "CrashSettlementRecoveryMode" NOT NULL DEFAULT 'NONE',
  "assetReference" TEXT NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "destinationReference" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "decimals" INTEGER NOT NULL DEFAULT 6,
  "stage" INTEGER,
  "providerSignature" TEXT,
  "providerResultHash" TEXT,
  "providerEvidence" JSONB,
  "failureCode" TEXT,
  "submissionCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrashSettlementOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrashSettlement_roundId_key"
ON "CrashSettlement"("roundId");

CREATE UNIQUE INDEX "CrashSettlement_terminalTransitionId_key"
ON "CrashSettlement"("terminalTransitionId");

CREATE UNIQUE INDEX "CrashSettlement_roundId_idempotencyKey_key"
ON "CrashSettlement"("roundId", "idempotencyKey");

CREATE INDEX "CrashSettlement_status_leaseExpiresAt_updatedAt_idx"
ON "CrashSettlement"("status", "leaseExpiresAt", "updatedAt");

CREATE UNIQUE INDEX "CrashSettlementOperation_providerRequestKey_key"
ON "CrashSettlementOperation"("providerRequestKey");

CREATE UNIQUE INDEX "CrashSettlementOperation_providerSignature_key"
ON "CrashSettlementOperation"("providerSignature");

CREATE UNIQUE INDEX "CrashSettlementOperation_settlementId_sequence_key"
ON "CrashSettlementOperation"("settlementId", "sequence");

CREATE UNIQUE INDEX "CrashSettlementOperation_settlementId_operationKey_key"
ON "CrashSettlementOperation"("settlementId", "operationKey");

CREATE INDEX "CrashSettlementOperation_status_recoveryMode_updatedAt_idx"
ON "CrashSettlementOperation"("status", "recoveryMode", "updatedAt");

ALTER TABLE "CrashSettlement"
ADD CONSTRAINT "CrashSettlement_roundId_fkey"
FOREIGN KEY ("roundId") REFERENCES "CrashRound"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CrashSettlement"
ADD CONSTRAINT "CrashSettlement_terminalTransitionId_fkey"
FOREIGN KEY ("terminalTransitionId") REFERENCES "CrashTransition"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CrashSettlementOperation"
ADD CONSTRAINT "CrashSettlementOperation_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "CrashSettlement"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HouseInventoryAsset"
  ALTER COLUMN "duelId" DROP NOT NULL,
  ALTER COLUMN "outcomeId" DROP NOT NULL,
  ADD COLUMN "crashRoundId" TEXT,
  ADD COLUMN "crashSettlementOperationId" TEXT;

CREATE UNIQUE INDEX "HouseInventoryAsset_crashSettlementOperationId_key"
ON "HouseInventoryAsset"("crashSettlementOperationId");

CREATE INDEX "HouseInventoryAsset_crashRoundId_createdAt_idx"
ON "HouseInventoryAsset"("crashRoundId", "createdAt");

ALTER TABLE "HouseInventoryAsset"
ADD CONSTRAINT "HouseInventoryAsset_crashRoundId_fkey"
FOREIGN KEY ("crashRoundId") REFERENCES "CrashRound"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HouseInventoryAsset"
ADD CONSTRAINT "HouseInventoryAsset_crashSettlementOperationId_fkey"
FOREIGN KEY ("crashSettlementOperationId") REFERENCES "CrashSettlementOperation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CrashRound"
ADD CONSTRAINT "CrashRound_settlement_contract_check"
CHECK (
  (
    "status" = 'ACTIVE'
    AND "settlementStatus" = 'NOT_REQUIRED'
    AND "settlementReceiptHash" IS NULL
    AND "settledAt" IS NULL
  )
  OR
  (
    "status" <> 'ACTIVE'
    AND "settlementStatus" IN ('PENDING', 'RECOVERY_REQUIRED')
    AND "settlementReceiptHash" IS NULL
    AND "settledAt" IS NULL
  )
  OR
  (
    "status" <> 'ACTIVE'
    AND "settlementStatus" = 'SETTLED'
    AND "settlementReceiptHash" ~ '^[a-f0-9]{64}$'
    AND "settledAt" IS NOT NULL
  )
);

ALTER TABLE "CrashSettlement"
ADD CONSTRAINT "CrashSettlement_contract_check"
CHECK (
  "activationMode" = 'fixture-only'
  AND "network" = 'solana-devnet'
  AND "requestHash" ~ '^[a-f0-9]{64}$'
  AND "settlementPolicyHash" ~ '^[a-f0-9]{64}$'
  AND "custodyPolicyHash" ~ '^[a-f0-9]{64}$'
  AND "inventoryPolicyHash" ~ '^[a-f0-9]{64}$'
  AND "stateMachineRulesHash" ~ '^[a-f0-9]{64}$'
  AND "rulesHash" ~ '^[a-f0-9]{64}$'
  AND "riskRulesHash" ~ '^[a-f0-9]{64}$'
  AND "expectedOperationCount" >= 0
  AND "finalizedOperationCount" >= 0
  AND "finalizedOperationCount" <= "expectedOperationCount"
  AND (
    (
      "status" <> 'SETTLED'
      AND "receipt" IS NULL
      AND "receiptHash" IS NULL
      AND "settledAt" IS NULL
    )
    OR
    (
      "status" = 'SETTLED'
      AND "finalizedOperationCount" = "expectedOperationCount"
      AND "recoveryReason" IS NULL
      AND "receipt" IS NOT NULL
      AND "receiptHash" ~ '^[a-f0-9]{64}$'
      AND "settledAt" IS NOT NULL
      AND "leaseOwner" IS NULL
      AND "leaseExpiresAt" IS NULL
    )
  )
);

ALTER TABLE "CrashSettlementOperation"
ADD CONSTRAINT "CrashSettlementOperation_contract_check"
CHECK (
  "sequence" > 0
  AND "requestHash" ~ '^[a-f0-9]{64}$'
  AND "amount" ~ '^(0|[1-9][0-9]*)$'
  AND "currency" = 'USDC'
  AND "decimals" = 6
  AND ("stage" IS NULL OR "stage" > 0)
  AND "submissionCount" >= 0
  AND (
    (
      "status" = 'PREPARED'
      AND "recoveryMode" = 'NONE'
      AND "providerSignature" IS NULL
      AND "providerResultHash" IS NULL
      AND "providerEvidence" IS NULL
      AND "failureCode" IS NULL
      AND "finalizedAt" IS NULL
    )
    OR
    (
      "status" = 'RECOVERY_REQUIRED'
      AND "recoveryMode" IN ('RETRYABLE', 'RECONCILE_ONLY')
      AND "providerResultHash" IS NULL
      AND "providerEvidence" IS NULL
      AND "failureCode" IS NOT NULL
      AND "finalizedAt" IS NULL
    )
    OR
    (
      "status" = 'FINALIZED'
      AND "recoveryMode" = 'NONE'
      AND "providerSignature" IS NOT NULL
      AND "providerResultHash" ~ '^[a-f0-9]{64}$'
      AND "providerEvidence" IS NOT NULL
      AND "failureCode" IS NULL
      AND "finalizedAt" IS NOT NULL
    )
  )
);

ALTER TABLE "HouseInventoryAsset"
ADD CONSTRAINT "HouseInventoryAsset_source_contract_check"
CHECK (
  (
    "duelId" IS NOT NULL
    AND "outcomeId" IS NOT NULL
    AND "crashRoundId" IS NULL
    AND "crashSettlementOperationId" IS NULL
  )
  OR
  (
    "duelId" IS NULL
    AND "outcomeId" IS NULL
    AND "crashRoundId" IS NOT NULL
    AND "crashSettlementOperationId" IS NOT NULL
  )
);

CREATE FUNCTION "protect_crash_settlement_contract"() RETURNS trigger AS $$
BEGIN
  IF
    NEW."roundId" IS DISTINCT FROM OLD."roundId"
    OR NEW."terminalTransitionId" IS DISTINCT FROM OLD."terminalTransitionId"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."activationMode" IS DISTINCT FROM OLD."activationMode"
    OR NEW."network" IS DISTINCT FROM OLD."network"
    OR NEW."playerWalletReference" IS DISTINCT FROM OLD."playerWalletReference"
    OR NEW."custodyRecipient" IS DISTINCT FROM OLD."custodyRecipient"
    OR NEW."custodyPolicyVersion" IS DISTINCT FROM OLD."custodyPolicyVersion"
    OR NEW."custodyPolicyHash" IS DISTINCT FROM OLD."custodyPolicyHash"
    OR NEW."inventoryRecipient" IS DISTINCT FROM OLD."inventoryRecipient"
    OR NEW."settlementPolicyVersion" IS DISTINCT FROM OLD."settlementPolicyVersion"
    OR NEW."settlementPolicyHash" IS DISTINCT FROM OLD."settlementPolicyHash"
    OR NEW."inventoryPolicyVersion" IS DISTINCT FROM OLD."inventoryPolicyVersion"
    OR NEW."inventoryPolicyHash" IS DISTINCT FROM OLD."inventoryPolicyHash"
    OR NEW."architectureVersion" IS DISTINCT FROM OLD."architectureVersion"
    OR NEW."stateMachineVersion" IS DISTINCT FROM OLD."stateMachineVersion"
    OR NEW."stateMachineRulesHash" IS DISTINCT FROM OLD."stateMachineRulesHash"
    OR NEW."calculatorVersion" IS DISTINCT FROM OLD."calculatorVersion"
    OR NEW."rulesVersion" IS DISTINCT FROM OLD."rulesVersion"
    OR NEW."rulesHash" IS DISTINCT FROM OLD."rulesHash"
    OR NEW."riskRulesVersion" IS DISTINCT FROM OLD."riskRulesVersion"
    OR NEW."riskRulesHash" IS DISTINCT FROM OLD."riskRulesHash"
    OR NEW."expectedOperationCount" IS DISTINCT FROM OLD."expectedOperationCount"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."version" <> OLD."version" + 1
    OR OLD."status" = 'SETTLED'
  THEN
    RAISE EXCEPTION 'Crash settlement plan is immutable or terminal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrashSettlement_contract_immutable"
BEFORE UPDATE ON "CrashSettlement"
FOR EACH ROW EXECUTE FUNCTION "protect_crash_settlement_contract"();

CREATE FUNCTION "protect_crash_settlement_operation_contract"() RETURNS trigger AS $$
BEGIN
  IF
    NEW."settlementId" IS DISTINCT FROM OLD."settlementId"
    OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
    OR NEW."operationKey" IS DISTINCT FROM OLD."operationKey"
    OR NEW."providerRequestKey" IS DISTINCT FROM OLD."providerRequestKey"
    OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."assetReference" IS DISTINCT FROM OLD."assetReference"
    OR NEW."sourceReference" IS DISTINCT FROM OLD."sourceReference"
    OR NEW."destinationReference" IS DISTINCT FROM OLD."destinationReference"
    OR NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."decimals" IS DISTINCT FROM OLD."decimals"
    OR NEW."stage" IS DISTINCT FROM OLD."stage"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR OLD."status" = 'FINALIZED'
    OR (
      OLD."providerSignature" IS NOT NULL
      AND NEW."providerSignature" IS DISTINCT FROM OLD."providerSignature"
    )
  THEN
    RAISE EXCEPTION 'Crash settlement operation request or finality is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrashSettlementOperation_contract_immutable"
BEFORE UPDATE ON "CrashSettlementOperation"
FOR EACH ROW EXECUTE FUNCTION "protect_crash_settlement_operation_contract"();
