import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient, Prisma } from '@dailydraft/db';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { acquireNamespacedAdvisoryTransactionLock } from '../database/advisory-lock.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  FLIP_INVENTORY_SCHEMA_VERSION,
  flipInventoryFixtureModeEnabled,
} from './flip-inventory-snapshot.service.js';

export const FLIP_RULES_SCHEMA_VERSION = 'dailydraft.flip-rules.v1' as const;
export const FLIP_RULES_CALCULATOR_VERSION = 'dailydraft.flip-outcome-bands.v1' as const;
export const FLIP_SESSION_POOL_COMMITMENT_SCHEMA_VERSION =
  'dailydraft.flip-session-pool-commitment.v1' as const;
export const FLIP_PROBABILITY_SCALE_PPM = 1_000_000;

const FLIP_RULES_LOCK_NAMESPACE = 1_584_503_770;
const FLIP_SESSION_POOL_LOCK_NAMESPACE = 1_584_503_771;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const MAX_BANDS = 16;
const MAX_REFERENCE_LENGTH = 240;
const MAX_U64 = 18_446_744_073_709_551_615n;

export type FlipRulesErrorCode =
  | 'INCOMPATIBLE_POOL'
  | 'INVALID_RULES'
  | 'PROBABILITY_TOTAL_MISMATCH'
  | 'RULES_HASH_MISMATCH'
  | 'UNSUPPORTED_RULES';

export class FlipRulesContractError extends Error {
  constructor(
    readonly code: FlipRulesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FlipRulesContractError';
  }
}

export interface FlipOutcomeBand {
  label: string;
  minimumValueAmount: string;
  probabilityPpm: number;
}

export interface UnsignedFlipRuleSet {
  activation: 'fixture-only';
  bands: readonly FlipOutcomeBand[];
  calculatorVersion: typeof FLIP_RULES_CALCULATOR_VERSION;
  currency: 'USDC';
  decimals: 6;
  feeAmount: string;
  houseEdgePpm: number;
  inventoryPolicyVersion: string;
  poolKey: string;
  probabilityScalePpm: typeof FLIP_PROBABILITY_SCALE_PPM;
  reviewReference: string;
  reviewedAt: string;
  rulesKey: string;
  schemaVersion: typeof FLIP_RULES_SCHEMA_VERSION;
  stakeAmount: string;
  version: number;
}

export interface FlipRuleSet extends UnsignedFlipRuleSet {
  rulesHash: string;
}

export interface CreateFlipSessionPoolCommitmentInput {
  committedAt: Date;
  rulesKey: string;
  rulesVersion: number;
  sessionReference: string;
  snapshotId: string;
}

export interface FlipEligibleOutcome {
  bandLabel: string;
  listingValueAmount: string;
  ordinal: number;
  providerAssetReference: string;
  providerListingReference: string;
}

export interface PreparedFlipSessionPoolCommitment {
  committedAt: Date;
  eligibleOutcomeCount: number;
  outcomeSpace: readonly FlipEligibleOutcome[];
  poolCanonicalPreimage: string;
  poolCommitmentHash: string;
  poolKey: string;
  rulesHash: string;
  rulesVersion: number;
  sessionReference: string;
  snapshotContentHash: string;
  snapshotRevision: number;
}

interface StoredFlipRuleSet {
  activation: string;
  bands: unknown;
  calculatorVersion: string;
  currency: string;
  decimals: number;
  feeAmount: string;
  houseEdgePpm: number;
  id: string;
  inventoryPolicyVersion: string;
  poolKey: string;
  probabilityScalePpm: number;
  reviewReference: string;
  reviewedAt: Date;
  rulesHash: string;
  rulesKey: string;
  schemaVersion: string;
  sealedAt: Date | null;
  stakeAmount: string;
  version: number;
}

export interface FlipCommittedInventoryEntry {
  eligibilityListingValueAmount: string | null;
  eligibilityListingValueCurrency: string | null;
  eligibilityListingValueDecimals: number | null;
  ordinal: number;
  providerAssetReference: string;
  providerListingReference: string;
}

