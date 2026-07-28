CREATE TYPE "CrashRoundStatus" AS ENUM (
  'ACTIVE',
  'CASHED_OUT',
  'BUSTED',
  'COMPLETED',
  'DEFAULTED'
);

CREATE TYPE "CrashDecision" AS ENUM (
  'CONTINUE',
  'CASH_OUT',
  'FORFEIT'
);

CREATE TYPE "CrashTransitionKind" AS ENUM (
  'ROUND_STARTED',
  'STAGE_CONTINUED',
  'CASHED_OUT',
  'BUSTED',
  'COMPLETED',
  'DEADLINE_DEFAULTED'
);

CREATE TABLE "CrashRound" (
  "id" TEXT NOT NULL,
  "activationMode" TEXT NOT NULL DEFAULT 'fixture-only',
  "status" "CrashRoundStatus" NOT NULL DEFAULT 'ACTIVE',
  "stage" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "architectureVersion" TEXT NOT NULL,
  "stateMachineVersion" TEXT NOT NULL,
  "stateMachineRulesHash" TEXT NOT NULL,
  "calculatorVersion" TEXT NOT NULL,
  "rulesVersion" TEXT NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "playerWalletReference" TEXT NOT NULL,
  "potAmount" TEXT NOT NULL,
  "potCurrency" TEXT NOT NULL DEFAULT 'USDC',
  "potDecimals" INTEGER NOT NULL DEFAULT 6,
  "decisionDeadline" TIMESTAMP(3),
  "defaultAction" "CrashDecision" NOT NULL,
  "terminalReason" TEXT,
  "terminalAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrashRound_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrashRound_fixture_only_check"
    CHECK ("activationMode" = 'fixture-only'),
  CONSTRAINT "CrashRound_positive_state_check"
    CHECK ("stage" > 0 AND "version" > 0),
  CONSTRAINT "CrashRound_money_check"
    CHECK (
      "potAmount" ~ '^(0|[1-9][0-9]*)$'
      AND "potCurrency" = 'USDC'
      AND "potDecimals" = 6
    ),
  CONSTRAINT "CrashRound_hashes_check"
    CHECK (
      "stateMachineRulesHash" ~ '^[a-f0-9]{64}$'
      AND "rulesHash" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "CrashRound_terminal_state_check"
    CHECK (
      (
        "status" = 'ACTIVE'
        AND "decisionDeadline" IS NOT NULL
        AND "terminalAt" IS NULL
        AND "terminalReason" IS NULL
      )
      OR
      (
        "status" <> 'ACTIVE'
        AND "decisionDeadline" IS NULL
        AND "terminalAt" IS NOT NULL
        AND "terminalReason" IS NOT NULL
      )
    ),
  CONSTRAINT "CrashRound_default_action_check"
    CHECK ("defaultAction" = 'FORFEIT')
);

CREATE TABLE "CrashTransition" (
  "id" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "transitionKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "kind" "CrashTransitionKind" NOT NULL,
  "decision" "CrashDecision",
  "fromStatus" "CrashRoundStatus",
  "toStatus" "CrashRoundStatus" NOT NULL,
  "fromStage" INTEGER,
  "toStage" INTEGER NOT NULL,
  "scheduledDeadline" TIMESTAMP(3),
  "payment" JSONB,
  "outcome" JSONB,
  "valueChange" JSONB,
  "settlement" JSONB,
  "terminalReason" TEXT,
  "architectureVersion" TEXT NOT NULL,
  "stateMachineVersion" TEXT NOT NULL,
  "stateMachineRulesHash" TEXT NOT NULL,
  "calculatorVersion" TEXT NOT NULL,
  "rulesVersion" TEXT NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrashTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrashTransition_positive_state_check"
    CHECK ("sequence" > 0 AND "toStage" > 0 AND ("fromStage" IS NULL OR "fromStage" > 0)),
  CONSTRAINT "CrashTransition_hashes_check"
    CHECK (
      "requestHash" ~ '^[a-f0-9]{64}$'
      AND "stateMachineRulesHash" ~ '^[a-f0-9]{64}$'
      AND "rulesHash" ~ '^[a-f0-9]{64}$'
    )
);

CREATE INDEX "CrashRound_status_decisionDeadline_idx"
ON "CrashRound"("status", "decisionDeadline");

CREATE INDEX "CrashRound_playerWalletReference_createdAt_idx"
ON "CrashRound"("playerWalletReference", "createdAt");

CREATE INDEX "CrashRound_rulesHash_createdAt_idx"
ON "CrashRound"("rulesHash", "createdAt");

CREATE UNIQUE INDEX "CrashTransition_roundId_sequence_key"
ON "CrashTransition"("roundId", "sequence");

CREATE UNIQUE INDEX "CrashTransition_roundId_transitionKey_key"
ON "CrashTransition"("roundId", "transitionKey");

CREATE INDEX "CrashTransition_roundId_createdAt_idx"
ON "CrashTransition"("roundId", "createdAt");

CREATE INDEX "CrashTransition_rulesHash_createdAt_idx"
ON "CrashTransition"("rulesHash", "createdAt");

ALTER TABLE "CrashTransition"
ADD CONSTRAINT "CrashTransition_roundId_fkey"
FOREIGN KEY ("roundId") REFERENCES "CrashRound"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "protect_crash_round_contract"() RETURNS trigger AS $$
BEGIN
  IF
    NEW."activationMode" IS DISTINCT FROM OLD."activationMode"
    OR NEW."architectureVersion" IS DISTINCT FROM OLD."architectureVersion"
    OR NEW."stateMachineVersion" IS DISTINCT FROM OLD."stateMachineVersion"
    OR NEW."stateMachineRulesHash" IS DISTINCT FROM OLD."stateMachineRulesHash"
    OR NEW."calculatorVersion" IS DISTINCT FROM OLD."calculatorVersion"
    OR NEW."rulesVersion" IS DISTINCT FROM OLD."rulesVersion"
    OR NEW."rulesHash" IS DISTINCT FROM OLD."rulesHash"
    OR NEW."playerWalletReference" IS DISTINCT FROM OLD."playerWalletReference"
    OR NEW."defaultAction" IS DISTINCT FROM OLD."defaultAction"
    OR NEW."version" <> OLD."version" + 1
  THEN
    RAISE EXCEPTION 'Crash round contract references are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrashRound_contract_immutable"
BEFORE UPDATE ON "CrashRound"
FOR EACH ROW EXECUTE FUNCTION "protect_crash_round_contract"();

CREATE FUNCTION "reject_crash_transition_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Crash transitions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrashTransition_append_only"
BEFORE UPDATE OR DELETE ON "CrashTransition"
FOR EACH ROW EXECUTE FUNCTION "reject_crash_transition_mutation"();
