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
  'flipsnap_verify',
  'flip-pokemon-50',
  1,
  'openpacksduel.flip-inventory.v1',
  'fixture-policy-v1',
  'fixture-marketplace',
  repeat('a', 64),
  repeat('b', 64),
  '{"allowedCollections":["pokemon-graded"]}'::jsonb,
  '50000000',
  '10000000',
  '100000000',
  5000,
  1,
  10,
  '200000000',
  60000,
  1000,
  1,
  0,
  '45000000',
  '2026-08-03T12:00:00Z'
);

DO $verification$
BEGIN
  BEGIN
    SET CONSTRAINTS "FlipInventorySnapshot_sealed_before_commit" IMMEDIATE;
    RAISE EXCEPTION 'unsealed snapshot bypassed deferred enforcement';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip inventory snapshot must be sealed before commit' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE "FlipInventorySnapshot"
    SET "sealedAt" = '2026-08-03T12:00:01Z'
    WHERE "id" = 'flipsnap_verify';
    RAISE EXCEPTION 'metadata-only snapshot bypassed seal integrity';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip inventory snapshot contents do not match metadata' THEN
        RAISE;
      END IF;
  END;
END
$verification$;

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
) VALUES (
  'flipentry_verify',
  'flipsnap_verify',
  0,
  true,
  ARRAY[]::"FlipInventoryExclusionReason"[],
  'provider_asset_1',
  'provider_listing_1',
  'provider_collection_1',
  'provider_grader_1',
  'pokemon-graded',
  'psa',
  8000,
  '2026-08-03T11:59:30Z',
  '4500',
  'USDC',
  2,
  'provider_listing_value_1',
  '2026-08-03T11:59:30Z',
  '45000000',
  'USDC',
  6,
  '2026-08-03T11:59:30Z'
);

DO $verification$
BEGIN
  BEGIN
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
      "listingValueAmount"
    ) VALUES (
      'flipentry_partial_value',
      'flipsnap_verify',
      1,
      false,
      ARRAY['VALUE_UNAVAILABLE']::"FlipInventoryExclusionReason"[],
      'provider_asset_2',
      'provider_listing_2',
      'provider_collection_1',
      'provider_grader_1',
      'pokemon-graded',
      'psa',
      8000,
      '2026-08-03T11:59:30Z',
      '1'
    );
    RAISE EXCEPTION 'partial listing value bypassed the tuple constraint';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
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
      "inventorySourceTimestamp"
    ) VALUES (
      'flipentry_duplicate_listing',
      'flipsnap_verify',
      1,
      false,
      ARRAY['VALUE_UNAVAILABLE']::"FlipInventoryExclusionReason"[],
      'provider_asset_2',
      'provider_listing_1',
      'provider_collection_1',
      'provider_grader_1',
      'pokemon-graded',
      'psa',
      8000,
      '2026-08-03T11:59:30Z'
    );
    RAISE EXCEPTION 'duplicate listing bypassed the unique constraint';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  UPDATE "FlipInventorySnapshot"
  SET "sealedAt" = '2026-08-03T12:00:02Z'
  WHERE "id" = 'flipsnap_verify';

  BEGIN
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
      "inventorySourceTimestamp"
    ) VALUES (
      'flipentry_after_seal',
      'flipsnap_verify',
      1,
      false,
      ARRAY['VALUE_UNAVAILABLE']::"FlipInventoryExclusionReason"[],
      'provider_asset_after_seal',
      'provider_listing_after_seal',
      'provider_collection_1',
      'provider_grader_1',
      'pokemon-graded',
      'psa',
      8000,
      '2026-08-03T11:59:30Z'
    );
    RAISE EXCEPTION 'entry insert bypassed snapshot sealing';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip inventory snapshot entries are sealed' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE "FlipInventorySnapshot"
    SET "eligibleValueAmount" = '1'
    WHERE "id" = 'flipsnap_verify';
    RAISE EXCEPTION 'snapshot update bypassed append-only enforcement';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip inventory snapshots are append-only' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM "FlipInventorySnapshotEntry"
    WHERE "id" = 'flipentry_verify';
    RAISE EXCEPTION 'entry delete bypassed append-only enforcement';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'Flip inventory snapshots are append-only' THEN
        RAISE;
      END IF;
  END;
END
$verification$;

ROLLBACK;
