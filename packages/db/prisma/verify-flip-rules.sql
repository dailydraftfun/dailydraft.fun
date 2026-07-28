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
  "rulesCanonicalPreimage",
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
  $rules${"activation":"fixture-only","bands":[{"label":"base","minimumValueAmount":"0","probabilityPpm":700000},{"label":"plus","minimumValueAmount":"25000000","probabilityPpm":250000},{"label":"chase","minimumValueAmount":"50000000","probabilityPpm":50000}],"calculatorVersion":"dailydraft.flip-outcome-bands.v1","currency":"USDC","decimals":6,"feeAmount":"2000000","houseEdgePpm":50000,"inventoryPolicyVersion":"flip-fixture-policy-v1","poolKey":"flip-pokemon-50","probabilityScalePpm":1000000,"reviewedAt":"2026-08-03T12:01:00.000Z","reviewReference":"fixture-review/flip-rules-v1","rulesKey":"flip-pokemon-50-fixture","schemaVersion":"dailydraft.flip-rules.v1","stakeAmount":"50000000","version":1}$rules$,
  '57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c',
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

CREATE FUNCTION pg_temp.expect_invalid_flip_ruleset(
  candidate_bands JSONB,
  candidate_preimage TEXT,
  candidate_hash TEXT,
  expected_error TEXT
) RETURNS VOID AS $verification$
BEGIN
  BEGIN
    INSERT INTO "FlipRuleSet" (
      "id", "rulesKey", "version", "schemaVersion", "calculatorVersion",
      "activation", "poolKey", "inventoryPolicyVersion", "stakeAmount",
      "feeAmount", "houseEdgePpm", "bands", "rulesCanonicalPreimage",
      "rulesHash", "reviewReference", "reviewedAt"
    ) VALUES (
      'fliprules_invalid',
      'flip-pokemon-50-fixture-invalid',
      2,
      'dailydraft.flip-rules.v1',
      'dailydraft.flip-outcome-bands.v1',
      'fixture-only',
      'flip-pokemon-50',
      'flip-fixture-policy-v1',
      '50000000',
      '2000000',
      50000,
      candidate_bands,
      candidate_preimage,
      candidate_hash,
      'fixture-review/flip-rules-invalid',
      '2026-08-03T12:01:00Z'
    );
    UPDATE "FlipRuleSet"
    SET "sealedAt" = '2026-08-03T12:01:30Z'
    WHERE "id" = 'fliprules_invalid';
    RAISE EXCEPTION 'invalid Flip ruleset was sealed';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> expected_error THEN
        RAISE;
      END IF;
  END;
END;
$verification$ LANGUAGE plpgsql;

SELECT pg_temp.expect_invalid_flip_ruleset(
  '[{"label":"base","minimumValueAmount":"0","probabilityPpm":1000000,"secret":"no"}]'::JSONB,
  '{}',
  repeat('d', 64),
  'Flip ruleset bands are invalid'
);

SELECT pg_temp.expect_invalid_flip_ruleset(
  '[{"label":"base","minimumValueAmount":"1","probabilityPpm":1000000}]'::JSONB,
  '{}',
  repeat('d', 64),
  'Flip ruleset band minimum is invalid'
);

SELECT pg_temp.expect_invalid_flip_ruleset(
  '[
    {"label":"base","minimumValueAmount":"0","probabilityPpm":500000},
    {"label":"base","minimumValueAmount":"1","probabilityPpm":500000}
  ]'::JSONB,
  '{}',
  repeat('d', 64),
  'Flip ruleset band labels are invalid'
);

SELECT pg_temp.expect_invalid_flip_ruleset(
  '[
    {"label":"base","minimumValueAmount":"0","probabilityPpm":500000},
    {"label":"plus","minimumValueAmount":"1","probabilityPpm":499999}
  ]'::JSONB,
  '{}',
  repeat('d', 64),
  'Flip ruleset probabilities must total 1000000 PPM'
);

SELECT pg_temp.expect_invalid_flip_ruleset(
  '[
    {"label":"base","minimumValueAmount":"0","probabilityPpm":500000},
    {"label":"plus","minimumValueAmount":"18446744073709551616","probabilityPpm":500000}
  ]'::JSONB,
  '{}',
  repeat('d', 64),
  'Flip ruleset band minimum is invalid'
);

