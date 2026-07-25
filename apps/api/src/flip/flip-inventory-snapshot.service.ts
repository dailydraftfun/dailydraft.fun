import { createHash, randomUUID } from 'node:crypto';
import { type DatabaseClient, FlipInventoryExclusionReason, type Prisma } from '@dailydraft/db';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import { stableStringify } from '../providers/valuation-policy.js';

export const FLIP_INVENTORY_SCHEMA_VERSION = 'dailydraft.flip-inventory.v1';

const FLIP_INVENTORY_LOCK_NAMESPACE = 1_584_503_769;
const MAX_CANDIDATES = 500;
const MAX_REFERENCE_LENGTH = 240;
const MAX_POLICY_KEYS = 100;
const NORMALIZED_DECIMALS = 6;
const NORMALIZED_CURRENCY = 'USDC';

export interface FlipInventoryMoney {
  amount: string;
  currency: string;
  decimals: number;
  providerReference: string;
  sourceTimestamp: Date;
}

export interface FlipInventoryCandidate {
  buybackValue?: FlipInventoryMoney | null;
  displayedValue?: FlipInventoryMoney | null;
  insuredValue?: FlipInventoryMoney | null;
  inventorySourceTimestamp: Date;
  liquidityBasisPoints: number;
  listingValue?: FlipInventoryMoney | null;
  normalizedCollection: string;
  normalizedGrader: string;
  providerAssetReference: string;
  providerCollectionReference: string;
  providerGraderReference: string;
  providerListingReference: string;
}

export interface FlipInventorySnapshotPolicy {
  allowedCollections: readonly string[];
  allowedGraders: readonly string[];
  excludedProviderAssetReferences: readonly string[];
  excludedProviderListingReferences: readonly string[];
  maximumEligibleItems: number;
  maximumExposure: Pick<FlipInventoryMoney, 'amount' | 'currency' | 'decimals'>;
  maximumFutureSkewMs: number;
  maximumListingValue: Pick<FlipInventoryMoney, 'amount' | 'currency' | 'decimals'>;
  maximumSourceAgeMs: number;
  minimumEligibleItems: number;
  minimumLiquidityBasisPoints: number;
  minimumListingValue: Pick<FlipInventoryMoney, 'amount' | 'currency' | 'decimals'>;
  policyVersion: string;
  poolKey: string;
  provider: string;
  stake: Pick<FlipInventoryMoney, 'amount' | 'currency' | 'decimals'>;
}

export interface PrepareFlipInventorySnapshotInput {
  candidates: readonly FlipInventoryCandidate[];
  evaluatedAt: Date;
  policy: FlipInventorySnapshotPolicy;
}

interface CanonicalMoney {
  amount: string;
  currency: 'USDC';
  decimals: number;
  normalizedAmount: string;
  providerReference: string;
  sourceTimestamp: Date;
}

interface PreparedEntry {
  buybackValue: CanonicalMoney | null;
  displayedValue: CanonicalMoney | null;
  eligibilityListingValueAmount: string | null;
  eligibilityListingValueCurrency: 'USDC' | null;
  eligibilityListingValueDecimals: 6 | null;
  eligibilityListingValueSourceTimestamp: Date | null;
  eligible: boolean;
  exclusionReasons: FlipInventoryExclusionReason[];
  insuredValue: CanonicalMoney | null;
  inventorySourceTimestamp: Date;
  liquidityBasisPoints: number;
  listingValue: CanonicalMoney | null;
  normalizedCollection: string;
  normalizedGrader: string;
  ordinal: number;
  providerAssetReference: string;
  providerCollectionReference: string;
  providerGraderReference: string;
  providerListingReference: string;
}

interface CanonicalPolicy {
  allowedCollections: string[];
  allowedGraders: string[];
  excludedProviderAssetReferences: string[];
  excludedProviderListingReferences: string[];
  maximumEligibleItems: number;
  maximumExposureAmount: string;
  maximumFutureSkewMs: number;
  maximumListingValueAmount: string;
  maximumSourceAgeMs: number;
  minimumEligibleItems: number;
  minimumLiquidityBasisPoints: number;
  minimumListingValueAmount: string;
  policyVersion: string;
  poolKey: string;
  provider: string;
  stakeAmount: string;
}

export interface PreparedFlipInventorySnapshot {
  contentHash: string;
  eligibleCount: number;
  eligibleValueAmount: string;
  entries: PreparedEntry[];
  evaluatedAt: Date;
  excludedCount: number;
  policy: CanonicalPolicy;
  policyHash: string;
}

