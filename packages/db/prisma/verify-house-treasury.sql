BEGIN;

DO $verification$
DECLARE
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

  IF to_regclass('"HouseTreasuryReservation_duelId_key"') IS NULL THEN
    RAISE EXCEPTION 'one-reservation-per-duel unique index is missing';
  END IF;

  IF to_regclass('"HouseTreasuryReservation_status_tier_reservedAt_idx"') IS NULL
    OR to_regclass('"HouseTreasuryReservation_playerWallet_status_idx"') IS NULL THEN
    RAISE EXCEPTION 'active exposure indexes are missing';
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