SELECT pg_temp.expect_invalid_flip_ruleset(
  '[
    {"label":"base","minimumValueAmount":"0","probabilityPpm":700000},
    {"label":"plus","minimumValueAmount":"25000000","probabilityPpm":250000},
    {"label":"chase","minimumValueAmount":"50000000","probabilityPpm":50000}
  ]'::JSONB,
  $rules${"activation":"fixture-only","bands":[{"label":"base","minimumValueAmount":"0","probabilityPpm":700000},{"label":"plus","minimumValueAmount":"25000000","probabilityPpm":250000},{"label":"chase","minimumValueAmount":"50000000","probabilityPpm":50000}],"calculatorVersion":"dailydraft.flip-outcome-bands.v1","currency":"USDC","decimals":6,"feeAmount":"2000000","houseEdgePpm":50000,"inventoryPolicyVersion":"flip-fixture-policy-v1","poolKey":"flip-pokemon-50","probabilityScalePpm":1000000,"reviewedAt":"2026-08-03T12:01:00.000Z","reviewReference":"fixture-review/flip-rules-invalid","rulesKey":"flip-pokemon-50-fixture-invalid","schemaVersion":"dailydraft.flip-rules.v1","serverSeed":"secret","stakeAmount":"50000000","version":2}$rules$,
  repeat('d', 64),
  'Flip ruleset canonical preimage does not match authoritative fields'
);

SELECT pg_temp.expect_invalid_flip_ruleset(
  '[
    {"label":"base","minimumValueAmount":"0","probabilityPpm":700000},
    {"label":"plus","minimumValueAmount":"25000000","probabilityPpm":250000},
    {"label":"chase","minimumValueAmount":"50000000","probabilityPpm":50000}
  ]'::JSONB,
  $rules$ {"activation":"fixture-only","bands":[{"label":"base","minimumValueAmount":"0","probabilityPpm":700000},{"label":"plus","minimumValueAmount":"25000000","probabilityPpm":250000},{"label":"chase","minimumValueAmount":"50000000","probabilityPpm":50000}],"calculatorVersion":"dailydraft.flip-outcome-bands.v1","currency":"USDC","decimals":6,"feeAmount":"2000000","houseEdgePpm":50000,"inventoryPolicyVersion":"flip-fixture-policy-v1","poolKey":"flip-pokemon-50","probabilityScalePpm":1000000,"reviewedAt":"2026-08-03T12:01:00.000Z","reviewReference":"fixture-review/flip-rules-invalid","rulesKey":"flip-pokemon-50-fixture-invalid","schemaVersion":"dailydraft.flip-rules.v1","stakeAmount":"50000000","version":2}$rules$,
  repeat('d', 64),
  'Flip ruleset canonical preimage is not canonical'
);

