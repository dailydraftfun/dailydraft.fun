CREATE TYPE "DuelProviderOperationStatus" AS ENUM (
    'REQUESTED',
    'GENERATED',
    'OPENING',
    'OPENED',
    'RECOVERY_REQUIRED'
);

CREATE TABLE "DuelProviderOperation" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "side" "DuelSide" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPackId" TEXT NOT NULL,
    "recipientWallet" TEXT NOT NULL,
    "generateIdempotencyKey" TEXT NOT NULL,
    "openIdempotencyKey" TEXT NOT NULL,
    "status" "DuelProviderOperationStatus" NOT NULL DEFAULT 'REQUESTED',
    "providerReference" TEXT,
    "rawPayload" TEXT,
    "payloadHash" TEXT,
    "signature" TEXT,
    "signatureAlgorithm" TEXT,
    "signingKeyReference" TEXT,
    "assetReference" TEXT,
    "resultHash" TEXT,
    "normalizedOutcome" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DuelProviderOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DuelProviderOperation_duelId_side_key"
ON "DuelProviderOperation"("duelId", "side");

CREATE UNIQUE INDEX "DuelProviderOperation_provider_providerReference_key"
ON "DuelProviderOperation"("provider", "providerReference");

CREATE INDEX "DuelProviderOperation_duelId_status_idx"
ON "DuelProviderOperation"("duelId", "status");

ALTER TABLE "DuelProviderOperation"
ADD CONSTRAINT "DuelProviderOperation_duelId_fkey"
FOREIGN KEY ("duelId") REFERENCES "Duel"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DuelProviderOperation"
ADD CONSTRAINT "DuelProviderOperation_identity_check" CHECK (
  char_length("provider") BETWEEN 1 AND 80
  AND char_length("providerPackId") BETWEEN 1 AND 80
  AND char_length("recipientWallet") BETWEEN 1 AND 200
  AND char_length("generateIdempotencyKey") BETWEEN 1 AND 200
  AND char_length("openIdempotencyKey") BETWEEN 1 AND 200
  AND ("providerReference" IS NULL OR char_length("providerReference") BETWEEN 1 AND 200)
  AND (
    ("status" IN ('REQUESTED', 'RECOVERY_REQUIRED'))
    OR
    ("status" IN ('GENERATED', 'OPENING', 'OPENED') AND "providerReference" IS NOT NULL)
  )
  AND (
    (
      "status" = 'RECOVERY_REQUIRED'
      AND "errorCode" IS NOT NULL
      AND char_length("errorCode") BETWEEN 1 AND 120
    )
    OR
    ("status" <> 'RECOVERY_REQUIRED' AND "errorCode" IS NULL)
  )
);

ALTER TABLE "DuelProviderOperation"
ADD CONSTRAINT "DuelProviderOperation_evidence_check" CHECK (
  (
    "status" = 'OPENED'
    AND "rawPayload" IS NOT NULL
    AND octet_length("rawPayload") <= 32768
    AND "payloadHash" IS NOT NULL
    AND "payloadHash" ~ '^[a-f0-9]{64}$'
    AND "signature" IS NOT NULL
    AND "signature" ~ '^[a-f0-9]{64}$'
    AND "signatureAlgorithm" IS NOT NULL
    AND char_length("signatureAlgorithm") BETWEEN 1 AND 128
    AND "signingKeyReference" IS NOT NULL
    AND char_length("signingKeyReference") BETWEEN 1 AND 128
    AND "assetReference" IS NOT NULL
    AND char_length("assetReference") BETWEEN 1 AND 200
    AND "resultHash" IS NOT NULL
    AND "resultHash" ~ '^[a-f0-9]{64}$'
    AND "normalizedOutcome" IS NOT NULL
    AND jsonb_typeof("normalizedOutcome") = 'object'
    AND "errorCode" IS NULL
  )
  OR
  (
    "status" <> 'OPENED'
    AND "rawPayload" IS NULL
    AND "payloadHash" IS NULL
    AND "signature" IS NULL
    AND "signatureAlgorithm" IS NULL
    AND "signingKeyReference" IS NULL
    AND "assetReference" IS NULL
    AND "resultHash" IS NULL
    AND "normalizedOutcome" IS NULL
  )
);

CREATE FUNCTION "protect_duel_provider_operation_evidence"() RETURNS trigger AS $$
BEGIN
  IF NEW."duelId" IS DISTINCT FROM OLD."duelId"
    OR NEW."side" IS DISTINCT FROM OLD."side"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."providerPackId" IS DISTINCT FROM OLD."providerPackId"
    OR NEW."recipientWallet" IS DISTINCT FROM OLD."recipientWallet"
    OR NEW."generateIdempotencyKey" IS DISTINCT FROM OLD."generateIdempotencyKey"
    OR NEW."openIdempotencyKey" IS DISTINCT FROM OLD."openIdempotencyKey"
  THEN
    RAISE EXCEPTION 'Duel provider operation identity is immutable';
  END IF;

  IF OLD."providerReference" IS NOT NULL
    AND NEW."providerReference" IS DISTINCT FROM OLD."providerReference"
  THEN
    RAISE EXCEPTION 'Duel provider reference is immutable';
  END IF;

  IF OLD."status" = 'OPENED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Opened duel provider evidence is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DuelProviderOperation_immutable_evidence"
BEFORE UPDATE ON "DuelProviderOperation"
FOR EACH ROW EXECUTE FUNCTION "protect_duel_provider_operation_evidence"();
