CREATE TABLE "WalletAuthChallenge" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletAuthChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WalletSession" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalletAuthChallenge_nonceHash_key" ON "WalletAuthChallenge"("nonceHash");
CREATE INDEX "WalletAuthChallenge_wallet_expiresAt_idx" ON "WalletAuthChallenge"("wallet", "expiresAt");
CREATE INDEX "WalletAuthChallenge_expiresAt_consumedAt_idx" ON "WalletAuthChallenge"("expiresAt", "consumedAt");
CREATE UNIQUE INDEX "WalletSession_tokenHash_key" ON "WalletSession"("tokenHash");
CREATE INDEX "WalletSession_wallet_expiresAt_idx" ON "WalletSession"("wallet", "expiresAt");
CREATE INDEX "WalletSession_expiresAt_revokedAt_idx" ON "WalletSession"("expiresAt", "revokedAt");
