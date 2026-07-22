CREATE TABLE "HouseTierAdmissionState" (
    "tier" INTEGER NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "reenableBoundary" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HouseTierAdmissionState_pkey" PRIMARY KEY ("tier")
);

ALTER TABLE "HouseTierAdmissionState"
ADD CONSTRAINT "HouseTierAdmissionState_valid_state_check" CHECK (
  "tier" > 0
  AND "version" > 0
  AND (
    (
      "disabled"
      AND "reason" IS NOT NULL
      AND "reenableBoundary" IS NOT NULL
      AND (
        ("reason" = 'daily_loss' AND "reenableBoundary" = 'next_utc_day_or_reservation_release')
        OR ("reason" = 'delegated_allowance' AND "reenableBoundary" = 'fresh_treasury_snapshot_or_reservation_release')
        OR ("reason" = 'minimum_liquidity' AND "reenableBoundary" = 'fresh_treasury_snapshot_or_reservation_release')
        OR ("reason" = 'tier_concurrency' AND "reenableBoundary" = 'tier_reservation_release')
        OR ("reason" = 'total_exposure' AND "reenableBoundary" = 'reservation_release')
        OR ("reason" = 'treasury_configuration' AND "reenableBoundary" = 'configuration_change')
        OR ("reason" = 'treasury_snapshot_stale' AND "reenableBoundary" = 'fresh_treasury_snapshot')
      )
    )
    OR (
      NOT "disabled"
      AND "reason" IS NULL
      AND "reenableBoundary" IS NULL
    )
  )
);
