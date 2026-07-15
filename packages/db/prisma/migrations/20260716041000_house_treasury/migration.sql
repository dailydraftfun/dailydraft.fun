CREATE TYPE "HouseTreasuryReservationStatus" AS ENUM ('RESERVED', 'FUNDED', 'SETTLEMENT_PENDING', 'RECOVERY_REQUIRED', 'RELEASED', 'SETTLED');
CREATE TYPE "HouseTreasuryLedgerType" AS ENUM ('RESERVATION_CREATED', 'RESERVATION_RELEASED', 'HOUSE_FUNDING_COMMITTED', 'PLAYER_WIN_LOSS', 'HOUSE_PACK_COST', 'HOUSE_WIN_INVENTORY', 'INVENTORY_DISPOSITION_SET', 'INVENTORY_DISPOSED', 'RECONCILIATION_ALERT');
CREATE TYPE "HouseInventoryDisposition" AS ENUM ('HOLD', 'BUYBACK', 'LIST', 'PROMOTION', 'MANUAL_REVIEW');
CREATE TYPE "HouseInventoryStatus" AS ENUM ('HELD', 'LISTED', 'DISPOSED', 'RECONCILIATION_REQUIRED');
CREATE TYPE "HouseInventoryListingState" AS ENUM ('UNLISTED', 'LISTED', 'SOLD', 'DELISTED');

