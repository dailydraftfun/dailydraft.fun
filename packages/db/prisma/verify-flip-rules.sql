\set ON_ERROR_STOP on

BEGIN;

INSERT INTO "FlipInventorySnapshot" (
  "id",
  "poolKey",
  "revision",
  "schemaVersion",
  "policyVersion",
  "provider",
  "policyHash",
  "contentHash",
  "policy",
  "stakeAmount",
  "minimumValueAmount",
  "maximumValueAmount",
  "minimumLiquidityBasisPoints",
  "minimumEligibleItems",
  "maximumEligibleItems",
  "maximumExposureAmount",
  "maximumSourceAgeMs",
  "maximumFutureSkewMs",
  "eligibleCount",
  "excludedCount",
  "eligibleValueAmount",
  "evaluatedAt"
) VALUES (
  'flipsnap_rules_verify',
  'flip-pokemon-50',
  1,
  'dailydraft.flip-inventory.v1',
  'flip-fixture-policy-v1',
  'fixture-marketplace',
  repeat('a', 64),
  repeat('b', 64),
  '{"allowedCollections":["pokemon-graded"]}'::jsonb,
  '50000000',
  '10000000',
  '100000000',
  5000,
  3,
  10,
  '200000000',
  60000,
  1000,
  3,
  0,
  '110000000',
  '2026-08-03T12:00:00Z'
);

INSERT INTO "FlipInventorySnapshotEntry" (
  "id",
  "snapshotId",
  "ordinal",
  "eligible",
  "exclusionReasons",
  "providerAssetReference",
  "providerListingReference",
  "providerCollectionReference",
  "providerGraderReference",
  "normalizedCollection",
  "normalizedGrader",
  "liquidityBasisPoints",
  "inventorySourceTimestamp",
  "listingValueAmount",
  "listingValueCurrency",
  "listingValueDecimals",
  "listingValueProviderReference",
  "listingValueSourceTimestamp",
  "eligibilityListingValueAmount",
  "eligibilityListingValueCurrency",
  "eligibilityListingValueDecimals",
  "eligibilityListingValueSourceTimestamp"
) VALUES
(
  'flipentry_rules_base',
  'flipsnap_rules_verify',
  0,
  true,
  ARRAY[]::"FlipInventoryExclusionReason"[],
  'asset_base',
  'listing_base',
  'collection_pokemon',
  'grader_psa',
  'pokemon-graded',
  'psa',
  8000,
  '2026-08-03T11:59:30Z',
  '20000000',
  'USDC',
  6,
  'value_base',
  '2026-08-03T11:59:30Z',
  '20000000',
  'USDC',
  6,
  '2026-08-03T11:59:30Z'
),
(
  'flipentry_rules_plus',
  'flipsnap_rules_verify',
  1,
  true,
  ARRAY[]::"FlipInventoryExclusionReason"[],
  'asset_plus',
  'listing_plus',
  'collection_pokemon',
  'grader_psa',
  'pokemon-graded',
  'psa',
  8000,
  '2026-08-03T11:59:30Z',
  '30000000',
  'USDC',
  6,
  'value_plus',
  '2026-08-03T11:59:30Z',
  '30000000',
  'USDC',
  6,
  '2026-08-03T11:59:30Z'
),
(
  'flipentry_rules_chase',
  'flipsnap_rules_verify',
  2,
  true,
  ARRAY[]::"FlipInventoryExclusionReason"[],
  'asset_chase',
  'listing_chase',
  'collection_pokemon',
  'grader_psa',
  'pokemon-graded',
  'psa',
  8000,
  '2026-08-03T11:59:30Z',
  '60000000',
  'USDC',
  6,
  'value_chase',
  '2026-08-03T11:59:30Z',
  '60000000',
  'USDC',
  6,
  '2026-08-03T11:59:30Z'
);

UPDATE "FlipInventorySnapshot"
SET "sealedAt" = '2026-08-03T12:00:30Z'
WHERE "id" = 'flipsnap_rules_verify';