@Injectable()
export class FlipInventorySnapshotService {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  async createFixtureSnapshot(input: PrepareFlipInventorySnapshotInput): Promise<{
    contentHash: string;
    created: boolean;
    id: string;
    poolKey: string;
    revision: number;
  }> {
    if (!flipInventoryFixtureModeEnabled()) {
      throw new ServiceUnavailableException(
        'Flip inventory snapshots are disabled outside explicit fixture or preview mode',
      );
    }
    const prepared = prepareFlipInventorySnapshot(input);
    return this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${prepared.policy.poolKey}, ${FLIP_INVENTORY_LOCK_NAMESPACE})
        )
      `;
      const existing = await transaction.flipInventorySnapshot.findUnique({
        select: { contentHash: true, id: true, poolKey: true, revision: true, sealedAt: true },
        where: {
          poolKey_contentHash: {
            contentHash: prepared.contentHash,
            poolKey: prepared.policy.poolKey,
          },
        },
      });
      if (existing) {
        if (!existing.sealedAt) {
          throw new ServiceUnavailableException('Flip inventory snapshot is not sealed');
        }
        return {
          contentHash: existing.contentHash,
          created: false,
          id: existing.id,
          poolKey: existing.poolKey,
          revision: existing.revision,
        };
      }

      const latest = await transaction.flipInventorySnapshot.findFirst({
        orderBy: { revision: 'desc' },
        select: { revision: true },
        where: { poolKey: prepared.policy.poolKey },
      });
      const id = createId('flipsnap');
      const revision = (latest?.revision ?? 0) + 1;
      await transaction.flipInventorySnapshot.create({
        data: {
          contentHash: prepared.contentHash,
          createdAt: new Date(),
          eligibleCount: prepared.eligibleCount,
          eligibleValueAmount: prepared.eligibleValueAmount,
          evaluatedAt: prepared.evaluatedAt,
          excludedCount: prepared.excludedCount,
          id,
          maximumEligibleItems: prepared.policy.maximumEligibleItems,
          maximumExposureAmount: prepared.policy.maximumExposureAmount,
          maximumFutureSkewMs: prepared.policy.maximumFutureSkewMs,
          maximumSourceAgeMs: prepared.policy.maximumSourceAgeMs,
          maximumValueAmount: prepared.policy.maximumListingValueAmount,
          minimumEligibleItems: prepared.policy.minimumEligibleItems,
          minimumLiquidityBasisPoints: prepared.policy.minimumLiquidityBasisPoints,
          minimumValueAmount: prepared.policy.minimumListingValueAmount,
          policy: prepared.policy as unknown as Prisma.InputJsonValue,
          policyHash: prepared.policyHash,
          policyVersion: prepared.policy.policyVersion,
          poolKey: prepared.policy.poolKey,
          provider: prepared.policy.provider,
          revision,
          schemaVersion: FLIP_INVENTORY_SCHEMA_VERSION,
          stakeAmount: prepared.policy.stakeAmount,
          stakeCurrency: NORMALIZED_CURRENCY,
          stakeDecimals: NORMALIZED_DECIMALS,
        },
      });
      await transaction.flipInventorySnapshotEntry.createMany({
        data: prepared.entries.map((entry) => entryCreateInput(id, entry)),
      });
      const sealed = await transaction.flipInventorySnapshot.updateMany({
        data: { sealedAt: new Date() },
        where: { id, sealedAt: null },
      });
      if (sealed.count !== 1) {
        throw new ServiceUnavailableException('Flip inventory snapshot could not be sealed');
      }
      return {
        contentHash: prepared.contentHash,
        created: true,
        id,
        poolKey: prepared.policy.poolKey,
        revision,
      };
    });
  }
}

export function prepareFlipInventorySnapshot(
  input: PrepareFlipInventorySnapshotInput,
): PreparedFlipInventorySnapshot {
  const evaluatedAt = requireDate(input.evaluatedAt, 'evaluatedAt');
  const policy = canonicalPolicy(input.policy);
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new ConflictException('Flip inventory snapshot requires provider candidates');
  }
  if (input.candidates.length > MAX_CANDIDATES) {
    throw new ConflictException(`Flip inventory snapshot exceeds ${MAX_CANDIDATES} candidates`);
  }

  const assets = new Set<string>();
  const listings = new Set<string>();
  const candidates = input.candidates.map((candidate) => {
    const prepared = canonicalCandidate(candidate);
    if (assets.has(prepared.providerAssetReference)) {
      throw new ConflictException('Flip inventory contains a duplicate provider asset reference');
    }
    if (listings.has(prepared.providerListingReference)) {
      throw new ConflictException('Flip inventory contains a duplicate provider listing reference');
    }
    assets.add(prepared.providerAssetReference);
    listings.add(prepared.providerListingReference);
    return prepared;
  });
  candidates.sort((left, right) =>
    compareCanonical(left.providerListingReference, right.providerListingReference),
  );

  const allowedCollections = new Set(policy.allowedCollections);
  const allowedGraders = new Set(policy.allowedGraders);
  const excludedAssets = new Set(policy.excludedProviderAssetReferences);
  const excludedListings = new Set(policy.excludedProviderListingReferences);
  let eligibleCount = 0;
  let eligibleValue = 0n;
  const entries = candidates.map((candidate, ordinal): PreparedEntry => {
    const reasons: FlipInventoryExclusionReason[] = [];
    if (
      excludedAssets.has(candidate.providerAssetReference) ||
      excludedListings.has(candidate.providerListingReference)
    ) {
      reasons.push(FlipInventoryExclusionReason.EXPLICIT_EXCLUSION);
    }
    if (!allowedCollections.has(candidate.normalizedCollection)) {
      reasons.push(FlipInventoryExclusionReason.COLLECTION_NOT_ALLOWED);
    }
    if (!allowedGraders.has(candidate.normalizedGrader)) {
      reasons.push(FlipInventoryExclusionReason.GRADER_NOT_ALLOWED);
    }
    addFreshnessReason(
      reasons,
      candidate.inventorySourceTimestamp,
      evaluatedAt,
      policy,
      FlipInventoryExclusionReason.INVENTORY_STALE,
      FlipInventoryExclusionReason.INVENTORY_FROM_FUTURE,
    );
    if (candidate.liquidityBasisPoints < policy.minimumLiquidityBasisPoints) {
      reasons.push(FlipInventoryExclusionReason.LIQUIDITY_BELOW_MINIMUM);
    }
    if (!candidate.listingValue) {
      reasons.push(FlipInventoryExclusionReason.VALUE_UNAVAILABLE);
    } else {
      addFreshnessReason(
        reasons,
        candidate.listingValue.sourceTimestamp,
        evaluatedAt,
        policy,
        FlipInventoryExclusionReason.VALUE_STALE,
        FlipInventoryExclusionReason.VALUE_FROM_FUTURE,
      );
      const amount = BigInt(candidate.listingValue.normalizedAmount);
      if (amount < BigInt(policy.minimumListingValueAmount)) {
        reasons.push(FlipInventoryExclusionReason.VALUE_BELOW_MINIMUM);
      }
      if (amount > BigInt(policy.maximumListingValueAmount)) {
        reasons.push(FlipInventoryExclusionReason.VALUE_ABOVE_MAXIMUM);
      }
    }

    const listingAmount = candidate.listingValue
      ? BigInt(candidate.listingValue.normalizedAmount)
      : null;
    if (reasons.length === 0 && eligibleCount >= policy.maximumEligibleItems) {
      reasons.push(FlipInventoryExclusionReason.MAXIMUM_ITEM_COUNT);
    }
    if (
      reasons.length === 0 &&
      listingAmount !== null &&
      eligibleValue + listingAmount > BigInt(policy.maximumExposureAmount)
    ) {
      reasons.push(FlipInventoryExclusionReason.MAXIMUM_EXPOSURE);
    }
    const eligible = reasons.length === 0 && listingAmount !== null;
    if (eligible && listingAmount !== null) {
      eligibleCount += 1;
      eligibleValue += listingAmount;
    }
    return {
      ...candidate,
      eligibilityListingValueAmount: candidate.listingValue?.normalizedAmount ?? null,
      eligibilityListingValueCurrency: candidate.listingValue ? NORMALIZED_CURRENCY : null,
      eligibilityListingValueDecimals: candidate.listingValue ? NORMALIZED_DECIMALS : null,
      eligibilityListingValueSourceTimestamp: candidate.listingValue?.sourceTimestamp ?? null,
      eligible,
      exclusionReasons: reasons,
      ordinal,
    };
  });

  if (eligibleCount < policy.minimumEligibleItems) {
    throw new ServiceUnavailableException(
      `Flip inventory snapshot has ${eligibleCount} eligible items; ${policy.minimumEligibleItems} required`,
    );
  }
  const policyHash = sha256(policy);
  const contentHash = sha256({
    entries: entries.map(hashableEntry),
    evaluatedAt: evaluatedAt.toISOString(),
    policyHash,
    schemaVersion: FLIP_INVENTORY_SCHEMA_VERSION,
  });
  return {
    contentHash,
    eligibleCount,
    eligibleValueAmount: eligibleValue.toString(),
    entries,
    evaluatedAt,
    excludedCount: entries.length - eligibleCount,
    policy,
    policyHash,
  };
}

export function flipInventoryFixtureModeEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.DAILYDRAFT_FLIP_FIXTURE_MODE !== 'true') return false;
  if (environment.VERCEL_ENV === 'production') return false;
  return (
    environment.NODE_ENV === 'test' ||
    environment.NODE_ENV === 'development' ||
    environment.VERCEL_ENV === 'preview'
  );
}

function canonicalPolicy(input: FlipInventorySnapshotPolicy): CanonicalPolicy {
  const poolKey = requireKey(input.poolKey, 'poolKey');
  const provider = requireKey(input.provider, 'provider');
  const policyVersion = requireKey(input.policyVersion, 'policyVersion');
  const allowedCollections = canonicalKeyList(input.allowedCollections, 'allowedCollections', true);
  const allowedGraders = canonicalKeyList(input.allowedGraders, 'allowedGraders', true);
  const excludedProviderAssetReferences = canonicalReferenceList(
    input.excludedProviderAssetReferences,
    'excludedProviderAssetReferences',
  );
  const excludedProviderListingReferences = canonicalReferenceList(
    input.excludedProviderListingReferences,
    'excludedProviderListingReferences',
  );
  const minimumEligibleItems = requireInteger(
    input.minimumEligibleItems,
    'minimumEligibleItems',
    1,
    MAX_CANDIDATES,
  );
  const maximumEligibleItems = requireInteger(
    input.maximumEligibleItems,
    'maximumEligibleItems',
    minimumEligibleItems,
    MAX_CANDIDATES,
  );
  const minimumListingValueAmount = normalizePolicyMoney(
    input.minimumListingValue,
    'minimumListingValue',
  );
  const maximumListingValueAmount = normalizePolicyMoney(
    input.maximumListingValue,
    'maximumListingValue',
  );
  const maximumExposureAmount = normalizePolicyMoney(input.maximumExposure, 'maximumExposure');
  if (BigInt(minimumListingValueAmount) > BigInt(maximumListingValueAmount)) {
    throw new ConflictException('Flip inventory listing value range is invalid');
  }
  if (BigInt(maximumExposureAmount) < BigInt(minimumListingValueAmount)) {
    throw new ConflictException('Flip inventory maximum exposure is below the minimum value');
  }
  return {
    allowedCollections,
    allowedGraders,
    excludedProviderAssetReferences,
    excludedProviderListingReferences,
    maximumEligibleItems,
    maximumExposureAmount,
    maximumFutureSkewMs: requireInteger(
      input.maximumFutureSkewMs,
      'maximumFutureSkewMs',
      0,
      60_000,
    ),
    maximumListingValueAmount,
    maximumSourceAgeMs: requireInteger(
      input.maximumSourceAgeMs,
      'maximumSourceAgeMs',
      1,
      30 * 24 * 60 * 60 * 1_000,
    ),
    minimumEligibleItems,
    minimumLiquidityBasisPoints: requireInteger(
      input.minimumLiquidityBasisPoints,
      'minimumLiquidityBasisPoints',
      0,
      10_000,
    ),
    minimumListingValueAmount,
    policyVersion,
    poolKey,
    provider,
    stakeAmount: normalizePolicyMoney(input.stake, 'stake'),
  };
}

function canonicalCandidate(candidate: FlipInventoryCandidate) {
  const providerAssetReference = requireReference(
    candidate.providerAssetReference,
    'providerAssetReference',
  );
  const providerListingReference = requireReference(
    candidate.providerListingReference,
    'providerListingReference',
  );
  return {
    buybackValue: canonicalOptionalMoney(candidate.buybackValue, 'buybackValue'),
    displayedValue: canonicalOptionalMoney(candidate.displayedValue, 'displayedValue'),
    insuredValue: canonicalOptionalMoney(candidate.insuredValue, 'insuredValue'),
    inventorySourceTimestamp: requireDate(
      candidate.inventorySourceTimestamp,
      'inventorySourceTimestamp',
    ),
    liquidityBasisPoints: requireInteger(
      candidate.liquidityBasisPoints,
      'liquidityBasisPoints',
      0,
      10_000,
    ),
    listingValue: canonicalOptionalMoney(candidate.listingValue, 'listingValue'),
    normalizedCollection: requireKey(candidate.normalizedCollection, 'normalizedCollection'),
    normalizedGrader: requireKey(candidate.normalizedGrader, 'normalizedGrader'),
    providerAssetReference,
    providerCollectionReference: requireReference(
      candidate.providerCollectionReference,
      'providerCollectionReference',
    ),
    providerGraderReference: requireReference(
      candidate.providerGraderReference,
      'providerGraderReference',
    ),
    providerListingReference,
  };
}

function canonicalOptionalMoney(
  value: FlipInventoryMoney | null | undefined,
  field: string,
): CanonicalMoney | null {
  if (value === null || value === undefined) return null;
  if (value.currency !== NORMALIZED_CURRENCY) {
    throw new ConflictException(`${field}.currency must be USDC`);
  }
  const amount = requireAmount(value.amount, `${field}.amount`);
  const decimals = requireInteger(value.decimals, `${field}.decimals`, 0, 18);
  return {
    amount,
    currency: NORMALIZED_CURRENCY,
    decimals,
    normalizedAmount: normalizeAmount(amount, decimals, field),
    providerReference: requireReference(value.providerReference, `${field}.providerReference`),
    sourceTimestamp: requireDate(value.sourceTimestamp, `${field}.sourceTimestamp`),
  };
}

function normalizePolicyMoney(
  value: Pick<FlipInventoryMoney, 'amount' | 'currency' | 'decimals'>,
  field: string,
): string {
  if (!value || value.currency !== NORMALIZED_CURRENCY) {
    throw new ConflictException(`${field}.currency must be USDC`);
  }
  const amount = requireAmount(value.amount, `${field}.amount`);
  const decimals = requireInteger(value.decimals, `${field}.decimals`, 0, 18);
  return normalizeAmount(amount, decimals, field);
}

function normalizeAmount(amount: string, decimals: number, field: string): string {
  const value = BigInt(amount);
  if (decimals === NORMALIZED_DECIMALS) return value.toString();
  if (decimals < NORMALIZED_DECIMALS) {
    return (value * 10n ** BigInt(NORMALIZED_DECIMALS - decimals)).toString();
  }
  const divisor = 10n ** BigInt(decimals - NORMALIZED_DECIMALS);
  if (value % divisor !== 0n) {
    throw new ConflictException(`${field}.amount cannot be normalized exactly to micro-USDC`);
  }
  return (value / divisor).toString();
}

function addFreshnessReason(
  reasons: FlipInventoryExclusionReason[],
  sourceTimestamp: Date,
  evaluatedAt: Date,
  policy: CanonicalPolicy,
  stale: FlipInventoryExclusionReason,
  future: FlipInventoryExclusionReason,
): void {
  const age = evaluatedAt.getTime() - sourceTimestamp.getTime();
  if (age > policy.maximumSourceAgeMs) reasons.push(stale);
  if (age < -policy.maximumFutureSkewMs) reasons.push(future);
}

function entryCreateInput(snapshotId: string, entry: PreparedEntry) {
  return {
    buybackValueAmount: entry.buybackValue?.amount ?? null,
    buybackValueCurrency: entry.buybackValue?.currency ?? null,
    buybackValueDecimals: entry.buybackValue?.decimals ?? null,
    buybackValueProviderReference: entry.buybackValue?.providerReference ?? null,
    buybackValueSourceTimestamp: entry.buybackValue?.sourceTimestamp ?? null,
    displayedValueAmount: entry.displayedValue?.amount ?? null,
    displayedValueCurrency: entry.displayedValue?.currency ?? null,
    displayedValueDecimals: entry.displayedValue?.decimals ?? null,
    displayedValueProviderReference: entry.displayedValue?.providerReference ?? null,
    displayedValueSourceTimestamp: entry.displayedValue?.sourceTimestamp ?? null,
    eligibilityListingValueAmount: entry.eligibilityListingValueAmount,
    eligibilityListingValueCurrency: entry.eligibilityListingValueCurrency,
    eligibilityListingValueDecimals: entry.eligibilityListingValueDecimals,
    eligibilityListingValueSourceTimestamp: entry.eligibilityListingValueSourceTimestamp,
    eligible: entry.eligible,
    exclusionReasons: entry.exclusionReasons,
    id: createId('flipentry'),
    insuredValueAmount: entry.insuredValue?.amount ?? null,
    insuredValueCurrency: entry.insuredValue?.currency ?? null,
    insuredValueDecimals: entry.insuredValue?.decimals ?? null,
    insuredValueProviderReference: entry.insuredValue?.providerReference ?? null,
    insuredValueSourceTimestamp: entry.insuredValue?.sourceTimestamp ?? null,
    inventorySourceTimestamp: entry.inventorySourceTimestamp,
    liquidityBasisPoints: entry.liquidityBasisPoints,
    listingValueAmount: entry.listingValue?.amount ?? null,
    listingValueCurrency: entry.listingValue?.currency ?? null,
    listingValueDecimals: entry.listingValue?.decimals ?? null,
    listingValueProviderReference: entry.listingValue?.providerReference ?? null,
    listingValueSourceTimestamp: entry.listingValue?.sourceTimestamp ?? null,
    normalizedCollection: entry.normalizedCollection,
    normalizedGrader: entry.normalizedGrader,
    ordinal: entry.ordinal,
    providerAssetReference: entry.providerAssetReference,
    providerCollectionReference: entry.providerCollectionReference,
    providerGraderReference: entry.providerGraderReference,
    providerListingReference: entry.providerListingReference,
    snapshotId,
  };
}

function hashableEntry(entry: PreparedEntry) {
  return {
    ...entry,
    buybackValue: hashableMoney(entry.buybackValue),
    displayedValue: hashableMoney(entry.displayedValue),
    eligibilityListingValueSourceTimestamp:
      entry.eligibilityListingValueSourceTimestamp?.toISOString() ?? null,
    insuredValue: hashableMoney(entry.insuredValue),
    inventorySourceTimestamp: entry.inventorySourceTimestamp.toISOString(),
    listingValue: hashableMoney(entry.listingValue),
  };
}

function hashableMoney(value: CanonicalMoney | null) {
  return value
    ? {
        amount: value.amount,
        currency: value.currency,
        decimals: value.decimals,
        normalizedAmount: value.normalizedAmount,
        providerReference: value.providerReference,
        sourceTimestamp: value.sourceTimestamp.toISOString(),
      }
    : null;
}

function canonicalKeyList(
  values: readonly string[],
  field: string,
  requireNonEmpty: boolean,
): string[] {
  if (!Array.isArray(values) || values.length > MAX_POLICY_KEYS) {
    throw new ConflictException(`${field} is invalid`);
  }
  const canonical = values.map((value) => requireKey(value, field));
  if (requireNonEmpty && canonical.length === 0) {
    throw new ConflictException(`${field} must not be empty`);
  }
  if (new Set(canonical).size !== canonical.length) {
    throw new ConflictException(`${field} contains duplicates`);
  }
  return canonical.sort(compareCanonical);
}

function canonicalReferenceList(values: readonly string[], field: string): string[] {
  if (!Array.isArray(values) || values.length > MAX_CANDIDATES) {
    throw new ConflictException(`${field} is invalid`);
  }
  const canonical = values.map((value) => requireReference(value, field));
  if (new Set(canonical).size !== canonical.length) {
    throw new ConflictException(`${field} contains duplicates`);
  }
  return canonical.sort(compareCanonical);
}

function requireKey(value: string, field: string): string {
  if (typeof value !== 'string') throw new ConflictException(`${field} is invalid`);
  const canonical = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(canonical)) {
    throw new ConflictException(`${field} is invalid`);
  }
  return canonical;
}

function requireReference(value: string, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_REFERENCE_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw new ConflictException(`${field} is invalid`);
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function requireAmount(value: string, field: string): string {
  if (typeof value !== 'string' || !/^[0-9]{1,36}$/.test(value)) {
    throw new ConflictException(`${field} must be an unsigned integer`);
  }
  return BigInt(value).toString();
}

function requireInteger(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConflictException(`${field} is invalid`);
  }
  return value;
}

function requireDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ConflictException(`${field} is invalid`);
  }
  return new Date(value.getTime());
}

function compareCanonical(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}
