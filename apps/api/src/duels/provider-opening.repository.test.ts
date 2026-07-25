import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { DatabaseClient, Prisma } from '@dailydraft/db';
import { DuelProviderOperationStatus, type DuelSide, DuelStatus } from '@dailydraft/db';

import type { ProviderResponseEvidence } from '../providers/pack-provider.js';
import { createProviderResponseEvidence } from '../providers/provider-response-evidence.js';
import { normalizeProviderResult } from '../providers/provider-result.js';
import { CANONICAL_VALUATION_POLICY_HASH, stableStringify } from '../providers/valuation-policy.js';
import {
  ProviderOpeningRepository,
  type ProviderOperationReservation,
} from './provider-opening.repository.js';

describe('ProviderOpeningRepository', () => {
  test('commits both immutable recipient requests and replays their lifecycle', async () => {
    const database = new FixtureDatabase();
    const repository = new ProviderOpeningRepository(database as unknown as DatabaseClient);
    const reservations = reservationPair();

    const first = await repository.reservePair(reservations);
    const replay = await repository.reservePair(reservations);

    expect(replay.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    expect(database.operations).toHaveLength(2);
    expect(database.operations.map(({ recipientWallet }) => recipientWallet)).toEqual([
      'escrow_fixture',
      'escrow_fixture',
    ]);

    const creator = first.find((operation) => operation.side === 'creator');
    if (!creator) throw new Error('Missing creator operation');
    const generated = await repository.recordGenerated(creator.id, 'provider_creator');
    expect(await repository.recordGenerated(creator.id, 'provider_creator')).toEqual(generated);
    await expect(repository.recordGenerated(creator.id, 'provider_changed')).rejects.toThrow(
      'different reference',
    );
    expect((await repository.markOpening(creator.id)).status).toBe(
      DuelProviderOperationStatus.OPENING,
    );
    expect((await repository.markOpening(creator.id)).status).toBe(
      DuelProviderOperationStatus.OPENING,
    );

    const opened = openedInput('creator', creator.id, 'provider_creator');
    database.concurrentOpenedReplay = true;
    const recorded = await repository.recordOpened(opened);
    const openedReplay = await repository.recordOpened(opened);

    expect(recorded).toMatchObject({
      errorCode: null,
      normalizedOutcome: expect.objectContaining({
        assetReference: 'asset_creator',
        providerReference: 'provider_creator',
      }),
      status: DuelProviderOperationStatus.OPENED,
    });
    expect(openedReplay).toEqual(recorded);
    expect(await repository.markRecovery(creator.id, 'late_error')).toEqual(recorded);
  });

  test('records pre-reference and post-reference recovery with the same request keys', async () => {
    const database = new FixtureDatabase();
    const repository = new ProviderOpeningRepository(database as unknown as DatabaseClient);
    const [, opponent] = await repository.reservePair(reservationPair());

    const earlyRecovery = await repository.markRecovery(opponent.id, 'generate_timeout');
    expect(earlyRecovery).toMatchObject({
      errorCode: 'generate_timeout',
      providerReference: null,
      status: DuelProviderOperationStatus.RECOVERY_REQUIRED,
    });
    const generated = await repository.recordGenerated(opponent.id, 'provider_opponent');
    expect(generated).toMatchObject({
      errorCode: null,
      providerReference: 'provider_opponent',
      status: DuelProviderOperationStatus.GENERATED,
    });
    await repository.markRecovery(opponent.id, ` ${'x'.repeat(200)} `);
    const retry = await repository.markOpening(opponent.id);
    expect(retry).toMatchObject({
      errorCode: null,
      openIdempotencyKey: 'duel_fixture:opponent:open',
      providerReference: 'provider_opponent',
      status: DuelProviderOperationStatus.OPENING,
    });
  });

  test('rejects changed reservations, references, and opened replay evidence', async () => {
    const database = new FixtureDatabase();
    const repository = new ProviderOpeningRepository(database as unknown as DatabaseClient);
    const pair = await repository.reservePair(reservationPair());

    await expect(
      repository.reservePair([
        { ...reservationPair()[0], recipientWallet: 'different_escrow' },
        reservationPair()[1],
      ]),
    ).rejects.toThrow('committed request');

    const creator = pair[0];
    await expect(repository.markOpening(creator.id)).rejects.toThrow('no committed reference');
    await repository.recordGenerated(creator.id, 'provider_creator');
    await repository.markOpening(creator.id);
    await repository.recordOpened(openedInput('creator', creator.id, 'provider_creator'));
    await expect(
      repository.recordOpened(openedInput('creator', creator.id, 'provider_other')),
    ).rejects.toThrow('does not match');
    const changedEvidence = openedInput('creator', creator.id, 'provider_creator');
    await expect(
      repository.recordOpened({
        ...changedEvidence,
        evidence: { ...changedEvidence.evidence, signature: 'b'.repeat(64) },
      }),
    ).rejects.toThrow('does not match');
    await expect(repository.markRecovery(pair[1].id, '   ')).rejects.toThrow('bounded error code');
  });
});

describe('provider opening migration contract', () => {
  test('enforces unique sides, evidence completeness, and immutable opened rows', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/prisma/migrations/20260723223000_provider_opening_evidence/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('CREATE TYPE "DuelProviderOperationStatus"');
    expect(migration).toContain('"DuelProviderOperation_duelId_side_key"');
    expect(migration).toContain('"DuelProviderOperation_identity_check"');
    expect(migration).toContain('"DuelProviderOperation_evidence_check"');
    expect(migration).toContain('octet_length("rawPayload") <= 32768');
    expect(migration).toContain('"normalizedOutcome" IS NOT NULL');
    expect(migration).toContain('Duel provider operation identity is immutable');
    expect(migration).toContain('Opened duel provider evidence is immutable');
  });
});

