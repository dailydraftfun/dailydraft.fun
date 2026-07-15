ALTER TABLE "DuelPackOutcome"
ADD COLUMN "poolVersion" TEXT,
ADD COLUMN "sourceTimestamp" TIMESTAMP(3);

-- Existing outcomes remain null because their pool snapshot and provider source
-- time cannot be reconstructed. Reads degrade their proof to unavailable and
-- all settlement paths continue to reject incomplete evidence.