INSERT INTO "FlipRuleSet" (
  "id",
  "rulesKey",
  "version",
  "schemaVersion",
  "calculatorVersion",
  "activation",
  "poolKey",
  "inventoryPolicyVersion",
  "stakeAmount",
  "feeAmount",
  "houseEdgePpm",
  "bands",
  "rulesHash",
  "reviewReference",
  "reviewedAt"
) VALUES (
  'fliprules_verify',
  'flip-pokemon-50-fixture',
  1,
  'dailydraft.flip-rules.v1',
  'dailydraft.flip-outcome-bands.v1',
  'fixture-only',
  'flip-pokemon-50',
  'flip-fixture-policy-v1',
  '50000000',
  '2000000',
  50000,
  '[
    {"label":"base","minimumValueAmount":"0","probabilityPpm":700000},
    {"label":"plus","minimumValueAmount":"25000000","probabilityPpm":250000},
    {"label":"chase","minimumValueAmount":"50000000","probabilityPpm":50000}
  ]'::jsonb,
  repeat('c', 64),
  'fixture-review/flip-rules-v1',
  '2026-08-03T12:01:00Z'
);

DO $verification$
BEGIN
  BEGIN
    SET CONSTRAINTS "FlipRuleSet_sealed_before_commit" IMMEDIATE;
    RAISE EXCEPTION 'unsealed Flip ruleset bypassed deferred enforcement';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip ruleset must be sealed before commit' THEN
        RAISE;
      END IF;
  END;
END
$verification$;

UPDATE "FlipRuleSet"
SET "sealedAt" = '2026-08-03T12:01:30Z'
WHERE "id" = 'fliprules_verify';

DO $verification$
BEGIN
  BEGIN
    UPDATE "FlipRuleSet"
    SET "feeAmount" = '1000000'
    WHERE "id" = 'fliprules_verify';
    RAISE EXCEPTION 'sealed Flip ruleset was mutable';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip rulesets are append-only' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO "FlipSessionPoolCommitment" (
      "id",
      "sessionReference",
      "rulesetId",
      "snapshotId",
      "poolKey",
      "rulesVersion",
      "snapshotRevision",
      "rulesHash",
      "snapshotContentHash",
      "poolCommitmentHash",
      "eligibleOutcomeCount",
      "outcomeSpace",
      "committedAt"
    ) VALUES (
      'flipcommit_invalid_sources',
      'flip_session_invalid_sources',
      'fliprules_verify',
      'flipsnap_rules_verify',
      'flip-pokemon-50',
      1,
      1,
      repeat('d', 64),
      repeat('b', 64),
      repeat('e', 64),
      3,
      '[
        {"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},
        {"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},
        {"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}
      ]'::jsonb,
      '2026-08-03T12:02:00Z'
    );
    RAISE EXCEPTION 'mismatched Flip commitment sources were accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip session pool commitment sources are invalid or unsealed' THEN
        RAISE;
      END IF;
  END;
END
$verification$;

INSERT INTO "FlipSessionPoolCommitment" (
  "id",
  "sessionReference",
  "rulesetId",
  "snapshotId",
  "poolKey",
  "rulesVersion",
  "snapshotRevision",
  "rulesHash",
  "snapshotContentHash",
  "poolCommitmentHash",
  "eligibleOutcomeCount",
  "outcomeSpace",
  "committedAt"
) VALUES (
  'flipcommit_verify',
  'flip_session_verify',
  'fliprules_verify',
  'flipsnap_rules_verify',
  'flip-pokemon-50',
  1,
  1,
  repeat('c', 64),
  repeat('b', 64),
  repeat('e', 64),
  3,
  '[
    {"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},
    {"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},
    {"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}
  ]'::jsonb,
  '2026-08-03T12:02:00Z'
);

DO $verification$
BEGIN
  BEGIN
    SET CONSTRAINTS "FlipSessionPoolCommitment_sealed_before_commit" IMMEDIATE;
    RAISE EXCEPTION 'unsealed Flip session pool commitment bypassed deferred enforcement';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip session pool commitment must be sealed before commit' THEN
        RAISE;
      END IF;
  END;
END
$verification$;

UPDATE "FlipSessionPoolCommitment"
SET "sealedAt" = '2026-08-03T12:02:01Z'
WHERE "id" = 'flipcommit_verify';

DO $verification$
BEGIN
  BEGIN
    UPDATE "FlipSessionPoolCommitment"
    SET "poolCommitmentHash" = repeat('f', 64)
    WHERE "id" = 'flipcommit_verify';
    RAISE EXCEPTION 'sealed Flip session pool commitment was mutable';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip session pool commitments are append-only' THEN
        RAISE;
      END IF;
  END;
END
$verification$;

ROLLBACK;