function reservationPair(): readonly [ProviderOperationReservation, ProviderOperationReservation] {
  return [reservation('creator'), reservation('opponent')];
}

function reservation(side: 'creator' | 'opponent'): ProviderOperationReservation {
  return {
    duelId: 'duel_fixture',
    generateIdempotencyKey: `duel_fixture:${side}:generate`,
    openIdempotencyKey: `duel_fixture:${side}:open`,
    provider: 'fixture-provider',
    providerPackId: 'pokemon_50',
    recipientWallet: 'escrow_fixture',
    side,
  };
}

function openedInput(side: 'creator' | 'opponent', operationId: string, providerReference: string) {
  const openedAt = new Date().toISOString();
  const normalizedOutcome = normalizeProviderResult(
    side,
    {
      assetReference: `asset_${side}`,
      displayName: `Fixture ${side}`,
      insuredValue: { amount: side === 'creator' ? '2' : '1', currency: 'USDC', decimals: 6 },
      poolVersion: 'fixture-pool-v1',
      sourceTimestamp: openedAt,
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    },
    CANONICAL_VALUATION_POLICY_HASH,
    providerReference,
    new Date(openedAt),
  );
  const rawPayload = stableStringify({ normalizedOutcome, providerReference });
  const evidence: ProviderResponseEvidence = createProviderResponseEvidence({
    rawPayload,
    signature: 'a'.repeat(64),
    signatureAlgorithm: 'fixture-signature',
    signingKeyReference: 'fixture-key-v1',
  });
  return { evidence, normalizedOutcome, operationId, providerReference };
}

interface StoredOperation {
  assetReference: string | null;
  createdAt: Date;
  duelId: string;
  errorCode: string | null;
  generateIdempotencyKey: string;
  id: string;
  normalizedOutcome: Prisma.JsonValue | null;
  openIdempotencyKey: string;
  payloadHash: string | null;
  provider: string;
  providerPackId: string;
  providerReference: string | null;
  rawPayload: string | null;
  recipientWallet: string;
  resultHash: string | null;
  side: DuelSide;
  signature: string | null;
  signatureAlgorithm: string | null;
  signingKeyReference: string | null;
  status: DuelProviderOperationStatus;
  updatedAt: Date;
}

class FixtureDatabase {
  concurrentOpenedReplay = false;
  operations: StoredOperation[] = [];

  readonly duel = {
    findUnique: async () => ({ status: DuelStatus.OPENING }),
  };

  readonly duelProviderOperation = {
    createMany: async ({ data }: { data: Array<Partial<StoredOperation>> }) => {
      let count = 0;
      for (const candidate of data) {
        const exists = this.operations.some(
          (row) => row.duelId === candidate.duelId && row.side === candidate.side,
        );
        if (exists) continue;
        const now = new Date();
        this.operations.push({
          assetReference: null,
          createdAt: now,
          duelId: String(candidate.duelId),
          errorCode: null,
          generateIdempotencyKey: String(candidate.generateIdempotencyKey),
          id: String(candidate.id),
          normalizedOutcome: null,
          openIdempotencyKey: String(candidate.openIdempotencyKey),
          payloadHash: null,
          provider: String(candidate.provider),
          providerPackId: String(candidate.providerPackId),
          providerReference: null,
          rawPayload: null,
          recipientWallet: String(candidate.recipientWallet),
          resultHash: null,
          side: candidate.side as DuelSide,
          signature: null,
          signatureAlgorithm: null,
          signingKeyReference: null,
          status: DuelProviderOperationStatus.REQUESTED,
          updatedAt: now,
        });
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where }: { where: { duelId: string } }) =>
      this.operations
        .filter((row) => row.duelId === where.duelId)
        .sort((left, right) => left.side.localeCompare(right.side)),
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.operations.find((row) => row.id === where.id) ?? null,
    updateMany: async ({
      data,
      where,
    }: {
      data: Partial<StoredOperation>;
      where: {
        id: string;
        providerReference?: string | null;
        status?: {
          in?: DuelProviderOperationStatus[];
          not?: DuelProviderOperationStatus;
        };
      };
    }) => {
      const operation = this.operations.find((row) => row.id === where.id);
      if (!operation || !matchesWhere(operation, where)) return { count: 0 };
      Object.assign(operation, data, { updatedAt: new Date() });
      if (data.status === DuelProviderOperationStatus.OPENED && this.concurrentOpenedReplay) {
        this.concurrentOpenedReplay = false;
        return { count: 0 };
      }
      return { count: 1 };
    },
  };

  readonly $transaction = async <Result>(
    callback: (transaction: FixtureDatabase) => Promise<Result>,
  ): Promise<Result> => callback(this);
}

function matchesWhere(
  operation: StoredOperation,
  where: {
    providerReference?: string | null;
    status?: {
      in?: DuelProviderOperationStatus[];
      not?: DuelProviderOperationStatus;
    };
  },
): boolean {
  if ('providerReference' in where && operation.providerReference !== where.providerReference) {
    return false;
  }
  if (where.status?.in && !where.status.in.includes(operation.status)) return false;
  if (where.status?.not && operation.status === where.status.not) return false;
  return true;
}
