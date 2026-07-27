ALTER TABLE "GachaRipSeedCommitment"
ADD COLUMN "configHash" TEXT,
ADD COLUMN "rulesHash" TEXT,
ADD COLUMN "rgsCommitmentHash" TEXT,
ADD COLUMN "clientSeed" TEXT;

ALTER TABLE "Duel"
ADD COLUMN "rgsCommitmentHash" TEXT,
ADD COLUMN "rgsConfigHash" TEXT,
ADD COLUMN "rgsRulesHash" TEXT;

ALTER TABLE "GachaRipSeedCommitment"
ADD CONSTRAINT "GachaRipSeedCommitment_rgs_contract_check" CHECK (
  (
    "configHash" IS NULL
    AND "rulesHash" IS NULL
    AND "rgsCommitmentHash" IS NULL
  )
  OR
  (
    "configHash" ~ '^[a-f0-9]{64}$'
    AND "rulesHash" ~ '^[a-f0-9]{64}$'
    AND "rgsCommitmentHash" ~ '^[a-f0-9]{64}$'
  )
);

ALTER TABLE "GachaRipSeedCommitment"
ADD CONSTRAINT "GachaRipSeedCommitment_client_seed_check" CHECK (
  "rgsCommitmentHash" IS NULL
  OR ("consumedByRipId" IS NULL AND "clientSeed" IS NULL)
  OR ("consumedByRipId" IS NOT NULL AND length("clientSeed") BETWEEN 1 AND 240)
);

ALTER TABLE "Duel"
ADD CONSTRAINT "Duel_rgs_contract_check" CHECK (
  (
    "rgsCommitmentHash" IS NULL
    AND "rgsConfigHash" IS NULL
    AND "rgsRulesHash" IS NULL
  )
  OR
  (
    "rgsCommitmentHash" ~ '^[a-f0-9]{64}$'
    AND "rgsConfigHash" ~ '^[a-f0-9]{64}$'
    AND "rgsRulesHash" ~ '^[a-f0-9]{64}$'
  )
);
