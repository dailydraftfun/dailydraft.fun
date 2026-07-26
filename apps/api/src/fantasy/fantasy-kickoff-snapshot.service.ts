import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseClient, Prisma } from '@dailydraft/db';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { acquireNamespacedAdvisoryTransactionLock } from '../database/advisory-lock.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  FANTASY_RULES_VERSION_PATTERN,
  FANTASY_SOLANA_ADDRESS_PATTERN,
  type FantasyPosition,
  type FantasySport,
  isFantasyPosition,
  isFantasySport,
} from './fantasy-domain.js';

export const FANTASY_KICKOFF_SCHEMA_VERSION = 'dailydraft.fantasy-kickoff.v1';

// Distinct advisory-lock namespace so kickoff sealing never contends with the
// flip inventory snapshot lock (1_584_503_769).
const FANTASY_KICKOFF_LOCK_NAMESPACE = 1_732_004_611;
const MAX_ENTRIES = 5_000;
const MAX_REFERENCE_LENGTH = 240;
const MAX_ELIGIBLE_SHARES = 1_000_000_000;

export interface FantasyKickoffHolding {
  custodyReference: string;
  eligibleShares: number;
  playerId: string;
  position: FantasyPosition;
  walletAddress: string;
}

export interface FantasyKickoffPolicy {
  minimumEligibleShares: number;
  policyVersion: string;
  sport: FantasySport;
  tournamentReference: string;
}

export interface PrepareFantasyKickoffSnapshotInput {
  evaluatedAt: Date;
  holdings: readonly FantasyKickoffHolding[];
  kickoffAt: Date;
  policy: FantasyKickoffPolicy;
  tournamentId: string;
}

interface CanonicalPolicy {
  minimumEligibleShares: number;
  policyVersion: string;
  sport: FantasySport;
  tournamentReference: string;
}

interface PreparedEntry {
  custodyReference: string;
  eligibleShares: number;
  lockedAt: Date;
  ordinal: number;
  playerId: string;
  position: FantasyPosition;
  walletAddress: string;
}

export interface PreparedFantasyKickoffSnapshot {
  contentHash: string;
  eligibleShareTotal: string;
  entries: PreparedEntry[];
  entryCount: number;
  evaluatedAt: Date;
  kickoffAt: Date;
  playerCount: number;
  policy: CanonicalPolicy;
  policyHash: string;
  tournamentId: string;
}

@Injectable()
export class FantasyKickoffSnapshotService {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  async createFixtureSnapshot(input: PrepareFantasyKickoffSnapshotInput): Promise<{
    contentHash: string;
    created: boolean;
    id: string;
    revision: number;
    tournamentId: string;
  }> {
    if (!fantasyKickoffFixtureModeEnabled()) {
      throw new ServiceUnavailableException(
        'Fantasy kickoff snapshots are disabled outside explicit fixture or preview mode',
      );
    }
    const prepared = prepareFantasyKickoffSnapshot(input);
    return this.database.$transaction(async (transaction) => {
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        prepared.tournamentId,
        FANTASY_KICKOFF_LOCK_NAMESPACE,
      );
      const existing = await transaction.fantasyKickoffSnapshot.findUnique({
        select: { contentHash: true, id: true, revision: true, sealedAt: true, tournamentId: true },
        where: {
          tournamentId_contentHash: {
            contentHash: prepared.contentHash,
            tournamentId: prepared.tournamentId,
          },
        },
      });
      if (existing) {
        if (!existing.sealedAt) {
          throw new ServiceUnavailableException('Fantasy kickoff snapshot is not sealed');
        }
        return {
          contentHash: existing.contentHash,
          created: false,
          id: existing.id,
          revision: existing.revision,
          tournamentId: existing.tournamentId,
        };
      }

      const latest = await transaction.fantasyKickoffSnapshot.findFirst({
        orderBy: { revision: 'desc' },
        select: { revision: true },
        where: { tournamentId: prepared.tournamentId },
      });
      const id = createId('fankick');
      const revision = (latest?.revision ?? 0) + 1;
      await transaction.fantasyKickoffSnapshot.create({
        data: {
          contentHash: prepared.contentHash,
          createdAt: new Date(),
          eligibleShareTotal: prepared.eligibleShareTotal,
          entryCount: prepared.entryCount,
          evaluatedAt: prepared.evaluatedAt,
          id,
          kickoffAt: prepared.kickoffAt,
          playerCount: prepared.playerCount,
          policy: prepared.policy as unknown as Prisma.InputJsonValue,
          policyHash: prepared.policyHash,
          policyVersion: prepared.policy.policyVersion,
          revision,
          schemaVersion: FANTASY_KICKOFF_SCHEMA_VERSION,
          tournamentId: prepared.tournamentId,
        },
      });
      await transaction.fantasyKickoffSnapshotEntry.createMany({
        data: prepared.entries.map((entry) => ({
          custodyReference: entry.custodyReference,
          eligibleShares: entry.eligibleShares,
          id: createId('fankickentry'),
          lockedAt: entry.lockedAt,
          ordinal: entry.ordinal,
          playerId: entry.playerId,
          position: entry.position,
          snapshotId: id,
          walletAddress: entry.walletAddress,
        })),
      });
      const sealed = await transaction.fantasyKickoffSnapshot.updateMany({
        data: { sealedAt: new Date() },
        where: { id, sealedAt: null },
      });
      if (sealed.count !== 1) {
        throw new ServiceUnavailableException('Fantasy kickoff snapshot could not be sealed');
      }
      return {
        contentHash: prepared.contentHash,
        created: true,
        id,
        revision,
        tournamentId: prepared.tournamentId,
      };
    });
  }
}