export interface FlipCommittedInventorySnapshot {
  contentHash: string;
  eligibleCount: number;
  entries: readonly FlipCommittedInventoryEntry[];
  evaluatedAt: Date;
  id: string;
  policyVersion: string;
  poolKey: string;
  revision: number;
  schemaVersion: string;
  sealedAt: Date | null;
  stakeAmount: string;
  stakeCurrency: string;
  stakeDecimals: number;
}

@Injectable()
export class FlipRulesService {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  async createFixtureRuleSet(rules: unknown): Promise<{
    created: boolean;
    id: string;
    rulesHash: string;
    rulesKey: string;
    version: number;
  }> {
    requireFixtureMode();
    const validated = validateFlipRuleSet(rules);
    return this.database.$transaction(async (transaction) => {
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        validated.rulesKey,
        FLIP_RULES_LOCK_NAMESPACE,
      );
      const existing = await transaction.flipRuleSet.findUnique({
        select: {
          id: true,
          rulesHash: true,
          rulesKey: true,
          sealedAt: true,
          version: true,
        },
        where: {
          rulesKey_version: {
            rulesKey: validated.rulesKey,
            version: validated.version,
          },
        },
      });
      if (existing) {
        if (!existing.sealedAt) {
          throw new ServiceUnavailableException('Flip ruleset is not sealed');
        }
        if (existing.rulesHash !== validated.rulesHash) {
          throw new ConflictException('Flip ruleset version is already bound to different rules');
        }
        return {
          created: false,
          id: existing.id,
          rulesHash: existing.rulesHash,
          rulesKey: existing.rulesKey,
          version: existing.version,
        };
      }

      const id = createId('fliprules');
      await transaction.flipRuleSet.create({
        data: {
          activation: validated.activation,
          bands: validated.bands as unknown as Prisma.InputJsonValue,
          calculatorVersion: validated.calculatorVersion,
          currency: validated.currency,
          decimals: validated.decimals,
          feeAmount: validated.feeAmount,
          houseEdgePpm: validated.houseEdgePpm,
          id,
          inventoryPolicyVersion: validated.inventoryPolicyVersion,
          poolKey: validated.poolKey,
          probabilityScalePpm: validated.probabilityScalePpm,
          reviewReference: validated.reviewReference,
          reviewedAt: new Date(validated.reviewedAt),
          rulesCanonicalPreimage: canonicalFlipRuleSetPreimage(validated),
          rulesHash: validated.rulesHash,
          rulesKey: validated.rulesKey,
          schemaVersion: validated.schemaVersion,
          stakeAmount: validated.stakeAmount,
          version: validated.version,
        },
      });
      const sealed = await transaction.flipRuleSet.updateMany({
        data: { sealedAt: new Date() },
        where: { id, sealedAt: null },
      });
      if (sealed.count !== 1) {
        throw new ServiceUnavailableException('Flip ruleset could not be sealed');
      }
      return {
        created: true,
        id,
        rulesHash: validated.rulesHash,
        rulesKey: validated.rulesKey,
        version: validated.version,
      };
    });
  }

  async createFixtureSessionPoolCommitment(input: CreateFlipSessionPoolCommitmentInput): Promise<{
    created: boolean;
    eligibleOutcomeCount: number;
    id: string;
    poolCommitmentHash: string;
    rulesHash: string;
    sessionReference: string;
    snapshotContentHash: string;
  }> {
    requireFixtureMode();
    const sessionReference = requireReference(input.sessionReference, 'sessionReference');
    const snapshotId = requireReference(input.snapshotId, 'snapshotId');
    const rulesKey = requireKey(input.rulesKey, 'rulesKey');
    const rulesVersion = requireInteger(input.rulesVersion, 'rulesVersion', 1, 2_147_483_647);
    const committedAt = requireDate(input.committedAt, 'committedAt');

    return this.database.$transaction(async (transaction) => {
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        sessionReference,
        FLIP_SESSION_POOL_LOCK_NAMESPACE,
      );
      const existing = await transaction.flipSessionPoolCommitment.findUnique({
        select: {
          eligibleOutcomeCount: true,
          id: true,
          poolCommitmentHash: true,
          rulesHash: true,
          ruleset: { select: { rulesKey: true, version: true } },
          sealedAt: true,
          sessionReference: true,
          snapshotContentHash: true,
          snapshotId: true,
        },
        where: { sessionReference },
      });
      if (existing) {
        if (!existing.sealedAt) {
          throw new ServiceUnavailableException('Flip session pool commitment is not sealed');
        }
        if (
          existing.snapshotId !== snapshotId ||
          existing.ruleset.rulesKey !== rulesKey ||
          existing.ruleset.version !== rulesVersion
        ) {
          throw new ConflictException(
            'Flip session reference is already bound to a different ruleset or pool',
          );
        }
        return {
          created: false,
          eligibleOutcomeCount: existing.eligibleOutcomeCount,
          id: existing.id,
          poolCommitmentHash: existing.poolCommitmentHash,
          rulesHash: existing.rulesHash,
          sessionReference: existing.sessionReference,
          snapshotContentHash: existing.snapshotContentHash,
        };
      }

      const rules = await transaction.flipRuleSet.findUnique({
        where: { rulesKey_version: { rulesKey, version: rulesVersion } },
      });
      if (!rules) {
        throw new ServiceUnavailableException('No reviewed Flip ruleset is available');
      }
      if (!rules.sealedAt) {
        throw new ServiceUnavailableException('Reviewed Flip ruleset is not sealed');
      }
      const snapshot = await transaction.flipInventorySnapshot.findUnique({
        select: {
          contentHash: true,
          eligibleCount: true,
          entries: {
            orderBy: { ordinal: 'asc' },
            select: {
              eligibilityListingValueAmount: true,
              eligibilityListingValueCurrency: true,
              eligibilityListingValueDecimals: true,
              ordinal: true,
              providerAssetReference: true,
              providerListingReference: true,
            },
            where: { eligible: true },
          },
          evaluatedAt: true,
          id: true,
          policyVersion: true,
          poolKey: true,
          revision: true,
          schemaVersion: true,
          sealedAt: true,
          stakeAmount: true,
          stakeCurrency: true,
          stakeDecimals: true,
        },
        where: { id: snapshotId },
      });
      if (!snapshot) {
        throw new ServiceUnavailableException('No sealed Flip inventory snapshot is available');
      }

      const prepared = prepareFlipSessionPoolCommitment({
        committedAt,
        rules: storedRuleSetContract(rules),
        sessionReference,
        snapshot,
      });
      const id = createId('flipcommit');
      await transaction.flipSessionPoolCommitment.create({
        data: {
          committedAt: prepared.committedAt,
          eligibleOutcomeCount: prepared.eligibleOutcomeCount,
          id,
          outcomeSpace: prepared.outcomeSpace as unknown as Prisma.InputJsonValue,
          poolCanonicalPreimage: prepared.poolCanonicalPreimage,
          poolCommitmentHash: prepared.poolCommitmentHash,
          poolKey: prepared.poolKey,
          rulesHash: prepared.rulesHash,
          rulesVersion: prepared.rulesVersion,
          rulesetId: rules.id,
          sessionReference: prepared.sessionReference,
          snapshotContentHash: prepared.snapshotContentHash,
          snapshotId: snapshot.id,
          snapshotRevision: prepared.snapshotRevision,
        },
      });
      const sealed = await transaction.flipSessionPoolCommitment.updateMany({
        data: { sealedAt: new Date() },
        where: { id, sealedAt: null },
      });
      if (sealed.count !== 1) {
        throw new ServiceUnavailableException('Flip session pool commitment could not be sealed');
      }
      return {
        created: true,
        eligibleOutcomeCount: prepared.eligibleOutcomeCount,
        id,
        poolCommitmentHash: prepared.poolCommitmentHash,
        rulesHash: prepared.rulesHash,
        sessionReference: prepared.sessionReference,
        snapshotContentHash: prepared.snapshotContentHash,
      };
    });
  }
}