CREATE TABLE "HouseTreasurySnapshot" (
    "id" TEXT NOT NULL,
    "network" "SolanaNetwork" NOT NULL DEFAULT 'DEVNET',
    "wallet" TEXT NOT NULL,
    "tokenAccount" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "balanceAmount" TEXT NOT NULL,
    "balanceDecimals" INTEGER NOT NULL,
    "delegate" TEXT NOT NULL,
    "delegatedAmount" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HouseTreasurySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HouseTreasuryReservation" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "playerWallet" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "decimals" INTEGER NOT NULL DEFAULT 6,
    "status" "HouseTreasuryReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HouseTreasuryReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HouseInventoryAsset" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "assetReference" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "acquisitionValueAmount" TEXT NOT NULL,
    "acquisitionValueCurrency" TEXT NOT NULL DEFAULT 'USDC',
    "acquisitionValueDecimals" INTEGER NOT NULL DEFAULT 6,
    "buybackEligible" BOOLEAN NOT NULL DEFAULT false,
    "buybackExpiresAt" TIMESTAMP(3),
    "listingState" "HouseInventoryListingState" NOT NULL DEFAULT 'UNLISTED',
    "custodyWallet" TEXT NOT NULL,
    "disposition" "HouseInventoryDisposition" NOT NULL DEFAULT 'MANUAL_REVIEW',
    "status" "HouseInventoryStatus" NOT NULL DEFAULT 'HELD',
    "realizedAmount" TEXT,
    "realizedCurrency" TEXT,
    "realizedDecimals" INTEGER,
    "disposedAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "reconciliationError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HouseInventoryAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HouseTreasuryLedgerEntry" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "duelId" TEXT,
    "reservationId" TEXT,
    "inventoryId" TEXT,
    "type" "HouseTreasuryLedgerType" NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "decimals" INTEGER NOT NULL DEFAULT 6,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HouseTreasuryLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HouseTreasuryReservation_duelId_key" ON "HouseTreasuryReservation"("duelId");
CREATE UNIQUE INDEX "HouseTreasurySnapshot_network_wallet_mint_tokenAccount_key" ON "HouseTreasurySnapshot"("network", "wallet", "mint", "tokenAccount");
CREATE INDEX "HouseTreasuryReservation_status_tier_reservedAt_idx" ON "HouseTreasuryReservation"("status", "tier", "reservedAt");
CREATE INDEX "HouseTreasuryReservation_status_lastReconciledAt_id_idx" ON "HouseTreasuryReservation"("status", "lastReconciledAt", "id");
CREATE INDEX "HouseTreasuryReservation_playerWallet_status_idx" ON "HouseTreasuryReservation"("playerWallet", "status");
CREATE UNIQUE INDEX "HouseInventoryAsset_outcomeId_key" ON "HouseInventoryAsset"("outcomeId");
CREATE INDEX "HouseInventoryAsset_status_disposition_createdAt_idx" ON "HouseInventoryAsset"("status", "disposition", "createdAt");
CREATE INDEX "HouseInventoryAsset_duelId_createdAt_idx" ON "HouseInventoryAsset"("duelId", "createdAt");
CREATE INDEX "HouseInventoryAsset_assetReference_idx" ON "HouseInventoryAsset"("assetReference");
CREATE INDEX "HouseInventoryAsset_custodyWallet_status_idx" ON "HouseInventoryAsset"("custodyWallet", "status");
CREATE UNIQUE INDEX "HouseTreasuryLedgerEntry_idempotencyKey_key" ON "HouseTreasuryLedgerEntry"("idempotencyKey");
CREATE INDEX "HouseTreasuryLedgerEntry_createdAt_type_idx" ON "HouseTreasuryLedgerEntry"("createdAt", "type");
CREATE INDEX "HouseTreasuryLedgerEntry_duelId_createdAt_idx" ON "HouseTreasuryLedgerEntry"("duelId", "createdAt");
CREATE INDEX "HouseTreasuryLedgerEntry_inventoryId_createdAt_idx" ON "HouseTreasuryLedgerEntry"("inventoryId", "createdAt");

ALTER TABLE "HouseTreasuryReservation" ADD CONSTRAINT "HouseTreasuryReservation_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseInventoryAsset" ADD CONSTRAINT "HouseInventoryAsset_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseInventoryAsset" ADD CONSTRAINT "HouseInventoryAsset_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "DuelPackOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseTreasuryLedgerEntry" ADD CONSTRAINT "HouseTreasuryLedgerEntry_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseTreasuryLedgerEntry" ADD CONSTRAINT "HouseTreasuryLedgerEntry_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "HouseTreasuryReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseTreasuryLedgerEntry" ADD CONSTRAINT "HouseTreasuryLedgerEntry_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "HouseInventoryAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HouseTreasurySnapshot" ADD CONSTRAINT "HouseTreasurySnapshot_balance_check" CHECK ("balanceAmount" ~ '^[0-9]+$' AND "delegatedAmount" ~ '^[0-9]+$' AND "balanceDecimals" = 6);
ALTER TABLE "HouseTreasuryReservation" ADD CONSTRAINT "HouseTreasuryReservation_amount_check" CHECK ("amount" ~ '^[0-9]+$' AND "currency" = 'USDC' AND "decimals" = 6 AND "tier" > 0 AND "version" > 0);
ALTER TABLE "HouseInventoryAsset" ADD CONSTRAINT "HouseInventoryAsset_acquisition_value_check" CHECK ("acquisitionValueAmount" ~ '^[0-9]+$' AND "acquisitionValueCurrency" = 'USDC' AND "acquisitionValueDecimals" = 6 AND "version" > 0);
ALTER TABLE "HouseInventoryAsset" ADD CONSTRAINT "HouseInventoryAsset_realized_value_check" CHECK (("realizedAmount" IS NULL AND "realizedCurrency" IS NULL AND "realizedDecimals" IS NULL) OR ("realizedAmount" ~ '^[0-9]+$' AND "realizedCurrency" = 'USDC' AND "realizedDecimals" = 6));
ALTER TABLE "HouseTreasuryLedgerEntry" ADD CONSTRAINT "HouseTreasuryLedgerEntry_amount_check" CHECK ("amount" ~ '^[0-9]+$' AND "currency" = 'USDC' AND "decimals" = 6);

CREATE FUNCTION "reject_house_treasury_ledger_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'HouseTreasuryLedgerEntry is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HouseTreasuryLedgerEntry_append_only"
BEFORE UPDATE OR DELETE ON "HouseTreasuryLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "reject_house_treasury_ledger_mutation"();