SELECT pg_temp.expect_invalid_flip_ruleset(
  '[
    {"label":"base","minimumValueAmount":"0","probabilityPpm":700000},
    {"label":"plus","minimumValueAmount":"25000000","probabilityPpm":250000},
    {"label":"chase","minimumValueAmount":"50000000","probabilityPpm":50000}
  ]'::JSONB,
  $rules${"activation":"fixture-only","bands":[{"label":"base","minimumValueAmount":"0","probabilityPpm":700000},{"label":"plus","minimumValueAmount":"25000000","probabilityPpm":250000},{"label":"chase","minimumValueAmount":"50000000","probabilityPpm":50000}],"calculatorVersion":"dailydraft.flip-outcome-bands.v1","currency":"USDC","decimals":6,"feeAmount":"2000000","houseEdgePpm":50000,"inventoryPolicyVersion":"flip-fixture-policy-v1","poolKey":"flip-pokemon-50","probabilityScalePpm":1000000,"reviewedAt":"2026-08-03T12:01:00.000Z","reviewReference":"fixture-review/flip-rules-invalid","rulesKey":"flip-pokemon-50-fixture-invalid","schemaVersion":"dailydraft.flip-rules.v1","stakeAmount":"50000000","version":2}$rules$,
  repeat('d', 64),
  'Flip ruleset hash does not match canonical preimage'
);

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
      "poolCanonicalPreimage",
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
      $pool${"outcomeSpace":[{"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},{"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},{"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}],"rulesHash":"57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c","schemaVersion":"dailydraft.flip-session-pool-commitment.v1","snapshotContentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}$pool$,
      '5b6e3576011f44beefdc0bd41b78521e67f3e921f91c39c778412e2f9321fd9e',
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
  "poolCanonicalPreimage",
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
  '57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c',
  repeat('b', 64),
  $pool${"outcomeSpace":[{"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},{"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},{"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}],"rulesHash":"57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c","schemaVersion":"dailydraft.flip-session-pool-commitment.v1","snapshotContentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}$pool$,
  '5b6e3576011f44beefdc0bd41b78521e67f3e921f91c39c778412e2f9321fd9e',
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

CREATE FUNCTION pg_temp.expect_invalid_flip_commitment(
  candidate_outcome_space JSONB,
  candidate_preimage TEXT,
  candidate_hash TEXT,
  expected_error TEXT
) RETURNS VOID AS $verification$
BEGIN
  BEGIN
    INSERT INTO "FlipSessionPoolCommitment" (
      "id", "sessionReference", "rulesetId", "snapshotId", "poolKey",
      "rulesVersion", "snapshotRevision", "rulesHash", "snapshotContentHash",
      "poolCanonicalPreimage", "poolCommitmentHash", "eligibleOutcomeCount",
      "outcomeSpace", "committedAt"
    ) VALUES (
      'flipcommit_invalid_seal',
      'flip_session_invalid_seal',
      'fliprules_verify',
      'flipsnap_rules_verify',
      'flip-pokemon-50',
      1,
      1,
      '57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c',
      repeat('b', 64),
      candidate_preimage,
      candidate_hash,
      3,
      candidate_outcome_space,
      '2026-08-03T12:02:00Z'
    );
    UPDATE "FlipSessionPoolCommitment"
    SET "sealedAt" = '2026-08-03T12:02:01Z'
    WHERE "id" = 'flipcommit_invalid_seal';
    RAISE EXCEPTION 'invalid Flip session pool commitment was sealed';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> expected_error THEN
        RAISE;
      END IF;
  END;
END;
$verification$ LANGUAGE plpgsql;

SELECT pg_temp.expect_invalid_flip_commitment(
  '[
    {"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base","serverSeed":"secret"},
    {"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},
    {"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}
  ]'::JSONB,
  $pool${"outcomeSpace":[{"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},{"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},{"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}],"rulesHash":"57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c","schemaVersion":"dailydraft.flip-session-pool-commitment.v1","snapshotContentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}$pool$,
  '5b6e3576011f44beefdc0bd41b78521e67f3e921f91c39c778412e2f9321fd9e',
  'Flip session pool outcome space does not match eligible snapshot entries'
);

SELECT pg_temp.expect_invalid_flip_commitment(
  '[
    {"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},
    {"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},
    {"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}
  ]'::JSONB,
  $pool${"outcomeSpace":[{"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},{"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},{"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}],"rulesHash":"57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c","schemaVersion":"dailydraft.flip-session-pool-commitment.v1","serverSeed":"secret","snapshotContentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}$pool$,
  repeat('f', 64),
  'Flip session pool canonical preimage does not match authoritative evidence'
);

SELECT pg_temp.expect_invalid_flip_commitment(
  '[
    {"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},
    {"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},
    {"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}
  ]'::JSONB,
  $pool$ {"outcomeSpace":[{"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},{"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},{"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}],"rulesHash":"57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c","schemaVersion":"dailydraft.flip-session-pool-commitment.v1","snapshotContentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}$pool$,
  repeat('f', 64),
  'Flip session pool canonical preimage is not canonical'
);

SELECT pg_temp.expect_invalid_flip_commitment(
  '[
    {"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},
    {"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},
    {"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}
  ]'::JSONB,
  $pool${"outcomeSpace":[{"bandLabel":"base","listingValueAmount":"20000000","ordinal":0,"providerAssetReference":"asset_base","providerListingReference":"listing_base"},{"bandLabel":"plus","listingValueAmount":"30000000","ordinal":1,"providerAssetReference":"asset_plus","providerListingReference":"listing_plus"},{"bandLabel":"chase","listingValueAmount":"60000000","ordinal":2,"providerAssetReference":"asset_chase","providerListingReference":"listing_chase"}],"rulesHash":"57f27d0fe13e7b22aee0066427330d7934857749c8bb75899db82c521c4bb27c","schemaVersion":"dailydraft.flip-session-pool-commitment.v1","snapshotContentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}$pool$,
  repeat('f', 64),
  'Flip session pool hash does not match canonical preimage'
);

ROLLBACK;