export function hashFlipRuleSet(rules: UnsignedFlipRuleSet): string {
  return sha256Preimage(canonicalFlipRuleSetPreimage(rules));
}

export function canonicalFlipRuleSetPreimage(rules: UnsignedFlipRuleSet): string {
  return stableStringify({
    activation: rules.activation,
    bands: rules.bands,
    calculatorVersion: rules.calculatorVersion,
    currency: rules.currency,
    decimals: rules.decimals,
    feeAmount: rules.feeAmount,
    houseEdgePpm: rules.houseEdgePpm,
    inventoryPolicyVersion: rules.inventoryPolicyVersion,
    poolKey: rules.poolKey,
    probabilityScalePpm: rules.probabilityScalePpm,
    reviewedAt: rules.reviewedAt,
    reviewReference: rules.reviewReference,
    rulesKey: rules.rulesKey,
    schemaVersion: rules.schemaVersion,
    stakeAmount: rules.stakeAmount,
    version: rules.version,
  });
}

export function validateFlipRuleSet(value: unknown): FlipRuleSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError('UNSUPPORTED_RULES', 'Reviewed Flip rules are required');
  }
  const rules = value as Partial<FlipRuleSet>;
  if (
    rules.schemaVersion !== FLIP_RULES_SCHEMA_VERSION ||
    rules.calculatorVersion !== FLIP_RULES_CALCULATOR_VERSION ||
    rules.activation !== 'fixture-only'
  ) {
    throw contractError(
      'UNSUPPORTED_RULES',
      'Flip rules use an unsupported schema, calculator, or activation mode',
    );
  }
  if (
    rules.currency !== 'USDC' ||
    rules.decimals !== 6 ||
    rules.probabilityScalePpm !== FLIP_PROBABILITY_SCALE_PPM
  ) {
    throw contractError('INVALID_RULES', 'Flip rules have invalid numeric semantics');
  }

  const rulesKey = contractKey(rules.rulesKey, 'rulesKey');
  const poolKey = contractKey(rules.poolKey, 'poolKey');
  const inventoryPolicyVersion = contractKey(
    rules.inventoryPolicyVersion,
    'inventoryPolicyVersion',
  );
  const version = contractInteger(rules.version, 'version', 1, 2_147_483_647);
  const houseEdgePpm = contractInteger(
    rules.houseEdgePpm,
    'houseEdgePpm',
    0,
    FLIP_PROBABILITY_SCALE_PPM,
  );
  const stakeAmount = parseMinorUnits(rules.stakeAmount, 'stakeAmount').toString();
  const feeAmount = parseMinorUnits(rules.feeAmount, 'feeAmount').toString();
  if (BigInt(stakeAmount) === 0n) {
    throw contractError('INVALID_RULES', 'Flip rules stakeAmount must be positive');
  }
  if (BigInt(feeAmount) > BigInt(stakeAmount)) {
    throw contractError('INVALID_RULES', 'Flip rules feeAmount exceeds the stake');
  }
  const reviewReference = contractReference(rules.reviewReference, 'reviewReference');
  const reviewedAt = contractTimestamp(rules.reviewedAt, 'reviewedAt');
  if (typeof rules.rulesHash !== 'string' || !HASH_PATTERN.test(rules.rulesHash)) {
    throw contractError('RULES_HASH_MISMATCH', 'Flip rulesHash is invalid');
  }
  if (!Array.isArray(rules.bands) || rules.bands.length < 1 || rules.bands.length > MAX_BANDS) {
    throw contractError('INVALID_RULES', `Flip rules require between 1 and ${MAX_BANDS} bands`);
  }

  const labels = new Set<string>();
  const bands: FlipOutcomeBand[] = [];
  let previousMinimum = -1n;
  let probabilityTotal = 0;
  for (const candidate of rules.bands) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw contractError('INVALID_RULES', 'Flip outcome band is invalid');
    }
    const band = candidate as Partial<FlipOutcomeBand>;
    const label = contractKey(band.label, 'band.label');
    if (labels.has(label)) {
      throw contractError('INVALID_RULES', 'Flip outcome band labels must be unique');
    }
    labels.add(label);
    const minimum = parseMinorUnits(band.minimumValueAmount, 'band.minimumValueAmount');
    if (minimum <= previousMinimum) {
      throw contractError(
        'INVALID_RULES',
        'Flip outcome band minimums must be strictly increasing',
      );
    }
    const probabilityPpm = contractInteger(
      band.probabilityPpm,
      'band.probabilityPpm',
      1,
      FLIP_PROBABILITY_SCALE_PPM,
    );
    bands.push(
      Object.freeze({
        label,
        minimumValueAmount: minimum.toString(),
        probabilityPpm,
      }),
    );
    previousMinimum = minimum;
    probabilityTotal += probabilityPpm;
  }
  if (bands[0]?.minimumValueAmount !== '0') {
    throw contractError('INVALID_RULES', 'The first Flip outcome band must begin at zero');
  }
  if (probabilityTotal !== FLIP_PROBABILITY_SCALE_PPM) {
    throw contractError(
      'PROBABILITY_TOTAL_MISMATCH',
      `Flip outcome probabilities must total ${FLIP_PROBABILITY_SCALE_PPM} PPM`,
    );
  }

  const unsigned: UnsignedFlipRuleSet = {
    activation: 'fixture-only',
    bands: Object.freeze(bands),
    calculatorVersion: FLIP_RULES_CALCULATOR_VERSION,
    currency: 'USDC',
    decimals: 6,
    feeAmount,
    houseEdgePpm,
    inventoryPolicyVersion,
    poolKey,
    probabilityScalePpm: FLIP_PROBABILITY_SCALE_PPM,
    reviewReference,
    reviewedAt,
    rulesKey,
    schemaVersion: FLIP_RULES_SCHEMA_VERSION,
    stakeAmount,
    version,
  };
  const calculatedHash = hashFlipRuleSet(unsigned);
  if (calculatedHash !== rules.rulesHash) {
    throw contractError('RULES_HASH_MISMATCH', 'Flip rules do not match their committed hash');
  }
  return Object.freeze({ ...unsigned, rulesHash: calculatedHash });
}

