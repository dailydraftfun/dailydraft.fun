CREATE TYPE "FantasySport" AS ENUM (
    'SOCCER',
    'FOOTBALL',
    'BASEBALL',
    'BASKETBALL'
);

CREATE TYPE "FantasyPosition" AS ENUM (
    'GOALKEEPER',
    'DEFENDER',
    'MIDFIELDER',
    'FORWARD'
);

CREATE TYPE "FantasyTournamentStatus" AS ENUM (
    'DRAFT',
    'SCHEDULED',
    'LOCKED',
    'SCORING',
    'SETTLED',
    'CANCELLED'
);

CREATE TYPE "FantasyMatchResultStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'VOIDED'
);

CREATE TABLE "FantasyPlayer" (
    "id" TEXT NOT NULL,
    "sport" "FantasySport" NOT NULL,
    "position" "FantasyPosition" NOT NULL,
    "collectorCryptPlayerRef" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "teamReference" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FantasyPlayer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FantasyPlayerHolding" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "custodyReference" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FantasyPlayerHolding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FantasyTournament" (
    "id" TEXT NOT NULL,
    "sport" "FantasySport" NOT NULL,
    "status" "FantasyTournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "locksAt" TIMESTAMP(3) NOT NULL,
    "settlesAt" TIMESTAMP(3) NOT NULL,
    "prizePoolAmount" TEXT NOT NULL,
    "prizePoolCurrency" TEXT NOT NULL DEFAULT 'USDC',
    "prizePoolDecimals" INTEGER NOT NULL DEFAULT 6,
    "scoringVersion" TEXT NOT NULL,
    "scoringRulesHash" TEXT NOT NULL,
    "payoutVersion" TEXT NOT NULL,
    "payoutRulesHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FantasyTournament_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FantasyTournamentEntry" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FantasyTournamentEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FantasyKickoffSnapshot" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "eligibleShareTotal" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FantasyKickoffSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FantasyKickoffSnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" "FantasyPosition" NOT NULL,
    "eligibleShares" INTEGER NOT NULL,
    "custodyReference" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FantasyKickoffSnapshotEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FantasyMatchResult" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" "FantasyPosition" NOT NULL,
    "oracleMode" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "statLine" JSONB NOT NULL,
    "status" "FantasyMatchResultStatus" NOT NULL DEFAULT 'PENDING',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FantasyMatchResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FantasyPlayerScore" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" "FantasyPosition" NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "scoringRulesHash" TEXT NOT NULL,
    "calculationHash" TEXT NOT NULL,
    "totalPoints" TEXT NOT NULL,
    "pointsScale" INTEGER NOT NULL DEFAULT 1000,
    "breakdown" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FantasyPlayerScore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FantasyPayoutAllocation" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "payoutVersion" TEXT NOT NULL,
    "payoutRulesHash" TEXT NOT NULL,
    "calculationHash" TEXT NOT NULL,
    "position" "FantasyPosition" NOT NULL,
    "place" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "eligibleShares" INTEGER NOT NULL,
    "placeBasisPoints" INTEGER NOT NULL,
    "placeAllocationAmount" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "decimals" INTEGER NOT NULL DEFAULT 6,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FantasyPayoutAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FantasyPlayer_collectorCryptPlayerRef_key"
ON "FantasyPlayer"("collectorCryptPlayerRef");

CREATE INDEX "FantasyPlayer_sport_position_idx"
ON "FantasyPlayer"("sport", "position");

CREATE INDEX "FantasyPlayer_active_sport_idx"
ON "FantasyPlayer"("active", "sport");

CREATE UNIQUE INDEX "FantasyPlayerHolding_custodyReference_key"
ON "FantasyPlayerHolding"("custodyReference");

CREATE UNIQUE INDEX "FantasyPlayerHolding_walletAddress_playerId_custodyReferenc_key"
ON "FantasyPlayerHolding"("walletAddress", "playerId", "custodyReference");

CREATE INDEX "FantasyPlayerHolding_playerId_walletAddress_idx"
ON "FantasyPlayerHolding"("playerId", "walletAddress");

CREATE INDEX "FantasyPlayerHolding_walletAddress_idx"
ON "FantasyPlayerHolding"("walletAddress");

CREATE INDEX "FantasyTournament_sport_status_locksAt_idx"
ON "FantasyTournament"("sport", "status", "locksAt");

CREATE INDEX "FantasyTournament_status_settlesAt_idx"
ON "FantasyTournament"("status", "settlesAt");

CREATE UNIQUE INDEX "FantasyTournamentEntry_tournamentId_holdingId_key"
ON "FantasyTournamentEntry"("tournamentId", "holdingId");

CREATE INDEX "FantasyTournamentEntry_tournamentId_playerId_idx"
ON "FantasyTournamentEntry"("tournamentId", "playerId");

CREATE INDEX "FantasyTournamentEntry_walletAddress_idx"
ON "FantasyTournamentEntry"("walletAddress");

CREATE UNIQUE INDEX "FantasyKickoffSnapshot_tournamentId_revision_key"
ON "FantasyKickoffSnapshot"("tournamentId", "revision");

CREATE UNIQUE INDEX "FantasyKickoffSnapshot_tournamentId_contentHash_key"
ON "FantasyKickoffSnapshot"("tournamentId", "contentHash");

CREATE INDEX "FantasyKickoffSnapshot_tournamentId_createdAt_idx"
ON "FantasyKickoffSnapshot"("tournamentId", "createdAt");

CREATE UNIQUE INDEX "FantasyKickoffSnapshotEntry_snapshotId_ordinal_key"
ON "FantasyKickoffSnapshotEntry"("snapshotId", "ordinal");

CREATE UNIQUE INDEX "FantasyKickoffSnapshotEntry_snapshotId_custodyReference_key"
ON "FantasyKickoffSnapshotEntry"("snapshotId", "custodyReference");

CREATE INDEX "FantasyKickoffSnapshotEntry_snapshotId_playerId_idx"
ON "FantasyKickoffSnapshotEntry"("snapshotId", "playerId");

CREATE INDEX "FantasyKickoffSnapshotEntry_snapshotId_position_playerId_idx"
ON "FantasyKickoffSnapshotEntry"("snapshotId", "position", "playerId");

CREATE UNIQUE INDEX "FantasyMatchResult_tournamentId_playerId_providerReference_key"
ON "FantasyMatchResult"("tournamentId", "playerId", "providerReference");

CREATE INDEX "FantasyMatchResult_tournamentId_status_idx"
ON "FantasyMatchResult"("tournamentId", "status");

CREATE INDEX "FantasyMatchResult_tournamentId_playerId_idx"
ON "FantasyMatchResult"("tournamentId", "playerId");

CREATE UNIQUE INDEX "FantasyPlayerScore_tournamentId_playerId_scoringRulesHash_key"
ON "FantasyPlayerScore"("tournamentId", "playerId", "scoringRulesHash");

CREATE INDEX "FantasyPlayerScore_tournamentId_position_idx"
ON "FantasyPlayerScore"("tournamentId", "position");

CREATE UNIQUE INDEX "FantasyPayoutAllocation_tournamentId_payoutRulesHash_positi_key"
ON "FantasyPayoutAllocation"("tournamentId", "payoutRulesHash", "position", "place", "walletAddress");

CREATE INDEX "FantasyPayoutAllocation_tournamentId_position_place_idx"
ON "FantasyPayoutAllocation"("tournamentId", "position", "place");

CREATE INDEX "FantasyPayoutAllocation_walletAddress_idx"
ON "FantasyPayoutAllocation"("walletAddress");

ALTER TABLE "FantasyPlayerHolding"
ADD CONSTRAINT "FantasyPlayerHolding_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "FantasyPlayer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyTournamentEntry"
ADD CONSTRAINT "FantasyTournamentEntry_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "FantasyTournament"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyTournamentEntry"
ADD CONSTRAINT "FantasyTournamentEntry_holdingId_fkey"
FOREIGN KEY ("holdingId") REFERENCES "FantasyPlayerHolding"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyTournamentEntry"
ADD CONSTRAINT "FantasyTournamentEntry_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "FantasyPlayer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyKickoffSnapshot"
ADD CONSTRAINT "FantasyKickoffSnapshot_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "FantasyTournament"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyKickoffSnapshotEntry"
ADD CONSTRAINT "FantasyKickoffSnapshotEntry_snapshotId_fkey"
FOREIGN KEY ("snapshotId") REFERENCES "FantasyKickoffSnapshot"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyMatchResult"
ADD CONSTRAINT "FantasyMatchResult_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "FantasyTournament"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyPlayerScore"
ADD CONSTRAINT "FantasyPlayerScore_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "FantasyTournament"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyPayoutAllocation"
ADD CONSTRAINT "FantasyPayoutAllocation_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "FantasyTournament"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Non-Prisma hardening below. These CHECK constraints and triggers are invisible
-- to `prisma migrate diff`, matching the flip inventory snapshot precedent.

ALTER TABLE "FantasyPlayerHolding"
ADD CONSTRAINT "FantasyPlayerHolding_contract_check" CHECK (
  "shares" > 0
  AND ("releasedAt" IS NULL OR "releasedAt" >= "acquiredAt")
);

ALTER TABLE "FantasyTournament"
ADD CONSTRAINT "FantasyTournament_contract_check" CHECK (
  "prizePoolAmount" ~ '^[0-9]+$'
  AND "prizePoolCurrency" = 'USDC'
  AND "prizePoolDecimals" = 6
  AND "scoringVersion" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  AND "payoutVersion" ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
  AND "scoringRulesHash" ~ '^[a-f0-9]{64}$'
  AND "payoutRulesHash" ~ '^[a-f0-9]{64}$'
  AND "locksAt" >= "opensAt"
  AND "settlesAt" >= "locksAt"
);

ALTER TABLE "FantasyTournamentEntry"
ADD CONSTRAINT "FantasyTournamentEntry_contract_check" CHECK (
  "shares" > 0
);

ALTER TABLE "FantasyKickoffSnapshot"
ADD CONSTRAINT "FantasyKickoffSnapshot_contract_check" CHECK (
  "revision" > 0
  AND "schemaVersion" = 'dailydraft.fantasy-kickoff.v1'
  AND "policyHash" ~ '^[a-f0-9]{64}$'
  AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND "eligibleShareTotal" ~ '^[0-9]+$'
  AND "entryCount" >= 0
  AND "playerCount" >= 0
  AND "playerCount" <= "entryCount"
  AND jsonb_typeof("policy") = 'object'
);

ALTER TABLE "FantasyKickoffSnapshotEntry"
ADD CONSTRAINT "FantasyKickoffSnapshotEntry_contract_check" CHECK (
  "ordinal" >= 0
  AND "eligibleShares" > 0
);

ALTER TABLE "FantasyMatchResult"
ADD CONSTRAINT "FantasyMatchResult_contract_check" CHECK (
  char_length("oracleMode") > 0
  AND char_length("providerReference") > 0
  AND jsonb_typeof("statLine") = 'object'
);

ALTER TABLE "FantasyPlayerScore"
ADD CONSTRAINT "FantasyPlayerScore_contract_check" CHECK (
  "scoringRulesHash" ~ '^[a-f0-9]{64}$'
  AND "calculationHash" ~ '^[a-f0-9]{64}$'
  AND "totalPoints" ~ '^-?(0|[1-9][0-9]*)$'
  AND "pointsScale" > 0
  AND jsonb_typeof("breakdown") = 'array'
);

ALTER TABLE "FantasyPayoutAllocation"
ADD CONSTRAINT "FantasyPayoutAllocation_contract_check" CHECK (
  "payoutRulesHash" ~ '^[a-f0-9]{64}$'
  AND "calculationHash" ~ '^[a-f0-9]{64}$'
  AND "place" > 0
  AND "placeBasisPoints" BETWEEN 0 AND 10000
  AND "eligibleShares" > 0
  AND "placeAllocationAmount" ~ '^[0-9]+$'
  AND "amount" ~ '^[0-9]+$'
  AND "currency" = 'USDC'
  AND "decimals" = 6
  AND "amount"::NUMERIC <= "placeAllocationAmount"::NUMERIC
);

-- Kickoff snapshots are sealed, append-only evidence. Mirrors the flip inventory
-- snapshot immutability model: created unsealed, sealed once with a metadata
-- reconciliation check, and never mutated afterwards.

CREATE FUNCTION "reject_fantasy_kickoff_snapshot_mutation"() RETURNS trigger AS $$
DECLARE
  actual_entry_count BIGINT;
  actual_player_count BIGINT;
  actual_eligible_total NUMERIC;
  actual_minimum_ordinal INTEGER;
  actual_maximum_ordinal INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."sealedAt" IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Fantasy kickoff snapshots must be created unsealed';
  END IF;
  IF (
    TG_OP = 'UPDATE'
    AND OLD."sealedAt" IS NULL
    AND NEW."sealedAt" IS NOT NULL
    AND (to_jsonb(NEW) - 'sealedAt') = (to_jsonb(OLD) - 'sealedAt')
  ) THEN
    SELECT
      count(*),
      count(DISTINCT "playerId"),
      COALESCE(sum("eligibleShares"), 0),
      min("ordinal"),
      max("ordinal")
    INTO
      actual_entry_count,
      actual_player_count,
      actual_eligible_total,
      actual_minimum_ordinal,
      actual_maximum_ordinal
    FROM "FantasyKickoffSnapshotEntry"
    WHERE "snapshotId" = NEW."id";

    IF (
      actual_entry_count <> NEW."entryCount"
      OR actual_player_count <> NEW."playerCount"
      OR actual_eligible_total <> NEW."eligibleShareTotal"::NUMERIC
      OR (
        actual_entry_count > 0
        AND (actual_minimum_ordinal <> 0 OR actual_maximum_ordinal <> actual_entry_count - 1)
      )
    ) THEN
      RAISE EXCEPTION 'Fantasy kickoff snapshot contents do not match metadata';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Fantasy kickoff snapshots are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FantasyKickoffSnapshot_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "FantasyKickoffSnapshot"
FOR EACH ROW EXECUTE FUNCTION "reject_fantasy_kickoff_snapshot_mutation"();

CREATE FUNCTION "require_fantasy_kickoff_snapshot_sealed"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "FantasyKickoffSnapshot"
    WHERE "id" = NEW."id"
      AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Fantasy kickoff snapshot must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "FantasyKickoffSnapshot_sealed_before_commit"
AFTER INSERT ON "FantasyKickoffSnapshot"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_fantasy_kickoff_snapshot_sealed"();

CREATE FUNCTION "reject_fantasy_kickoff_entry_after_seal"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FantasyKickoffSnapshot"
    WHERE "id" = NEW."snapshotId"
      AND "sealedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Fantasy kickoff snapshot entries are sealed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FantasyKickoffSnapshotEntry_sealed"
BEFORE INSERT ON "FantasyKickoffSnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION "reject_fantasy_kickoff_entry_after_seal"();

CREATE FUNCTION "reject_fantasy_kickoff_entry_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Fantasy kickoff snapshots are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FantasyKickoffSnapshotEntry_append_only"
BEFORE UPDATE OR DELETE ON "FantasyKickoffSnapshotEntry"
FOR EACH ROW EXECUTE FUNCTION "reject_fantasy_kickoff_entry_mutation"();
