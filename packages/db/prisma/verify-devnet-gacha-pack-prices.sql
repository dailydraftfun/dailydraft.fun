\set ON_ERROR_STOP on

-- Recreate the populated pre-migration state, then rerun the migration to
-- prove it retires every legacy key and restores its durable deployment guard.
ALTER TABLE "GachaMachine"
  DROP CONSTRAINT IF EXISTS "GachaMachine_retired_devnet_price_inactive";

INSERT INTO "GachaMachine" (
  "id",
  "machineKey",
  "sport",
  "tierPriceMinor",
  "displayName",
  "committedPoolSize",
  "active",
  "createdAt",
  "updatedAt"
)
SELECT
  'verify_devnet_price_' || row_number() OVER (),
  'dailydraft-devnet-' || sport || '-' || price_minor,
  upper(sport)::"GachaSport",
  price_minor,
  'Legacy devnet migration fixture',
  4,
  true,
  now(),
  now()
FROM unnest(ARRAY['football', 'soccer', 'baseball', 'basketball']) AS sport
CROSS JOIN unnest(ARRAY['50000000', '100000000', '250000000']) AS price_minor
ON CONFLICT ("machineKey") DO UPDATE SET "active" = true;

\ir migrations/20260729060000_devnet_gacha_pack_prices/migration.sql

DO $$
DECLARE
  inactive_count integer;
BEGIN
  SELECT count(*)
  INTO inactive_count
  FROM "GachaMachine"
  WHERE "machineKey" LIKE 'dailydraft-devnet-%'
    AND "tierPriceMinor" IN ('50000000', '100000000', '250000000')
    AND "active" = false;

  IF inactive_count <> 12 THEN
    RAISE EXCEPTION 'expected 12 retired devnet Gacha machines, found %', inactive_count;
  END IF;
END
$$;

-- The migration is intentionally safe to replay during verification or manual
-- recovery: the UPDATE is idempotent and the named constraint is added once.
\ir migrations/20260729060000_devnet_gacha_pack_prices/migration.sql

DO $$
BEGIN
  BEGIN
    UPDATE "GachaMachine"
    SET "active" = true
    WHERE "machineKey" = 'dailydraft-devnet-football-50000000';
    RAISE EXCEPTION 'retired devnet Gacha machine was reactivated';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END
$$;

-- Current reduced-price keys must remain eligible for activation.
INSERT INTO "GachaMachine" (
  "id",
  "machineKey",
  "sport",
  "tierPriceMinor",
  "displayName",
  "committedPoolSize",
  "active",
  "createdAt",
  "updatedAt"
)
VALUES (
  'verify_devnet_price_current',
  'dailydraft-devnet-football-10000',
  'FOOTBALL',
  '10000',
  'Current devnet migration fixture',
  4,
  true,
  now(),
  now()
)
ON CONFLICT ("machineKey") DO UPDATE SET "active" = true;

DELETE FROM "GachaMachine"
WHERE "id" LIKE 'verify_devnet_price_%';