export function createFixtureFlipRuleSet(
  overrides: Partial<UnsignedFlipRuleSet> = {},
): FlipRuleSet {
  const unsigned = Object.freeze({
    activation: 'fixture-only',
    bands: Object.freeze([
      Object.freeze({
        label: 'base',
        minimumValueAmount: '0',
        probabilityPpm: 700_000,
      }),
      Object.freeze({
        label: 'plus',
        minimumValueAmount: '25000000',
        probabilityPpm: 250_000,
      }),
      Object.freeze({
        label: 'chase',
        minimumValueAmount: '50000000',
        probabilityPpm: 50_000,
      }),
    ]),
    calculatorVersion: FLIP_RULES_CALCULATOR_VERSION,
    currency: 'USDC',
    decimals: 6,
    feeAmount: '2000000',
    houseEdgePpm: 50_000,
    inventoryPolicyVersion: 'flip-fixture-policy-v1',
    poolKey: 'flip-pokemon-50',
    probabilityScalePpm: FLIP_PROBABILITY_SCALE_PPM,
    reviewReference: 'fixture-review/flip-rules-v1',
    reviewedAt: '2026-08-03T12:01:00.000Z',
    rulesKey: 'flip-pokemon-50-fixture',
    schemaVersion: FLIP_RULES_SCHEMA_VERSION,
    stakeAmount: '50000000',
    version: 1,
    ...overrides,
  } as const satisfies UnsignedFlipRuleSet);
  return Object.freeze({
    ...unsigned,
    rulesHash: hashFlipRuleSet(unsigned),
  });
}

