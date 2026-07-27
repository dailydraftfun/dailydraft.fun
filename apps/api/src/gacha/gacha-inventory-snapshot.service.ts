import { createHash, randomUUID } from 'node:crypto';
import {
  type DatabaseClient,
  GachaInventoryExclusionReason,
  GachaSport,
  type Prisma,
} from '@dailydraft/db';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { acquireNamespacedAdvisoryTransactionLock } from '../database/advisory-lock.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import { DEVNET_DEMO_VALUATION_POLICY, stableStringify } from '../providers/valuation-policy.js';
import { gachaDevnetModeEnabled } from './gacha-capability.js';
import { gachaFixtureModeEnabled } from './sports-pack-gacha.fixture.js';
import type {
  SportsPackGachaCard,
  SportsPackGachaMachine,
  SportsPackGachaSport,
} from './sports-pack-gacha.provider.js';

export const GACHA_INVENTORY_SCHEMA_VERSION = 'dailydraft.gacha-inventory.v1';

const GACHA_INVENTORY_LOCK_NAMESPACE = 1_191_047_329;
const MAX_CANDIDATES = 500;
const MAX_REFERENCE_LENGTH = 240;
const NORMALIZED_CURRENCY = 'USDC';
const NORMALIZED_DECIMALS = 6;

export interface GachaInventorySnapshotPolicy {
  machine: SportsPackGachaMachine;
  maximumEligibleItems: number;
  maximumFutureSkewMs: number;
  maximumSourceAgeMs: number;
  minimumEligibleItems: number;
  policyVersion: string;
  poolKey: string;
  provider: string;
}

export interface PrepareGachaInventorySnapshotInput {
  candidates: readonly SportsPackGachaCard[];
  evaluatedAt: Date;
  policy: GachaInventorySnapshotPolicy;
}

interface CanonicalInsuredValue {
  amount: string;
  currency: 'USDC';
  decimals: 6;
  providerReference: string;
  sourceTimestamp: Date;
}

interface CanonicalMachine {
  committedPoolSize: number;
  displayName: string;
  machineKey: string;
  sport: SportsPackGachaSport;
  tierPriceMinor: string;
}

interface CanonicalPolicy {
  machine: CanonicalMachine;
  maximumEligibleItems: number;
  maximumFutureSkewMs: number;
  maximumSourceAgeMs: number;
  minimumEligibleItems: number;
  policyVersion: string;
  poolKey: string;
  provider: string;
}

export interface PreparedGachaInventoryEntry {
  assetReference: string | null;
  displayName: string;
  eligible: boolean;
  exclusionReasons: GachaInventoryExclusionReason[];
  graded: boolean;
  graderReference: string | null;
  insuredValue: CanonicalInsuredValue | null;
  inventorySourceTimestamp: Date;
  ordinal: number;
  poolOpen: boolean;
  providerCardReference: string;
  sport: SportsPackGachaSport;
  tierEnabled: boolean;
  valuationSourceReference: string | null;
  vaulted: boolean;
}

export interface PreparedGachaInventorySnapshot {
  contentHash: string;
  eligibleCount: number;
  eligibleValueMinor: string;
  entries: PreparedGachaInventoryEntry[];
  evaluatedAt: Date;
  excludedCount: number;
  policy: CanonicalPolicy;
  policyHash: string;
}

