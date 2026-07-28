-- Retire the original 50/100/250 USDC DailyDraft devnet machines. Their
-- immutable snapshots and completed rip evidence remain available, and
-- unresolved payments can still resume through their existing intent. New
-- payment intents fail closed because these machine rows are inactive.
--
-- The API bootstraps the replacement 0.01/0.10/1.00 USDC machine grid from
-- the versioned devnet provider after migrations complete. Collector Crypt,
-- fixture, duel, and production/mainnet economics are untouched.
UPDATE "GachaMachine"
SET "active" = false
WHERE "machineKey" IN (
  'dailydraft-devnet-football-50000000',
  'dailydraft-devnet-football-100000000',
  'dailydraft-devnet-football-250000000',
  'dailydraft-devnet-soccer-50000000',
  'dailydraft-devnet-soccer-100000000',
  'dailydraft-devnet-soccer-250000000',
  'dailydraft-devnet-baseball-50000000',
  'dailydraft-devnet-baseball-100000000',
  'dailydraft-devnet-baseball-250000000',
  'dailydraft-devnet-basketball-50000000',
  'dailydraft-devnet-basketball-100000000',
  'dailydraft-devnet-basketball-250000000'
);

-- Migrations run before the blue/green deploy stops the previous API. The old
-- provider may retry its bootstrap in that window, so the database must reject
-- any attempt to reactivate a retired key instead of relying on process order.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GachaMachine_retired_devnet_price_inactive'
      AND conrelid = '"GachaMachine"'::regclass
  ) THEN
    ALTER TABLE "GachaMachine"
      ADD CONSTRAINT "GachaMachine_retired_devnet_price_inactive"
      CHECK (
        NOT (
          "active"
          AND "machineKey" IN (
            'dailydraft-devnet-football-50000000',
            'dailydraft-devnet-football-100000000',
            'dailydraft-devnet-football-250000000',
            'dailydraft-devnet-soccer-50000000',
            'dailydraft-devnet-soccer-100000000',
            'dailydraft-devnet-soccer-250000000',
            'dailydraft-devnet-baseball-50000000',
            'dailydraft-devnet-baseball-100000000',
            'dailydraft-devnet-baseball-250000000',
            'dailydraft-devnet-basketball-50000000',
            'dailydraft-devnet-basketball-100000000',
            'dailydraft-devnet-basketball-250000000'
          )
        )
      );
  END IF;
END
$$;
