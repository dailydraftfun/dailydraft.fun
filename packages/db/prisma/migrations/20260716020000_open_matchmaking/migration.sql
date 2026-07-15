ALTER TYPE "ProductEventName" ADD VALUE 'MATCHMAKING_WAIT_STARTED';
ALTER TYPE "ProductEventName" ADD VALUE 'MATCHMAKING_MATCHED';
ALTER TYPE "ProductEventName" ADD VALUE 'MATCHMAKING_ABANDONED';
ALTER TYPE "ProductEventName" ADD VALUE 'MATCHMAKING_COMMITMENT_FAILED';
ALTER TYPE "ProductEventName" ADD VALUE 'HOUSE_FALLBACK_SELECTED';

CREATE TYPE "MatchmakingTicketRole" AS ENUM ('CREATOR', 'OPPONENT');
CREATE TYPE "MatchmakingTicketStatus" AS ENUM ('SEARCHING', 'MATCHED');

ALTER TABLE "Duel" ADD COLUMN "commitmentExpiresAt" TIMESTAMP(3);

CREATE TABLE "MatchmakingTicket" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "role" "MatchmakingTicketRole" NOT NULL,
    "status" "MatchmakingTicketStatus" NOT NULL,
    "queueKey" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "valuationPolicyHash" TEXT NOT NULL,
    "providerMode" "ProviderMode" NOT NULL,
    "regionSegment" TEXT NOT NULL,
    "riskSegment" TEXT NOT NULL,
    "commitmentExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchmakingTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchmakingBehavior" (
    "wallet" TEXT NOT NULL,
    "failedCommitments" INTEGER NOT NULL DEFAULT 0,
    "failureWindowStartedAt" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchmakingBehavior_pkey" PRIMARY KEY ("wallet")
);

CREATE UNIQUE INDEX "MatchmakingTicket_wallet_key" ON "MatchmakingTicket"("wallet");
CREATE UNIQUE INDEX "MatchmakingTicket_duelId_role_key" ON "MatchmakingTicket"("duelId", "role");
CREATE INDEX "MatchmakingTicket_queueKey_status_createdAt_idx" ON "MatchmakingTicket"("queueKey", "status", "createdAt");
CREATE INDEX "MatchmakingTicket_commitmentExpiresAt_status_idx" ON "MatchmakingTicket"("commitmentExpiresAt", "status");
CREATE INDEX "MatchmakingBehavior_blockedUntil_idx" ON "MatchmakingBehavior"("blockedUntil");

ALTER TABLE "MatchmakingTicket" ADD CONSTRAINT "MatchmakingTicket_duelId_fkey"
FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