@Injectable()
export class GachaInventorySnapshotService {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  async createFixtureSnapshot(input: PrepareGachaInventorySnapshotInput): Promise<{
    contentHash: string;
    created: boolean;
    id: string;
    machineKey: string;
    poolKey: string;
    revision: number;
    sealedAt: Date;
  }> {
    // Named for the fixture rail it shipped with; devnet now seals through the
    // same path with its own policy (see `snapshotInputForMode`). Collector
    // Crypt production inventory still has no sealing rail, so the gate stays.
    if (!gachaFixtureModeEnabled() && !gachaDevnetModeEnabled()) {
      throw new ServiceUnavailableException(
        'Gacha inventory snapshots are disabled outside explicit fixture, preview, or devnet mode',
      );
    }
    const prepared = prepareGachaInventorySnapshot(input);
    return this.database.$transaction(async (transaction) => {
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        prepared.policy.poolKey,
        GACHA_INVENTORY_LOCK_NAMESPACE,
      );
      await transaction.gachaMachine.upsert({
        create: machineCreateInput(prepared.policy.machine),
        update: {
          active: true,
          committedPoolSize: prepared.policy.machine.committedPoolSize,
          displayName: prepared.policy.machine.displayName,
          sport: databaseSport(prepared.policy.machine.sport),
          tierPriceMinor: prepared.policy.machine.tierPriceMinor,
        },
        where: { machineKey: prepared.policy.machine.machineKey },
      });
      const existing = await transaction.gachaInventorySnapshot.findUnique({
        select: {
          contentHash: true,
          id: true,
          machineKey: true,
          poolKey: true,
          revision: true,
          sealedAt: true,
        },
        where: {
          poolKey_contentHash: {
            contentHash: prepared.contentHash,
            poolKey: prepared.policy.poolKey,
          },
        },
      });
      if (existing) {
        if (!existing.sealedAt) {
          throw new ServiceUnavailableException('Gacha inventory snapshot is not sealed');
        }
        return {
          contentHash: existing.contentHash,
          created: false,
          id: existing.id,
          machineKey: existing.machineKey,
          poolKey: existing.poolKey,
          revision: existing.revision,
          sealedAt: existing.sealedAt,
        };
      }

      const latest = await transaction.gachaInventorySnapshot.findFirst({
        orderBy: { revision: 'desc' },
        select: { revision: true },
        where: { poolKey: prepared.policy.poolKey },
      });
      const id = createId('gachasnap');
      const revision = (latest?.revision ?? 0) + 1;
      await transaction.gachaInventorySnapshot.create({
        data: {
          committedPoolSize: prepared.policy.machine.committedPoolSize,
          contentHash: prepared.contentHash,
          createdAt: new Date(),
          eligibleCount: prepared.eligibleCount,
          eligibleValueMinor: prepared.eligibleValueMinor,
          evaluatedAt: prepared.evaluatedAt,
          excludedCount: prepared.excludedCount,
          id,
          machineKey: prepared.policy.machine.machineKey,
          maximumEligibleItems: prepared.policy.maximumEligibleItems,
          maximumFutureSkewMs: prepared.policy.maximumFutureSkewMs,
          maximumSourceAgeMs: prepared.policy.maximumSourceAgeMs,
          policy: prepared.policy as unknown as Prisma.InputJsonValue,
          policyHash: prepared.policyHash,
          policyVersion: prepared.policy.policyVersion,
          poolKey: prepared.policy.poolKey,
          provider: prepared.policy.provider,
          revision,
          schemaVersion: GACHA_INVENTORY_SCHEMA_VERSION,
        },
      });
      await transaction.gachaInventorySnapshotEntry.createMany({
        data: prepared.entries.map((entry) => entryCreateInput(id, entry)),
      });
      const sealedAt = new Date();
      const sealed = await transaction.gachaInventorySnapshot.updateMany({
        data: { sealedAt },
        where: { id, sealedAt: null },
      });
      if (sealed.count !== 1) {
        throw new ServiceUnavailableException('Gacha inventory snapshot could not be sealed');
      }
      return {
        contentHash: prepared.contentHash,
        created: true,
        id,
        machineKey: prepared.policy.machine.machineKey,
        poolKey: prepared.policy.poolKey,
        revision,
        sealedAt,
      };
    });
  }

  async findLatestSealed(machineKey: string) {
    const snapshot = await this.database.gachaInventorySnapshot.findFirst({
      include: {
        entries: {
          orderBy: { ordinal: 'asc' },
        },
        machine: true,
      },
      orderBy: { revision: 'desc' },
      where: {
        machineKey: requireKey(machineKey, 'machineKey'),
        sealedAt: { not: null },
      },
    });
    if (!snapshot) {
      throw new ServiceUnavailableException('No sealed Gacha inventory snapshot is available');
    }
    return snapshot;
  }
}