export function prepareFlipSessionPoolCommitment(input: {
  committedAt: Date;
  rules: unknown;
  sessionReference: string;
  snapshot: FlipCommittedInventorySnapshot;
}): PreparedFlipSessionPoolCommitment {
  const rules = validateFlipRuleSet(input.rules);
  const sessionReference = requireReference(input.sessionReference, 'sessionReference');
  const committedAt = requireDate(input.committedAt, 'committedAt');
  const snapshot = input.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    throw contractError('INCOMPATIBLE_POOL', 'Flip inventory snapshot is required');
  }
  if (!snapshot.sealedAt) {
    throw contractError('INCOMPATIBLE_POOL', 'Flip inventory snapshot is not sealed');
  }
  if (snapshot.schemaVersion !== FLIP_INVENTORY_SCHEMA_VERSION) {
    throw contractError('INCOMPATIBLE_POOL', 'Flip inventory snapshot schema is unsupported');
  }
  if (
    rules.poolKey !== snapshot.poolKey ||
    rules.inventoryPolicyVersion !== snapshot.policyVersion ||
    rules.stakeAmount !== snapshot.stakeAmount ||
    snapshot.stakeCurrency !== rules.currency ||
    snapshot.stakeDecimals !== rules.decimals
  ) {
    throw contractError(
      'INCOMPATIBLE_POOL',
      'Flip rules do not match the inventory pool policy or stake',
    );
  }
  if (!HASH_PATTERN.test(snapshot.contentHash)) {
    throw contractError('INCOMPATIBLE_POOL', 'Flip inventory content hash is invalid');
  }
  if (
    !Number.isInteger(snapshot.revision) ||
    snapshot.revision < 1 ||
    !Number.isInteger(snapshot.eligibleCount) ||
    snapshot.eligibleCount < 1 ||
    !Array.isArray(snapshot.entries) ||
    snapshot.entries.length !== snapshot.eligibleCount
  ) {
    throw contractError('INCOMPATIBLE_POOL', 'Flip inventory eligible outcome count is invalid');
  }
  const evaluatedAt = requireDate(snapshot.evaluatedAt, 'snapshot.evaluatedAt');
  if (
    committedAt.getTime() < new Date(rules.reviewedAt).getTime() ||
    committedAt.getTime() < evaluatedAt.getTime()
  ) {
    throw contractError(
      'INCOMPATIBLE_POOL',
      'Flip session cannot predate reviewed rules or its inventory snapshot',
    );
  }

  const assets = new Set<string>();
  const listings = new Set<string>();
  const representedBands = new Set<string>();
  let previousOrdinal = -1;
  const outcomeSpace = snapshot.entries.map((entry): FlipEligibleOutcome => {
    if (!Number.isInteger(entry.ordinal) || entry.ordinal <= previousOrdinal) {
      throw contractError(
        'INCOMPATIBLE_POOL',
        'Flip inventory eligible ordinals are not strictly ordered',
      );
    }
    previousOrdinal = entry.ordinal;
    const providerAssetReference = contractReference(
      entry.providerAssetReference,
      'providerAssetReference',
    );
    const providerListingReference = contractReference(
      entry.providerListingReference,
      'providerListingReference',
    );
    if (assets.has(providerAssetReference) || listings.has(providerListingReference)) {
      throw contractError('INCOMPATIBLE_POOL', 'Flip inventory outcome references are duplicated');
    }
    assets.add(providerAssetReference);
    listings.add(providerListingReference);
    if (
      entry.eligibilityListingValueCurrency !== 'USDC' ||
      entry.eligibilityListingValueDecimals !== 6
    ) {
      throw contractError(
        'INCOMPATIBLE_POOL',
        'Flip inventory outcome value semantics are invalid',
      );
    }
    const listingValueAmount = parseMinorUnits(
      entry.eligibilityListingValueAmount,
      'eligibilityListingValueAmount',
    ).toString();
    const band = flipOutcomeBandForValue(rules.bands, listingValueAmount);
    representedBands.add(band.label);
    return Object.freeze({
      bandLabel: band.label,
      listingValueAmount,
      ordinal: entry.ordinal,
      providerAssetReference,
      providerListingReference,
    });
  });
  const missingBand = rules.bands.find((band) => !representedBands.has(band.label));
  if (missingBand) {
    throw contractError(
      'INCOMPATIBLE_POOL',
      `Flip inventory has no eligible outcome for the ${missingBand.label} band`,
    );
  }

  const frozenOutcomeSpace = Object.freeze(outcomeSpace);
  const poolCanonicalPreimage = stableStringify({
    outcomeSpace: frozenOutcomeSpace,
    rulesHash: rules.rulesHash,
    schemaVersion: FLIP_SESSION_POOL_COMMITMENT_SCHEMA_VERSION,
    snapshotContentHash: snapshot.contentHash,
  });
  const poolCommitmentHash = sha256Preimage(poolCanonicalPreimage);
  return Object.freeze({
    committedAt,
    eligibleOutcomeCount: frozenOutcomeSpace.length,
    outcomeSpace: frozenOutcomeSpace,
    poolCanonicalPreimage,
    poolCommitmentHash,
    poolKey: rules.poolKey,
    rulesHash: rules.rulesHash,
    rulesVersion: rules.version,
    sessionReference,
    snapshotContentHash: snapshot.contentHash,
    snapshotRevision: snapshot.revision,
  });
}

