CREATE TYPE "CrashCustodyIntentStatus" AS ENUM ('PREPARED', 'RECOVERY_REQUIRED');
CREATE TYPE "CrashCustodySigningStatus" AS ENUM ('NOT_STARTED');

CREATE TABLE "CrashCustodyMovementIntent" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "assetReference" TEXT NOT NULL,
    "sourceWalletReference" TEXT NOT NULL,
    "playerWalletReference" TEXT NOT NULL,
    "requestedRecipient" TEXT NOT NULL,
    "approvedRecipient" TEXT,
    "network" TEXT NOT NULL DEFAULT 'solana-devnet',
    "activationMode" TEXT NOT NULL DEFAULT 'fixture-only',
    "policyVersion" TEXT,
    "policyHash" TEXT,
    "architectureVersion" TEXT NOT NULL,
    "stateMachineVersion" TEXT NOT NULL,
    "stateMachineRulesHash" TEXT NOT NULL,
    "calculatorVersion" TEXT NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "rulesHash" TEXT NOT NULL,
    "status" "CrashCustodyIntentStatus" NOT NULL,
    "signingStatus" "CrashCustodySigningStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "recoveryReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrashCustodyMovementIntent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CrashCustodyMovementIntent_stage_check" CHECK ("stage" >= 1 AND "stage" <= 64),
    CONSTRAINT "CrashCustodyMovementIntent_version_check" CHECK ("expectedVersion" >= 1),
    CONSTRAINT "CrashCustodyMovementIntent_hashes_check" CHECK (
      "requestHash" ~ '^[a-f0-9]{64}$'
      AND "stateMachineRulesHash" ~ '^[a-f0-9]{64}$'
      AND "rulesHash" ~ '^[a-f0-9]{64}$'
      AND ("policyHash" IS NULL OR "policyHash" ~ '^[a-f0-9]{64}$')
    ),
    CONSTRAINT "CrashCustodyMovementIntent_fixture_boundary_check" CHECK (
      "network" = 'solana-devnet'
      AND "activationMode" = 'fixture-only'
      AND "signingStatus" = 'NOT_STARTED'
    ),
    CONSTRAINT "CrashCustodyMovementIntent_lifecycle_check" CHECK (
      (
        "status" = 'PREPARED'
        AND "approvedRecipient" IS NOT NULL
        AND "requestedRecipient" = "approvedRecipient"
        AND "policyVersion" IS NOT NULL
        AND "policyHash" IS NOT NULL
        AND "recoveryReason" IS NULL
      )
      OR
      (
        "status" = 'RECOVERY_REQUIRED'
        AND "recoveryReason" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "CrashCustodyMovementIntent_roundId_idempotencyKey_key"
ON "CrashCustodyMovementIntent"("roundId", "idempotencyKey");

-- Only one approved movement can exist for an acquired stage asset. Recovery
-- attempts remain appendable so a corrected policy can be reviewed explicitly.
CREATE UNIQUE INDEX "CrashCustodyMovementIntent_prepared_asset_key"
ON "CrashCustodyMovementIntent"("roundId", "stage", "assetReference")
WHERE "status" = 'PREPARED';

CREATE INDEX "CrashCustodyMovementIntent_roundId_stage_assetReference_idx"
ON "CrashCustodyMovementIntent"("roundId", "stage", "assetReference");

CREATE INDEX "CrashCustodyMovementIntent_status_createdAt_idx"
ON "CrashCustodyMovementIntent"("status", "createdAt");

ALTER TABLE "CrashCustodyMovementIntent"
ADD CONSTRAINT "CrashCustodyMovementIntent_roundId_fkey"
FOREIGN KEY ("roundId") REFERENCES "CrashRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_crash_custody_intent_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Crash custody movement intents are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrashCustodyMovementIntent_append_only_update"
BEFORE UPDATE ON "CrashCustodyMovementIntent"
FOR EACH ROW EXECUTE FUNCTION reject_crash_custody_intent_mutation();

CREATE TRIGGER "CrashCustodyMovementIntent_append_only_delete"
BEFORE DELETE ON "CrashCustodyMovementIntent"
FOR EACH ROW EXECUTE FUNCTION reject_crash_custody_intent_mutation();
