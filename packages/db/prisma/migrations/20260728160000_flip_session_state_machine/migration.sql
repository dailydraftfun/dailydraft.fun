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
      "status" IN ('RECOVERY_REQUIRED', 'RECOVERED', 'FAILED')
      OR (
        "status" = 'AWAITING_STAKE'
        AND "stakeAmount" IS NULL
      )
      OR (
        "status" = 'STAKE_CONFIRMED'
        AND "stakeAmount" IS NOT NULL
        AND "poolCommitmentId" IS NULL
      )
      OR (
        "status" = 'POOL_COMMITTED'
        AND "stakeAmount" IS NOT NULL
        AND "poolCommitmentId" IS NOT NULL
        AND "selectedOrdinal" IS NULL
      )
      OR (
        "status" = 'SELECTION_RECORDED'
        AND "poolCommitmentId" IS NOT NULL
        AND "selectedOrdinal" IS NOT NULL
        AND "purchaseReference" IS NULL
      )
      OR (
        "status" = 'PURCHASE_RECORDED'
        AND "selectedOrdinal" IS NOT NULL
        AND "purchaseReference" IS NOT NULL
        AND "transferReference" IS NULL
      )
      OR (
        "status" = 'TRANSFER_RECORDED'
        AND "purchaseReference" IS NOT NULL
        AND "transferReference" IS NOT NULL
        AND "revealReadyReference" IS NULL
      )
      OR (
        "status" IN ('REVEAL_READY', 'SETTLED')
        AND "purchaseReference" IS NOT NULL
        AND "transferReference" IS NOT NULL
        AND "revealReadyReference" IS NOT NULL
      )
    )
);

CREATE TABLE "FlipSessionTransition" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "transitionKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
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

CREATE FUNCTION "reject_flip_session_transition_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Flip session transitions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlipSessionTransition_append_only"
BEFORE UPDATE OR DELETE ON "FlipSessionTransition"
FOR EACH ROW EXECUTE FUNCTION "reject_flip_session_transition_mutation"();
