ALTER TYPE "DuelTransactionStatus" ADD VALUE 'FINALIZED' AFTER 'CONFIRMED';

ALTER TABLE "DuelTransaction"
ADD COLUMN "submissionIdempotencyKey" TEXT,
ADD COLUMN "expectedSigner" TEXT,
ADD COLUMN "expectedProgramId" TEXT,
ADD COLUMN "expectedAccounts" JSONB,
ADD COLUMN "expectedInstructionDataHash" TEXT,
ADD COLUMN "expectedInstructionAccounts" JSONB,
ADD COLUMN "allowMultipleInstructionMatches" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "expectedFromStatus" "DuelStatus",
ADD COLUMN "expectedToStatus" "DuelStatus",
ADD COLUMN "confirmationStatus" TEXT,
ADD COLUMN "checkAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN "nextCheckAt" TIMESTAMP(3),
ADD COLUMN "stuckAt" TIMESTAMP(3),
ADD COLUMN "finalizedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "DuelTransaction_submissionIdempotencyKey_key"
ON "DuelTransaction"("submissionIdempotencyKey");

CREATE INDEX "DuelTransaction_status_nextCheckAt_idx"
ON "DuelTransaction"("status", "nextCheckAt");
