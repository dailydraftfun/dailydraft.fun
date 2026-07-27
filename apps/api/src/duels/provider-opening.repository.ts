import { randomUUID } from 'node:crypto';
import {
  type DatabaseClient,
  DuelSide as DatabaseDuelSide,
  DuelStatus as DatabaseDuelStatus,
  DuelProviderOperationStatus,
  type Prisma,
} from '@dailydraft/db';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import type { DuelSide, ProviderResponseEvidence } from '../providers/pack-provider.js';
import { PROVIDER_RESPONSE_EVIDENCE_SCHEMA_VERSION } from '../providers/pack-provider.js';
import type { NormalizedPackOutcome } from '../providers/provider-result.js';
import { assertNormalizedOutcome } from '../providers/provider-result.js';
import { createDuelRgsCommitment } from '../rgs/rgs-duel-contract.js';

const MAX_ERROR_CODE_LENGTH = 120;

export interface ProviderOperationReservation {
  duelId: string;
  generateIdempotencyKey: string;
  openIdempotencyKey: string;
  provider: string;
  providerPackId: string;
  recipientWallet: string;
  side: DuelSide;
}

export interface ProviderOpeningOperation extends ProviderOperationReservation {
  errorCode: string | null;
  evidence: ProviderResponseEvidence | null;
  id: string;
  normalizedOutcome: NormalizedPackOutcome | null;
  providerReference: string | null;
  status: DuelProviderOperationStatus;
}

