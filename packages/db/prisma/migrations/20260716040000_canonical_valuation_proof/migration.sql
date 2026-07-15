ALTER TABLE "DuelPackOutcome"
ADD COLUMN "poolVersion" TEXT,
ADD COLUMN "sourceTimestamp" TIMESTAMP(3);

-- Existing devnet-only fixtures predate provider source snapshots. They remain
-- identifiable and cannot satisfy the canonical v1 policy after this backfill.
UPDATE "DuelPackOutcome"
SET
  "poolVersion" = 'legacy-unversioned',
  "sourceTimestamp" = "openedAt"
WHERE "poolVersion" IS NULL OR "sourceTimestamp" IS NULL;

ALTER TABLE "DuelPackOutcome"
ALTER COLUMN "poolVersion" SET NOT NULL,
ALTER COLUMN "sourceTimestamp" SET NOT NULL;