export function prepareFantasyKickoffSnapshot(
  input: PrepareFantasyKickoffSnapshotInput,
): PreparedFantasyKickoffSnapshot {
  const tournamentId = requireReference(input.tournamentId, 'tournamentId');
  const kickoffAt = requireDate(input.kickoffAt, 'kickoffAt');
  const evaluatedAt = requireDate(input.evaluatedAt, 'evaluatedAt');
  const policy = canonicalPolicy(input.policy);

  if (!Array.isArray(input.holdings) || input.holdings.length === 0) {
    throw new ConflictException('Fantasy kickoff snapshot requires locked holdings');
  }
  if (input.holdings.length > MAX_ENTRIES) {
    throw new ConflictException(`Fantasy kickoff snapshot exceeds ${MAX_ENTRIES} holdings`);
  }

  const custodyReferences = new Set<string>();
  const players = new Set<string>();
  let eligibleShareTotal = 0n;

  const holdings = input.holdings.map((holding) => {
    const canonical = canonicalHolding(holding, policy.minimumEligibleShares);
    if (custodyReferences.has(canonical.custodyReference)) {
      throw new ConflictException(
        'Fantasy kickoff snapshot contains a duplicate custody reference',
      );
    }
    custodyReferences.add(canonical.custodyReference);
    players.add(canonical.playerId);
    eligibleShareTotal += BigInt(canonical.eligibleShares);
    return canonical;
  });

  holdings.sort((left, right) => compareCanonical(left.custodyReference, right.custodyReference));
  const entries: PreparedEntry[] = holdings.map((holding, ordinal) => ({
    ...holding,
    lockedAt: kickoffAt,
    ordinal,
  }));

  const policyHash = sha256(policy);
  const contentHash = sha256({
    entries: entries.map((entry) => ({
      custodyReference: entry.custodyReference,
      eligibleShares: entry.eligibleShares,
      lockedAt: entry.lockedAt.toISOString(),
      ordinal: entry.ordinal,
      playerId: entry.playerId,
      position: entry.position,
      walletAddress: entry.walletAddress,
    })),
    evaluatedAt: evaluatedAt.toISOString(),
    kickoffAt: kickoffAt.toISOString(),
    policyHash,
    schemaVersion: FANTASY_KICKOFF_SCHEMA_VERSION,
    tournamentId,
  });

  return {
    contentHash,
    eligibleShareTotal: eligibleShareTotal.toString(),
    entries,
    entryCount: entries.length,
    evaluatedAt,
    kickoffAt,
    playerCount: players.size,
    policy,
    policyHash,
    tournamentId,
  };
}

export function fantasyKickoffFixtureModeEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.DAILYDRAFT_FANTASY_FIXTURE_MODE !== 'true') return false;
  if (environment.VERCEL_ENV === 'production') return false;
  return (
    environment.NODE_ENV === 'test' ||
    environment.NODE_ENV === 'development' ||
    environment.VERCEL_ENV === 'preview'
  );
}

function canonicalPolicy(input: FantasyKickoffPolicy): CanonicalPolicy {
  if (!input || typeof input !== 'object') {
    throw new ConflictException('Fantasy kickoff policy is required');
  }
  if (
    typeof input.policyVersion !== 'string' ||
    !FANTASY_RULES_VERSION_PATTERN.test(input.policyVersion)
  ) {
    throw new ConflictException('Fantasy kickoff policyVersion is invalid');
  }
  if (!isFantasySport(input.sport)) {
    throw new ConflictException('Fantasy kickoff policy sport is invalid');
  }
  return {
    minimumEligibleShares: requireInteger(
      input.minimumEligibleShares,
      'minimumEligibleShares',
      1,
      MAX_ELIGIBLE_SHARES,
    ),
    policyVersion: input.policyVersion,
    sport: input.sport,
    tournamentReference: requireReference(input.tournamentReference, 'tournamentReference'),
  };
}

function canonicalHolding(
  holding: FantasyKickoffHolding,
  minimumEligibleShares: number,
): PreparedEntry {
  if (!holding || typeof holding !== 'object') {
    throw new ConflictException('Fantasy kickoff holding is invalid');
  }
  if (
    typeof holding.walletAddress !== 'string' ||
    !FANTASY_SOLANA_ADDRESS_PATTERN.test(holding.walletAddress)
  ) {
    throw new ConflictException('Fantasy kickoff holding wallet address is invalid');
  }
  if (!isFantasyPosition(holding.position)) {
    throw new ConflictException('Fantasy kickoff holding position is invalid');
  }
  const eligibleShares = requireInteger(
    holding.eligibleShares,
    'eligibleShares',
    minimumEligibleShares,
    MAX_ELIGIBLE_SHARES,
  );
  return {
    custodyReference: requireReference(holding.custodyReference, 'custodyReference'),
    eligibleShares,
    lockedAt: new Date(0),
    ordinal: 0,
    playerId: requireReference(holding.playerId, 'playerId'),
    position: holding.position,
    walletAddress: holding.walletAddress,
  };
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
