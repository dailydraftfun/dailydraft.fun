CREATE TYPE "DuelMode" AS ENUM ('DIRECT', 'OPEN', 'HOUSE');
CREATE TYPE "DuelStatus" AS ENUM ('WAITING', 'MATCHED', 'COMMITTING', 'FUNDED', 'OPENING', 'AWAITING_ASSETS', 'SETTLING', 'SETTLED', 'CANCELLING', 'CANCELLED', 'REFUNDING', 'REFUNDED', 'FAILED');
CREATE TYPE "SolanaNetwork" AS ENUM ('DEVNET');
CREATE TYPE "ProviderMode" AS ENUM ('MOCK', 'COLLECTOR_CRYPT_SANDBOX');
CREATE TYPE "DuelTransactionAction" AS ENUM ('FUND', 'CANCEL', 'REFUND', 'OPEN_PACK', 'SETTLE');
CREATE TYPE "DuelTransactionStatus" AS ENUM ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'EXPIRED');

CREATE TABLE "Duel" (
  "id" TEXT NOT NULL,
  "mode" "DuelMode" NOT NULL,
  "status" "DuelStatus" NOT NULL,
  "network" "SolanaNetwork" NOT NULL DEFAULT 'DEVNET',
  "providerMode" "ProviderMode" NOT NULL DEFAULT 'MOCK',
  "creatorWallet" TEXT NOT NULL,
  "opponentWallet" TEXT,
  "opponentJoinedAt" TIMESTAMP(3),
  "houseOpponent" BOOLEAN NOT NULL DEFAULT false,
  "winnerWallet" TEXT,
  "escrowAddress" TEXT,
  "packId" TEXT NOT NULL,
  "packName" TEXT NOT NULL,
  "packProvider" TEXT NOT NULL,
  "providerPackId" TEXT,
  "stakeAmount" TEXT NOT NULL,
  "stakeCurrency" TEXT NOT NULL DEFAULT 'USDC',
  "stakeDecimals" INTEGER NOT NULL DEFAULT 6,
  "valuationPolicyHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "cancellationReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "matchedAt" TIMESTAMP(3),
  "fundedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "Duel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DuelEvent" (
  "id" TEXT NOT NULL,
  "duelId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "actorWallet" TEXT,
  "fromStatus" "DuelStatus",
  "toStatus" "DuelStatus",
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DuelEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DuelTransaction" (
  "id" TEXT NOT NULL,
  "duelId" TEXT NOT NULL,
  "action" "DuelTransactionAction" NOT NULL,
  "status" "DuelTransactionStatus" NOT NULL DEFAULT 'PREPARED',
  "network" "SolanaNetwork" NOT NULL DEFAULT 'DEVNET',
  "wallet" TEXT NOT NULL,
  "signature" TEXT,
  "idempotencyKey" TEXT,
  "serializedTransaction" TEXT,
  "recentBlockhash" TEXT,
  "lastValidBlockHeight" BIGINT,
  "providerReference" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "metadata" JSONB,
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DuelTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Duel_status_expiresAt_idx" ON "Duel"("status", "expiresAt");
CREATE INDEX "Duel_mode_status_packId_createdAt_idx" ON "Duel"("mode", "status", "packId", "createdAt");
CREATE INDEX "Duel_creatorWallet_createdAt_idx" ON "Duel"("creatorWallet", "createdAt");
CREATE INDEX "Duel_opponentWallet_createdAt_idx" ON "Duel"("opponentWallet", "createdAt");
CREATE INDEX "Duel_winnerWallet_createdAt_idx" ON "Duel"("winnerWallet", "createdAt");
CREATE UNIQUE INDEX "DuelEvent_duelId_sequence_key" ON "DuelEvent"("duelId", "sequence");
CREATE INDEX "DuelEvent_duelId_createdAt_idx" ON "DuelEvent"("duelId", "createdAt");
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE UNIQUE INDEX "DuelTransaction_signature_key" ON "DuelTransaction"("signature");
CREATE UNIQUE INDEX "DuelTransaction_idempotencyKey_key" ON "DuelTransaction"("idempotencyKey");
CREATE INDEX "DuelTransaction_duelId_createdAt_idx" ON "DuelTransaction"("duelId", "createdAt");
CREATE INDEX "DuelTransaction_status_updatedAt_idx" ON "DuelTransaction"("status", "updatedAt");

ALTER TABLE "DuelEvent" ADD CONSTRAINT "DuelEvent_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuelTransaction" ADD CONSTRAINT "DuelTransaction_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