export function prepareGachaInventorySnapshot(
  input: PrepareGachaInventorySnapshotInput,
): PreparedGachaInventorySnapshot {
  const evaluatedAt = requireDate(input.evaluatedAt, 'evaluatedAt');
  const policy = canonicalPolicy(input.policy);
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new ConflictException('Gacha inventory snapshot requires provider candidates');
  }
  if (input.candidates.length > MAX_CANDIDATES) {
    throw new ConflictException(`Gacha inventory snapshot exceeds ${MAX_CANDIDATES} candidates`);
  }

  const providerCards = new Set<string>();
  const candidates = input.candidates.map((candidate) => {
    const prepared = canonicalCandidate(candidate);
    if (providerCards.has(prepared.providerCardReference)) {
      throw new ConflictException('Gacha inventory contains a duplicate provider card reference');
    }
    providerCards.add(prepared.providerCardReference);
    return prepared;
  });
  candidates.sort((left, right) =>
    compareCanonical(left.providerCardReference, right.providerCardReference),
  );
  const assetCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.assetReference) {
      assetCounts.set(
        candidate.assetReference,
        (assetCounts.get(candidate.assetReference) ?? 0) + 1,
      );
    }
  }

  let eligibleCount = 0;
  let eligibleValue = 0n;
  const entries = candidates.map((candidate, ordinal): PreparedGachaInventoryEntry => {
    const reasons: GachaInventoryExclusionReason[] = [];
    if (!candidate.assetReference) {
      reasons.push(GachaInventoryExclusionReason.MISSING_ASSET_REFERENCE);
    } else if ((assetCounts.get(candidate.assetReference) ?? 0) > 1) {
      reasons.push(GachaInventoryExclusionReason.DUPLICATE_ASSET);
    }
    if (!candidate.insuredValue) {
      reasons.push(GachaInventoryExclusionReason.MISSING_INSURED_VALUE);
    }
    if (!candidate.valuationSourceReference) {
      reasons.push(GachaInventoryExclusionReason.MISSING_VALUATION_SOURCE);
    }
    if (candidate.insuredValue) {
      const age = evaluatedAt.getTime() - candidate.insuredValue.sourceTimestamp.getTime();
      if (age > policy.maximumSourceAgeMs) {
        reasons.push(GachaInventoryExclusionReason.STALE_VALUATION);
      }
      if (age < -policy.maximumFutureSkewMs) {
        reasons.push(GachaInventoryExclusionReason.FUTURE_VALUATION);
      }
    }
    if (!candidate.poolOpen) reasons.push(GachaInventoryExclusionReason.POOL_CLOSED);
    if (!candidate.tierEnabled) reasons.push(GachaInventoryExclusionReason.TIER_DISABLED);
    if (!candidate.vaulted) reasons.push(GachaInventoryExclusionReason.NOT_VAULTED);
    if (!candidate.graded || !candidate.graderReference) {
      reasons.push(GachaInventoryExclusionReason.UNGRADED);
    }
    if (candidate.sport !== policy.machine.sport) {
      reasons.push(GachaInventoryExclusionReason.SPORT_MISMATCH);
    }
    if (reasons.length === 0 && eligibleCount >= policy.maximumEligibleItems) {
      reasons.push(GachaInventoryExclusionReason.MAXIMUM_ITEM_COUNT);
    }

    const eligible = reasons.length === 0 && candidate.insuredValue !== null;
    if (eligible && candidate.insuredValue) {
      eligibleCount += 1;
      eligibleValue += BigInt(candidate.insuredValue.amount);
    }
    return {
      ...candidate,
      eligible,
      exclusionReasons: reasons,
      ordinal,
    };
  });

  if (eligibleCount < policy.minimumEligibleItems) {
    throw new ServiceUnavailableException(
      `Gacha inventory snapshot has ${eligibleCount} eligible items; ${policy.minimumEligibleItems} required`,
    );
  }
  const policyHash = sha256(policy);
  const contentHash = sha256({
    entries: entries.map(hashableEntry),
    evaluatedAt: evaluatedAt.toISOString(),
    policyHash,
    schemaVersion: GACHA_INVENTORY_SCHEMA_VERSION,
  });
  return {
    contentHash,
    eligibleCount,
    eligibleValueMinor: eligibleValue.toString(),
    entries,
    evaluatedAt,
    excludedCount: entries.length - eligibleCount,
    policy,
    policyHash,
  };
}

export function fixtureSnapshotInput(
  machine: SportsPackGachaMachine,
  candidates: readonly SportsPackGachaCard[],
): PrepareGachaInventorySnapshotInput {
  return {
    candidates,
    evaluatedAt: latestEvidenceTimestamp(candidates),
    policy: {
      machine,
      maximumEligibleItems: machine.committedPoolSize,
      maximumFutureSkewMs: 30_000,
      maximumSourceAgeMs: 300_000,
      minimumEligibleItems: machine.committedPoolSize,
      policyVersion: 'sports-pack-gacha-devnet-fixture-v1',
      poolKey: `${machine.machineKey}:pool`,
      provider: 'collector-crypt-devnet-fixture',
    },
  };
}

