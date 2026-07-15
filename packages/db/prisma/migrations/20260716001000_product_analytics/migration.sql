CREATE TYPE "ProductEventName" AS ENUM ('LOBBY_VIEWED', 'TIER_SELECTED', 'WALLET_CONNECTED', 'WALLET_AUTHENTICATED', 'DUEL_CREATED', 'DUEL_MATCHED', 'DUEL_FUNDED', 'PACK_REVEAL_STARTED', 'PACK_REVEALED', 'DUEL_SHARED', 'DUEL_REMATCHED', 'DUEL_CANCELLED', 'DUEL_REFUNDED', 'DUEL_SETTLED', 'SETTLEMENT_FAILED', 'PROVIDER_ERROR', 'SOLANA_RPC_ERROR', 'UI_ERROR');

CREATE TYPE "ProductEventSource" AS ENUM ('CLIENT', 'SERVER');

CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "name" "ProductEventName" NOT NULL,
    "source" "ProductEventSource" NOT NULL,
    "sessionId" TEXT,
    "duelId" TEXT,
    "status" "DuelStatus",
    "tier" INTEGER,
    "mode" "DuelMode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductEvent_createdAt_name_idx" ON "ProductEvent"("createdAt", "name");
CREATE INDEX "ProductEvent_sessionId_createdAt_idx" ON "ProductEvent"("sessionId", "createdAt");
CREATE INDEX "ProductEvent_duelId_createdAt_idx" ON "ProductEvent"("duelId", "createdAt");