@Injectable()
export class ProviderOpeningRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  async reservePair(
    reservations: readonly [ProviderOperationReservation, ProviderOperationReservation],
  ): Promise<readonly [ProviderOpeningOperation, ProviderOpeningOperation]> {
    if (
      reservations[0].duelId !== reservations[1].duelId ||
      reservations[0].side === reservations[1].side
    ) {
      throw new ConflictException('Provider opening requires one operation for each duel side');
    }
    return this.database.$transaction(async (transaction) => {
      const duel = await transaction.duel.findUnique({
        select: {
          packId: true,
          providerMode: true,
          rgsCommitmentHash: true,
          rgsConfigHash: true,
          rgsRulesHash: true,
          status: true,
          valuationPolicyHash: true,
        },
        where: { id: reservations[0].duelId },
      });
      if (!duel || duel.status !== DatabaseDuelStatus.OPENING) {
        throw new ConflictException('Provider operations require a duel in opening state');
      }
      await transaction.duelProviderOperation.createMany({
        data: reservations.map((reservation) => ({
          duelId: reservation.duelId,
          generateIdempotencyKey: reservation.generateIdempotencyKey,
          id: createId('providerop'),
          openIdempotencyKey: reservation.openIdempotencyKey,
          provider: reservation.provider,
          providerPackId: reservation.providerPackId,
          recipientWallet: reservation.recipientWallet,
          side: toDatabaseSide(reservation.side),
        })),
        skipDuplicates: true,
      });
      const rows = await transaction.duelProviderOperation.findMany({
        orderBy: { side: 'asc' },
        where: { duelId: reservations[0].duelId },
      });
      if (rows.length !== 2) {
        throw new ServiceUnavailableException('Provider operation pair is incomplete');
      }
      const operations = rows.map(toOperation);
      for (const reservation of reservations) {
        const operation = operations.find((candidate) => candidate.side === reservation.side);
        if (!operation || !sameReservation(operation, reservation)) {
          throw new ConflictException('Provider operation replay changed its committed request');
        }
      }
      if (!duel.valuationPolicyHash) {
        throw new ConflictException('Provider operations require a committed valuation policy');
      }
      const rgsCommitment = createDuelRgsCommitment({
        duelId: reservations[0].duelId,
        operations,
        packId: duel.packId,
        providerMode: duel.providerMode,
        rulesHash: duel.valuationPolicyHash,
      });
      const persistedRgsFields = [duel.rgsCommitmentHash, duel.rgsConfigHash, duel.rgsRulesHash];
      if (
        persistedRgsFields.some((value) => value !== null) &&
        (duel.rgsCommitmentHash !== rgsCommitment.commitmentHash ||
          duel.rgsConfigHash !== rgsCommitment.configHash ||
          duel.rgsRulesHash !== rgsCommitment.rulesHash)
      ) {
        throw new ConflictException('Provider operation replay changed its RGS commitment');
      }
      await transaction.duel.update({
        data: {
          rgsCommitmentHash: rgsCommitment.commitmentHash,
          rgsConfigHash: rgsCommitment.configHash,
          rgsRulesHash: rgsCommitment.rulesHash,
        },
        where: { id: reservations[0].duelId },
      });
      return operations as [ProviderOpeningOperation, ProviderOpeningOperation];
    });
  }

  async recordGenerated(
    operationId: string,
    providerReference: string,
  ): Promise<ProviderOpeningOperation> {
    const current = await this.require(operationId);
    if (current.providerReference) {
      if (current.providerReference !== providerReference) {
        throw new ConflictException('Provider generate replay returned a different reference');
      }
      return current;
    }
    const updated = await this.database.duelProviderOperation.updateMany({
      data: {
        errorCode: null,
        providerReference,
        status: DuelProviderOperationStatus.GENERATED,
      },
      where: {
        id: operationId,
        providerReference: null,
        status: {
          in: [
            DuelProviderOperationStatus.REQUESTED,
            DuelProviderOperationStatus.RECOVERY_REQUIRED,
          ],
        },
      },
    });
    if (updated.count !== 1) {
      return this.requireCompatibleReference(operationId, providerReference);
    }
    return this.require(operationId);
  }

  async markOpening(operationId: string): Promise<ProviderOpeningOperation> {
    const current = await this.require(operationId);
    if (
      current.status === DuelProviderOperationStatus.OPENED ||
      current.status === DuelProviderOperationStatus.OPENING
    ) {
      return current;
    }
    if (!current.providerReference) {
      throw new ConflictException('Provider operation has no committed reference');
    }
    const updated = await this.database.duelProviderOperation.updateMany({
      data: { errorCode: null, status: DuelProviderOperationStatus.OPENING },
      where: {
        id: operationId,
        providerReference: current.providerReference,
        status: {
          in: [
            DuelProviderOperationStatus.GENERATED,
            DuelProviderOperationStatus.RECOVERY_REQUIRED,
          ],
        },
      },
    });
    if (updated.count !== 1) return this.require(operationId);
    return this.require(operationId);
  }

  async recordOpened(input: {
    evidence: ProviderResponseEvidence;
    normalizedOutcome: NormalizedPackOutcome;
    operationId: string;
    providerReference: string;
  }): Promise<ProviderOpeningOperation> {
    assertNormalizedOutcome(input.normalizedOutcome);
    const current = await this.require(input.operationId);
    if (current.status === DuelProviderOperationStatus.OPENED) {
      if (
        current.providerReference !== input.providerReference ||
        current.normalizedOutcome?.resultHash !== input.normalizedOutcome.resultHash ||
        !sameEvidence(current.evidence, input.evidence)
      ) {
        throw new ConflictException('Opened provider evidence replay does not match');
      }
      return current;
    }
    if (current.providerReference !== input.providerReference) {
      throw new ConflictException('Provider result does not match the committed reference');
    }
    const updated = await this.database.duelProviderOperation.updateMany({
      data: {
        assetReference: input.normalizedOutcome.assetReference,
        errorCode: null,
        normalizedOutcome: input.normalizedOutcome as unknown as Prisma.InputJsonValue,
        payloadHash: input.evidence.payloadHash,
        rawPayload: input.evidence.rawPayload,
        resultHash: input.normalizedOutcome.resultHash,
        signature: input.evidence.signature,
        signatureAlgorithm: input.evidence.signatureAlgorithm,
        signingKeyReference: input.evidence.signingKeyReference,
        status: DuelProviderOperationStatus.OPENED,
      },
      where: {
        id: input.operationId,
        providerReference: input.providerReference,
        status: {
          in: [
            DuelProviderOperationStatus.GENERATED,
            DuelProviderOperationStatus.OPENING,
            DuelProviderOperationStatus.RECOVERY_REQUIRED,
          ],
        },
      },
    });
    if (updated.count !== 1) {
      const replay = await this.require(input.operationId);
      if (
        replay.status === DuelProviderOperationStatus.OPENED &&
        replay.providerReference === input.providerReference &&
        replay.normalizedOutcome?.resultHash === input.normalizedOutcome.resultHash &&
        sameEvidence(replay.evidence, input.evidence)
      ) {
        return replay;
      }
      throw new ConflictException('Provider operation changed while evidence was recorded');
    }
    return this.require(input.operationId);
  }

  async markRecovery(operationId: string, errorCode: string): Promise<ProviderOpeningOperation> {
    const boundedErrorCode = errorCode.trim().slice(0, MAX_ERROR_CODE_LENGTH);
    if (!boundedErrorCode) {
      throw new ConflictException('Provider recovery requires a bounded error code');
    }
    await this.database.duelProviderOperation.updateMany({
      data: {
        errorCode: boundedErrorCode,
        status: DuelProviderOperationStatus.RECOVERY_REQUIRED,
      },
      where: { id: operationId, status: { not: DuelProviderOperationStatus.OPENED } },
    });
    return this.require(operationId);
  }

  private async require(operationId: string): Promise<ProviderOpeningOperation> {
    const row = await this.database.duelProviderOperation.findUnique({
      where: { id: operationId },
    });
    if (!row) throw new ServiceUnavailableException('Provider operation is unavailable');
    return toOperation(row);
  }

  private async requireCompatibleReference(
    operationId: string,
    providerReference: string,
  ): Promise<ProviderOpeningOperation> {
    const current = await this.require(operationId);
    if (current.providerReference !== providerReference) {
      throw new ConflictException('Provider generate replay returned a different reference');
    }
    return current;
  }
}

