BEGIN;

DO $verification$
DECLARE
  observed_slot_default text;
  reservation_default text;
  reservation_statuses text[];
BEGIN
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
  INTO reservation_statuses
  FROM pg_enum
  JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
  WHERE pg_type.typname = 'HouseTreasuryReservationStatus';

  IF reservation_statuses IS DISTINCT FROM ARRAY[
    'RESERVED',
    'FUNDED',
    'SETTLEMENT_PENDING',
    'RECOVERY_REQUIRED',
    'RELEASED',
    'SETTLED'
  ]::text[] THEN
    RAISE EXCEPTION 'unexpected house treasury reservation states: %', reservation_statuses;
  END IF;

  SELECT column_default
  INTO reservation_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'HouseTreasuryReservation'
    AND column_name = 'status';

  IF reservation_default IS NULL OR position('RESERVED' IN reservation_default) = 0 THEN
    RAISE EXCEPTION 'house treasury reservations do not default to RESERVED';
  END IF;

  SELECT column_default
  INTO observed_slot_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'HouseTreasurySnapshot'
    AND column_name = 'observedSlot';

  IF observed_slot_default IS NULL OR position('0' IN observed_slot_default) = 0 THEN
    RAISE EXCEPTION 'house treasury observed slot is not backward-compatible';
  END IF;

  IF to_regclass('"HouseTreasuryReservation_duelId_key"') IS NULL THEN
    RAISE EXCEPTION 'one-reservation-per-duel unique index is missing';
  END IF;

  IF to_regclass('"HouseTreasuryReservation_status_tier_reservedAt_idx"') IS NULL
    OR to_regclass('"HouseTreasuryReservation_playerWallet_status_idx"') IS NULL THEN
    RAISE EXCEPTION 'active exposure indexes are missing';
  END IF;

  IF to_regclass('"HouseTierAdmissionState"') IS NULL THEN
    RAISE EXCEPTION 'house tier admission state is missing';
  END IF;

  IF to_regclass('"HouseInventoryAsset_assetReference_key"') IS NULL THEN
    RAISE EXCEPTION 'canonical house inventory asset uniqueness is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'HouseTreasuryReservation_duelId_fkey'
      AND confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'treasury reservation duel ownership is not delete-restricted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'HouseTreasuryLedgerEntry_append_only'
      AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'append-only treasury ledger trigger is missing or disabled';
  END IF;
END
$verification$;