export function devnetSnapshotInput(
  machine: SportsPackGachaMachine,
  candidates: readonly SportsPackGachaCard[],
): PrepareGachaInventorySnapshotInput {
  return {
    candidates,
    evaluatedAt: latestEvidenceTimestamp(candidates),
    policy: {
      machine,
      maximumEligibleItems: machine.committedPoolSize,
      maximumFutureSkewMs: 30_000,
      // Devnet values real Pokémon TCG cards, whose price rows carry a
      // `YYYY/MM/DD` timestamp normalized to UTC start of day. The fixture's
      // five-minute window would exclude every one of them as
      // `STALE_VALUATION`, and because `minimumEligibleItems` equals the
      // committed pool size a single exclusion fails the whole seal. The
      // allowance is the pinned demo valuation policy's own maximum source
      // age, so both rails answer to one number.
      maximumSourceAgeMs: DEVNET_DEMO_VALUATION_POLICY.maxSourceAgeSeconds * 1_000,
      minimumEligibleItems: machine.committedPoolSize,
      policyVersion: 'sports-pack-gacha-devnet-v1',
      poolKey: `${machine.machineKey}:pool`,
      provider: 'dailydraft-devnet',
    },
  };
}

/**
 * Fixture first, matching the provider selection in `gacha.module.ts`: a
 * deployment that turns fixtures on is explicitly asking for deterministic
 * inventory even when devnet credentials happen to be present.
 */
export function snapshotInputForMode(
  machine: SportsPackGachaMachine,
  candidates: readonly SportsPackGachaCard[],
): PrepareGachaInventorySnapshotInput {
  if (gachaFixtureModeEnabled()) {
    return fixtureSnapshotInput(machine, candidates);
  }
  return devnetSnapshotInput(machine, candidates);
}

function latestEvidenceTimestamp(candidates: readonly SportsPackGachaCard[]): Date {
  return candidates.reduce((latest, candidate) => {
    const evidenceTimestamp =
      candidate.insuredValue?.sourceTimestamp &&
      candidate.insuredValue.sourceTimestamp > candidate.inventorySourceTimestamp
        ? candidate.insuredValue.sourceTimestamp
        : candidate.inventorySourceTimestamp;
    return evidenceTimestamp > latest ? evidenceTimestamp : latest;
  }, new Date(0));
}

function canonicalPolicy(input: GachaInventorySnapshotPolicy): CanonicalPolicy {
  const machine = canonicalMachine(input.machine);
  const minimumEligibleItems = requireInteger(
    input.minimumEligibleItems,
    'minimumEligibleItems',
    1,
    machine.committedPoolSize,
  );
  const maximumEligibleItems = requireInteger(
    input.maximumEligibleItems,
    'maximumEligibleItems',
    minimumEligibleItems,
    machine.committedPoolSize,
  );
  return {
    machine,
    maximumEligibleItems,
    maximumFutureSkewMs: requireInteger(
      input.maximumFutureSkewMs,
      'maximumFutureSkewMs',
      0,
      60_000,
    ),
    maximumSourceAgeMs: requireInteger(
      input.maximumSourceAgeMs,
      'maximumSourceAgeMs',
      1,
      30 * 24 * 60 * 60 * 1_000,
    ),
    minimumEligibleItems,
    policyVersion: requireKey(input.policyVersion, 'policyVersion'),
    poolKey: requireKey(input.poolKey, 'poolKey'),
    provider: requireKey(input.provider, 'provider'),
  };
}

function canonicalMachine(machine: SportsPackGachaMachine): CanonicalMachine {
  return {
    committedPoolSize: requireInteger(
      machine.committedPoolSize,
      'machine.committedPoolSize',
      1,
      MAX_CANDIDATES,
    ),
    displayName: requireDisplayName(machine.displayName, 'machine.displayName'),
    machineKey: requireKey(machine.machineKey, 'machine.machineKey'),
    sport: requireSport(machine.sport),
    tierPriceMinor: requireAmount(machine.tierPriceMinor, 'machine.tierPriceMinor'),
  };
}

function canonicalCandidate(candidate: SportsPackGachaCard) {
  return {
    assetReference: optionalReference(candidate.assetReference, 'assetReference'),
    displayName: requireDisplayName(candidate.displayName, 'displayName'),
    graded: requireBoolean(candidate.graded, 'graded'),
    graderReference: optionalReference(candidate.graderReference, 'graderReference'),
    insuredValue: canonicalInsuredValue(candidate.insuredValue),
    inventorySourceTimestamp: requireDate(
      candidate.inventorySourceTimestamp,
      'inventorySourceTimestamp',
    ),
    poolOpen: requireBoolean(candidate.poolOpen, 'poolOpen'),
    providerCardReference: requireReference(
      candidate.providerCardReference,
      'providerCardReference',
    ),
    sport: requireSport(candidate.sport),
    tierEnabled: requireBoolean(candidate.tierEnabled, 'tierEnabled'),
    valuationSourceReference: optionalReference(
      candidate.valuationSourceReference,
      'valuationSourceReference',
    ),
    vaulted: requireBoolean(candidate.vaulted, 'vaulted'),
  };
}