export function flipOutcomeBandForValue(
  bands: readonly FlipOutcomeBand[],
  listingValueAmount: string,
): FlipOutcomeBand {
  const value = parseMinorUnits(listingValueAmount, 'listingValueAmount');
  let selected = bands[0];
  for (const band of bands) {
    if (value < BigInt(band.minimumValueAmount)) break;
    selected = band;
  }
  if (!selected) {
    throw contractError('INVALID_RULES', 'Flip outcome bands are empty');
  }
  return selected;
}

function storedRuleSetContract(rules: StoredFlipRuleSet): FlipRuleSet {
  return {
    activation: rules.activation as 'fixture-only',
    bands: rules.bands as FlipOutcomeBand[],
    calculatorVersion: rules.calculatorVersion as typeof FLIP_RULES_CALCULATOR_VERSION,
    currency: rules.currency as 'USDC',
    decimals: rules.decimals as 6,
    feeAmount: rules.feeAmount,
    houseEdgePpm: rules.houseEdgePpm,
    inventoryPolicyVersion: rules.inventoryPolicyVersion,
    poolKey: rules.poolKey,
    probabilityScalePpm: rules.probabilityScalePpm as typeof FLIP_PROBABILITY_SCALE_PPM,
    reviewReference: rules.reviewReference,
    reviewedAt: rules.reviewedAt.toISOString(),
    rulesHash: rules.rulesHash,
    rulesKey: rules.rulesKey,
    schemaVersion: rules.schemaVersion as typeof FLIP_RULES_SCHEMA_VERSION,
    stakeAmount: rules.stakeAmount,
    version: rules.version,
  };
}