function sameEvidence(
  persisted: ProviderResponseEvidence | null,
  incoming: ProviderResponseEvidence,
): boolean {
  return (
    persisted !== null &&
    persisted.rawPayload === incoming.rawPayload &&
    persisted.payloadHash === incoming.payloadHash &&
    persisted.signature === incoming.signature &&
    persisted.signatureAlgorithm === incoming.signatureAlgorithm &&
    persisted.signingKeyReference === incoming.signingKeyReference
  );
}

type ProviderOperationRow = NonNullable<
  Awaited<ReturnType<DatabaseClient['duelProviderOperation']['findUnique']>>
>;

function toOperation(row: NonNullable<ProviderOperationRow>): ProviderOpeningOperation {
  const normalizedOutcome = persistedOutcome(row.normalizedOutcome, row.resultHash);
  const evidence = persistedEvidence(row);
  if (
    (row.status === DuelProviderOperationStatus.OPENED && (!normalizedOutcome || !evidence)) ||
    (row.status !== DuelProviderOperationStatus.OPENED &&
      (normalizedOutcome !== null || evidence !== null))
  ) {
    throw new ServiceUnavailableException('Provider operation lifecycle evidence is inconsistent');
  }
  return {
    duelId: row.duelId,
    errorCode: row.errorCode,
    evidence,
    generateIdempotencyKey: row.generateIdempotencyKey,
    id: row.id,
    normalizedOutcome,
    openIdempotencyKey: row.openIdempotencyKey,
    provider: row.provider,
    providerPackId: row.providerPackId,
    providerReference: row.providerReference,
    recipientWallet: row.recipientWallet,
    side: row.side === DatabaseDuelSide.CREATOR ? 'creator' : 'opponent',
    status: row.status,
  };
}

function persistedEvidence(
  row: NonNullable<ProviderOperationRow>,
): ProviderResponseEvidence | null {
  const values = [
    row.rawPayload,
    row.payloadHash,
    row.signature,
    row.signatureAlgorithm,
    row.signingKeyReference,
  ];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new ServiceUnavailableException('Provider operation evidence is incomplete');
  }
  return {
    payloadHash: row.payloadHash as string,
    rawPayload: row.rawPayload as string,
    schemaVersion: PROVIDER_RESPONSE_EVIDENCE_SCHEMA_VERSION,
    signature: row.signature as string,
    signatureAlgorithm: row.signatureAlgorithm as string,
    signingKeyReference: row.signingKeyReference as string,
  };
}

function persistedOutcome(value: Prisma.JsonValue | null, resultHash: string | null) {
  if (value === null) {
    if (resultHash !== null) {
      throw new ServiceUnavailableException('Provider operation lost its normalized outcome');
    }
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceUnavailableException('Provider operation outcome is malformed');
  }
  const outcome = value as unknown as NormalizedPackOutcome;
  assertNormalizedOutcome(outcome);
  if (outcome.resultHash !== resultHash) {
    throw new ServiceUnavailableException('Provider operation outcome hash is inconsistent');
  }
  return outcome;
}

function sameReservation(
  operation: ProviderOpeningOperation,
  reservation: ProviderOperationReservation,
): boolean {
  return (
    operation.duelId === reservation.duelId &&
    operation.generateIdempotencyKey === reservation.generateIdempotencyKey &&
    operation.openIdempotencyKey === reservation.openIdempotencyKey &&
    operation.provider === reservation.provider &&
    operation.providerPackId === reservation.providerPackId &&
    operation.recipientWallet === reservation.recipientWallet &&
    operation.side === reservation.side
  );
}

function toDatabaseSide(side: DuelSide): DatabaseDuelSide {
  return side === 'creator' ? DatabaseDuelSide.CREATOR : DatabaseDuelSide.OPPONENT;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}