function canonicalInsuredValue(
  value: SportsPackGachaCard['insuredValue'],
): CanonicalInsuredValue | null {
  if (!value) return null;
  if (value.currency !== NORMALIZED_CURRENCY || value.decimals !== NORMALIZED_DECIMALS) {
    throw new ConflictException('insuredValue must use micro-USDC');
  }
  return {
    amount: requireAmount(value.amount, 'insuredValue.amount'),
    currency: NORMALIZED_CURRENCY,
    decimals: NORMALIZED_DECIMALS,
    providerReference: requireReference(value.providerReference, 'insuredValue.providerReference'),
    sourceTimestamp: requireDate(value.sourceTimestamp, 'insuredValue.sourceTimestamp'),
  };
}

function machineCreateInput(machine: CanonicalMachine) {
  return {
    active: true,
    committedPoolSize: machine.committedPoolSize,
    displayName: machine.displayName,
    id: createId('gachamachine'),
    machineKey: machine.machineKey,
    sport: databaseSport(machine.sport),
    tierPriceCurrency: NORMALIZED_CURRENCY,
    tierPriceDecimals: NORMALIZED_DECIMALS,
    tierPriceMinor: machine.tierPriceMinor,
  };
}

function entryCreateInput(snapshotId: string, entry: PreparedGachaInventoryEntry) {
  return {
    assetReference: entry.assetReference,
    displayName: entry.displayName,
    eligible: entry.eligible,
    exclusionReasons: entry.exclusionReasons,
    graded: entry.graded,
    graderReference: entry.graderReference,
    id: createId('gachaentry'),
    insuredValueCurrency: entry.insuredValue?.currency ?? null,
    insuredValueDecimals: entry.insuredValue?.decimals ?? null,
    insuredValueMinor: entry.insuredValue?.amount ?? null,
    insuredValueProviderReference: entry.insuredValue?.providerReference ?? null,
    inventorySourceTimestamp: entry.inventorySourceTimestamp,
    ordinal: entry.ordinal,
    poolOpen: entry.poolOpen,
    providerCardReference: entry.providerCardReference,
    snapshotId,
    sport: databaseSport(entry.sport),
    tierEnabled: entry.tierEnabled,
    valuationSourceReference: entry.valuationSourceReference,
    valuationTimestamp: entry.insuredValue?.sourceTimestamp ?? null,
    vaulted: entry.vaulted,
  };
}

function hashableEntry(entry: PreparedGachaInventoryEntry) {
  return {
    ...entry,
    insuredValue: entry.insuredValue
      ? {
          ...entry.insuredValue,
          sourceTimestamp: entry.insuredValue.sourceTimestamp.toISOString(),
        }
      : null,
    inventorySourceTimestamp: entry.inventorySourceTimestamp.toISOString(),
  };
}

function databaseSport(sport: SportsPackGachaSport): GachaSport {
  return {
    baseball: GachaSport.BASEBALL,
    basketball: GachaSport.BASKETBALL,
    football: GachaSport.FOOTBALL,
    soccer: GachaSport.SOCCER,
  }[sport];
}

function requireSport(value: SportsPackGachaSport): SportsPackGachaSport {
  if (!['baseball', 'basketball', 'football', 'soccer'].includes(value)) {
    throw new ConflictException('sport is invalid');
  }
  return value;
}

function requireKey(value: string, field: string): string {
  if (typeof value !== 'string') throw new ConflictException(`${field} is invalid`);
  const canonical = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(canonical)) {
    throw new ConflictException(`${field} is invalid`);
  }
  return canonical;
}

function optionalReference(value: string | undefined, field: string): string | null {
  if (value === undefined || value === '') return null;
  return requireReference(value, field);
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

function requireDisplayName(value: string, field: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim() !== value ||
    value.length > 160 ||
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

function requireBoolean(value: boolean, field: string): boolean {
  if (typeof value !== 'boolean') throw new ConflictException(`${field} is invalid`);
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