INSERT INTO "HouseTreasurySnapshot" (
  "id",
  "wallet",
  "tokenAccount",
  "mint",
  "balanceAmount",
  "balanceDecimals",
  "delegate",
  "delegatedAmount",
  "verifiedAt",
  "updatedAt"
) VALUES (
  'treasury_migration_legacy_writer',
  'wallet_treasury_contract',
  'token_account_treasury_contract',
  'mint_treasury_contract',
  '1000000',
  6,
  'delegate_treasury_contract',
  '1000000',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

DO $verification$
BEGIN
  IF (
    SELECT "observedSlot"
    FROM "HouseTreasurySnapshot"
    WHERE "id" = 'treasury_migration_legacy_writer'
  ) <> '0' THEN
    RAISE EXCEPTION 'legacy treasury snapshot write did not receive an observed slot';
  END IF;
END
$verification$;

INSERT INTO "HouseTierAdmissionState" (
  "tier",
  "disabled",
  "reason",
  "reenableBoundary",
  "evaluatedAt",
  "updatedAt"
) VALUES (
  50,
  true,
  'minimum_liquidity',
  'fresh_treasury_snapshot_or_reservation_release',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

DO $verification$
BEGIN
  BEGIN
    INSERT INTO "HouseTierAdmissionState" (
      "tier",
      "disabled",
      "evaluatedAt",
      "updatedAt"
    ) VALUES (
      100,
      true,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'disabled house tier omitted its reason and re-enable boundary';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "HouseTierAdmissionState" (
      "tier",
      "disabled",
      "reason",
      "reenableBoundary",
      "evaluatedAt",
      "updatedAt"
    ) VALUES (
      101,
      true,
      'minimum_liquidity',
      'reservation_release',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'house tier accepted a mismatched reason and re-enable boundary';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$verification$;

INSERT INTO "Duel" (
  "id",
  "mode",
  "status",
  "creatorWallet",
  "opponentWallet",
  "houseOpponent",
  "packId",
  "packName",
  "packProvider",
  "stakeAmount",
  "expiresAt",
  "updatedAt"
) VALUES (
  'duel_treasury_migration_contract',
  'HOUSE',
  'MATCHED',
  'wallet_player_contract',
  'wallet_house_contract',
  true,
  'pack_contract',
  'Migration contract pack',
  'migration-contract',
  '1',
  CURRENT_TIMESTAMP + INTERVAL '1 hour',
  CURRENT_TIMESTAMP
);

INSERT INTO "HouseTreasuryReservation" (
  "id",
  "duelId",
  "playerWallet",
  "tier",
  "amount",
  "currency",
  "decimals",
  "updatedAt"
) VALUES (
  'hres_valid_contract',
  'duel_treasury_migration_contract',
  'wallet_contract',
  1,
  '1',
  'USDC',
  6,
  CURRENT_TIMESTAMP
);

INSERT INTO "DuelPackOutcome" (
  "id",
  "duelId",
  "side",
  "provider",
  "providerReference",
  "assetReference",
  "displayName",
  "insuredValueAmount",
  "insuredValueCurrency",
  "insuredValueDecimals",
  "valuationPolicyHash",
  "resultHash",
  "isMock",
  "openedAt"
) VALUES
(
  'outcome_treasury_inventory_primary',
  'duel_treasury_migration_contract',
  'CREATOR',
  'migration-contract',
  'provider-reference-primary',
  'asset-reference-canonical',
  'Canonical inventory card',
  '42000000',
  'USDC',
  6,
  'valuation-policy-contract',
  'result-hash-primary',
  false,
  CURRENT_TIMESTAMP
),
(
  'outcome_treasury_inventory_duplicate',
  'duel_treasury_migration_contract',
  'OPPONENT',
  'migration-contract',
  'provider-reference-duplicate',
  'asset-reference-canonical',
  'Duplicate inventory card',
  '43000000',
  'USDC',
  6,
  'valuation-policy-contract',
  'result-hash-duplicate',
  false,
  CURRENT_TIMESTAMP
);

INSERT INTO "HouseInventoryAsset" (
  "id",
  "duelId",
  "outcomeId",
  "assetReference",
  "displayName",
  "acquisitionValueAmount",
  "acquisitionValueCurrency",
  "acquisitionValueDecimals",
  "insuredValueAmount",
  "insuredValueCurrency",
  "insuredValueDecimals",
  "custodyWallet",
  "updatedAt"
) VALUES (
  'hinv_valid_contract',
  'duel_treasury_migration_contract',
  'outcome_treasury_inventory_primary',
  'asset-reference-canonical',
  'Canonical inventory card',
  '42000000',
  'USDC',
  6,
  '42000000',
  'USDC',
  6,
  'wallet_house_contract',
  CURRENT_TIMESTAMP
);

DO $verification$
BEGIN
  BEGIN
    INSERT INTO "HouseInventoryAsset" (
      "id",
      "duelId",
      "outcomeId",
      "assetReference",
      "displayName",
      "acquisitionValueAmount",
      "insuredValueAmount",
      "custodyWallet",
      "updatedAt"
    ) VALUES (
      'hinv_duplicate_asset',
      'duel_treasury_migration_contract',
      'outcome_treasury_inventory_duplicate',
      'asset-reference-canonical',
      'Duplicate inventory card',
      '43000000',
      '43000000',
      'wallet_house_contract',
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'duplicate canonical inventory asset bypassed uniqueness';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE "HouseInventoryAsset"
    SET "listingValueAmount" = '44000000'
    WHERE "id" = 'hinv_valid_contract';
    RAISE EXCEPTION 'partial listing valuation bypassed the migration constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE "HouseInventoryAsset"
    SET "buybackExpiresAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'hinv_valid_contract';
    RAISE EXCEPTION 'ineligible buyback metadata bypassed the migration constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE "HouseInventoryAsset"
    SET "insuredValueCurrency" = 'SOL'
    WHERE "id" = 'hinv_valid_contract';
    RAISE EXCEPTION 'invalid insured valuation bypassed the migration constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$verification$;

-- The previous release remains the rollback target during this deployment and
-- completes dispositions without the expanded fee and gain/loss columns.
UPDATE "HouseInventoryAsset"
SET
  "disposedAt" = CURRENT_TIMESTAMP,
  "realizedAmount" = '43000000',
  "realizedCurrency" = 'USDC',
  "realizedDecimals" = 6,
  "status" = 'DISPOSED',
  "version" = "version" + 1
WHERE "id" = 'hinv_valid_contract';

DO $verification$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "HouseInventoryAsset"
    WHERE "id" = 'hinv_valid_contract'
      AND "realizedAmount" = '43000000'
      AND "realizedFeeAmount" IS NULL
      AND "realizedGainLossAmount" IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy disposition write is incompatible with expanded accounting';
  END IF;
END
$verification$;

DELETE FROM "HouseTreasuryReservation"
WHERE "id" = 'hres_valid_contract';

DO $verification$
BEGIN
  BEGIN
    INSERT INTO "HouseTreasuryReservation" (
      "id",
      "duelId",
      "playerWallet",
      "tier",
      "amount",
      "currency",
      "decimals",
      "updatedAt"
    ) VALUES (
      'hres_invalid_amount',
      'duel_treasury_migration_contract',
      'wallet_contract',
      1,
      '-1',
      'USDC',
      6,
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'invalid reservation amount bypassed the migration constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "HouseTreasuryReservation" (
      "id",
      "duelId",
      "playerWallet",
      "tier",
      "amount",
      "currency",
      "decimals",
      "updatedAt"
    ) VALUES (
      'hres_invalid_currency',
      'duel_treasury_migration_contract',
      'wallet_contract',
      1,
      '1',
      'SOL',
      6,
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'invalid reservation currency bypassed the migration constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "HouseTreasuryReservation" (
      "id",
      "duelId",
      "playerWallet",
      "tier",
      "amount",
      "currency",
      "decimals",
      "updatedAt"
    ) VALUES (
      'hres_invalid_decimals',
      'duel_treasury_migration_contract',
      'wallet_contract',
      1,
      '1',
      'USDC',
      9,
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'invalid reservation decimals bypassed the migration constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "HouseTreasuryReservation" (
      "id",
      "duelId",
      "playerWallet",
      "tier",
      "amount",
      "currency",
      "decimals",
      "updatedAt"
    ) VALUES (
      'hres_invalid_tier',
      'duel_treasury_migration_contract',
      'wallet_contract',
      0,
      '1',
      'USDC',
      6,
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'invalid reservation tier bypassed the migration constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO "HouseTreasuryReservation" (
      "id",
      "duelId",
      "playerWallet",
      "tier",
      "amount",
      "currency",
      "decimals",
      "version",
      "updatedAt"
    ) VALUES (
      'hres_invalid_version',
      'duel_treasury_migration_contract',
      'wallet_contract',
      1,
      '1',
      'USDC',
      6,
      0,
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'invalid reservation version bypassed the migration constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$verification$;

INSERT INTO "HouseTreasuryLedgerEntry" (
  "id",
  "idempotencyKey",
  "type",
  "amount",
  "currency",
  "decimals"
) VALUES (
  'hled_append_only_contract',
  'migration-contract:append-only',
  'RESERVATION_CREATED',
  '1',
  'USDC',
  6
);

DO $verification$
BEGIN
  BEGIN
    UPDATE "HouseTreasuryLedgerEntry"
    SET "amount" = '2'
    WHERE "id" = 'hled_append_only_contract';
    RAISE EXCEPTION 'append-only treasury ledger accepted an update';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'HouseTreasuryLedgerEntry is append-only' THEN
        RAISE;
      END IF;
  END;
END
$verification$;

DO $verification$
BEGIN
  BEGIN
    DELETE FROM "HouseTreasuryLedgerEntry"
    WHERE "id" = 'hled_append_only_contract';
    RAISE EXCEPTION 'append-only treasury ledger accepted a delete';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'HouseTreasuryLedgerEntry is append-only' THEN
        RAISE;
      END IF;
  END;
END
$verification$;

ROLLBACK;