function requireFixtureMode(): void {
  if (!flipInventoryFixtureModeEnabled()) {
    throw new ServiceUnavailableException(
      'Flip rules and session pools are disabled outside explicit fixture or preview mode',
    );
  }
}

function contractKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw contractError('INVALID_RULES', `Flip rules ${field} is invalid`);
  }
  return value;
}

function contractReference(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_REFERENCE_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw contractError('INVALID_RULES', `Flip rules ${field} is invalid`);
  }
  return value;
}

function contractInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    throw contractError('INVALID_RULES', `Flip rules ${field} is invalid`);
  }
  return value;
}

function contractTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw contractError('INVALID_RULES', `Flip rules ${field} is invalid`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw contractError('INVALID_RULES', `Flip rules ${field} is invalid`);
  }
  return value;
}

function parseMinorUnits(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER_PATTERN.test(value)) {
    throw contractError(
      'INVALID_RULES',
      `Flip rules ${field} must be canonical unsigned minor units`,
    );
  }
  const amount = BigInt(value);
  if (amount > MAX_U64) {
    throw contractError('INVALID_RULES', `Flip rules ${field} exceeds the u64 limit`);
  }
  return amount;
}

function requireKey(value: string, field: string): string {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw new ConflictException(`${field} is invalid`);
  }
  return value;
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

function contractError(code: FlipRulesErrorCode, message: string): FlipRulesContractError {
  return new FlipRulesContractError(code, message);
}

function sha256Preimage(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}
