CREATE TYPE "HouseTreasuryReservationSource" AS ENUM ('DUEL', 'CRASH');

ALTER TYPE "HouseTreasuryLedgerType" ADD VALUE 'RESERVATION_ADJUSTED';

ALTER TABLE "CrashRound"
  ADD COLUMN "riskRulesVersion" TEXT,
  ADD COLUMN "riskRulesHash" TEXT,
  ADD COLUMN "riskStartedAt" TIMESTAMP(3),
  ADD COLUMN "riskExpiresAt" TIMESTAMP(3);

ALTER TABLE "CrashTransition"
  ADD COLUMN "riskEvidence" JSONB;

ALTER TABLE "HouseTreasuryReservation"
  ADD COLUMN "source" "HouseTreasuryReservationSource" NOT NULL DEFAULT 'DUEL',
  ADD COLUMN "crashRoundId" TEXT,
  ADD COLUMN "riskRulesHash" TEXT,
  ALTER COLUMN "duelId" DROP NOT NULL;

ALTER TABLE "HouseTreasuryLedgerEntry"
  ADD COLUMN "crashRoundId" TEXT;

CREATE UNIQUE INDEX "HouseTreasuryReservation_crashRoundId_key"
ON "HouseTreasuryReservation"("crashRoundId");

CREATE INDEX "HouseTreasuryReservation_source_status_reservedAt_idx"
ON "HouseTreasuryReservation"("source", "status", "reservedAt");

CREATE INDEX "HouseTreasuryLedgerEntry_crashRoundId_createdAt_idx"
ON "HouseTreasuryLedgerEntry"("crashRoundId", "createdAt");

ALTER TABLE "HouseTreasuryReservation"
ADD CONSTRAINT "HouseTreasuryReservation_source_reference_check"
CHECK (
  (
    "source" = 'DUEL'
    AND "duelId" IS NOT NULL
    AND "crashRoundId" IS NULL
    AND "riskRulesHash" IS NULL
  )
  OR
  (
    "source" = 'CRASH'
    AND "duelId" IS NULL
    AND "crashRoundId" IS NOT NULL
    AND "riskRulesHash" ~ '^[a-f0-9]{64}$'
  )
);

ALTER TABLE "CrashRound"
ADD CONSTRAINT "CrashRound_risk_contract_check"
CHECK (
  (
    "riskRulesVersion" IS NULL
    AND "riskRulesHash" IS NULL
    AND "riskStartedAt" IS NULL
    AND "riskExpiresAt" IS NULL
  )
  OR
  (
    "riskRulesVersion" IS NOT NULL
    AND "riskRulesHash" ~ '^[a-f0-9]{64}$'
    AND "riskStartedAt" IS NOT NULL
    AND "riskExpiresAt" > "riskStartedAt"
  )
);

ALTER TABLE "HouseTreasuryReservation"
ADD CONSTRAINT "HouseTreasuryReservation_crashRoundId_fkey"
FOREIGN KEY ("crashRoundId") REFERENCES "CrashRound"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HouseTreasuryLedgerEntry"
ADD CONSTRAINT "HouseTreasuryLedgerEntry_crashRoundId_fkey"
FOREIGN KEY ("crashRoundId") REFERENCES "CrashRound"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "protect_crash_treasury_reservation_contract"() RETURNS trigger AS $$
BEGIN
  IF
    OLD."source" = 'CRASH'
    AND (
      NEW."source" IS DISTINCT FROM OLD."source"
      OR NEW."duelId" IS DISTINCT FROM OLD."duelId"
      OR NEW."crashRoundId" IS DISTINCT FROM OLD."crashRoundId"
      OR NEW."riskRulesHash" IS DISTINCT FROM OLD."riskRulesHash"
      OR NEW."playerWallet" IS DISTINCT FROM OLD."playerWallet"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."decimals" IS DISTINCT FROM OLD."decimals"
      OR NEW."reservedAt" IS DISTINCT FROM OLD."reservedAt"
      OR NEW."version" <> OLD."version" + 1
    )
  THEN
    RAISE EXCEPTION 'Crash treasury reservation binding is immutable';
  END IF;
  IF NEW."source" IS DISTINCT FROM OLD."source" THEN
    RAISE EXCEPTION 'Treasury reservation source is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HouseTreasuryReservation_crash_contract_immutable"
BEFORE UPDATE ON "HouseTreasuryReservation"
FOR EACH ROW EXECUTE FUNCTION "protect_crash_treasury_reservation_contract"();

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
    OR NEW."version" <> OLD."version" + 1
  THEN
    RAISE EXCEPTION 'Crash round contract references are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
