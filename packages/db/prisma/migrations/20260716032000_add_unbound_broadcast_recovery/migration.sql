ALTER TABLE "DuelTransaction"
ADD COLUMN "recoveredAt" TIMESTAMP(3),
ADD COLUMN "lastRecoveryCheckedAt" TIMESTAMP(3),
ADD COLUMN "nextRecoveryCheckAt" TIMESTAMP(3),
ADD COLUMN "recoveryCheckAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "recoveryCandidateAt" TIMESTAMP(3),
ADD COLUMN "recoveryCandidateSignature" TEXT,
ADD COLUMN "recoveryAlertCode" TEXT;

CREATE INDEX "DuelTransaction_status_nextRecoveryCheckAt_createdAt_idx"
ON "DuelTransaction"("status", "nextRecoveryCheckAt", "createdAt");

CREATE INDEX "DuelTransaction_recoveryCandidateAt_idx"
ON "DuelTransaction"("recoveryCandidateAt");
