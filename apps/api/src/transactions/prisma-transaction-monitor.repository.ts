import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type DatabaseClient,
  DuelMode as DatabaseDuelMode,
  DuelStatus as DatabaseDuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
  type Prisma,
} from '@openpacksduel/db';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import type { DuelStatus } from '../domain.js';
import {
  canTransition,
  isTransactionTransition,
  recoveryStatusAfterTransactionFailure,
} from '../duels/duel-state.js';
import {
  type BindSubmissionInput,
  type BoundSubmission,
  type ParticipantReconciliationBatch,
  type TransactionDuelAnalytics,
  TransactionMonitorRepository,
} from './transaction-monitor.repository.js';
import type {
  ExpectedAccountConstraint,
  MonitoredTransaction,
  PreparedRecoveryIntent,
  RecoveryAlertCode,
} from './transaction-monitor.types.js';

const ACTIVE_STATUS_VALUES: DuelTransactionStatus[] = [
  DuelTransactionStatus.SUBMITTED,
  DuelTransactionStatus.CONFIRMED,
];
const ACTIVE_STATUSES = new Set<DuelTransactionStatus>(ACTIVE_STATUS_VALUES);

@Injectable()
export class PrismaTransactionMonitorRepository extends TransactionMonitorRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {
    super();
  }

  async bindSubmission(input: BindSubmissionInput): Promise<BoundSubmission> {
    return this.database.$transaction(async (database) => {
      const transaction = await database.duelTransaction.findUnique({
        include: { duel: true },
        where: { id: input.transactionId },
      });
      if (!transaction || transaction.duelId !== input.duelId) {
        throw new NotFoundException(`Transaction ${input.transactionId} was not found`);
      }
      if (isIdempotentSubmissionReplay(transaction, input)) {
        return toBoundSubmission(transaction.id, transaction.duelId, input.signature);
      }
      if (
        transaction.submissionIdempotencyKey &&
        transaction.submissionIdempotencyKey === input.idempotencyKey
      ) {
        throw new ConflictException('Idempotency-Key was already used with another signature');
      }
      if (transaction.status !== DuelTransactionStatus.PREPARED) {
        throw new ConflictException('Only a prepared transaction can record a submission');
      }
      if (transaction.action === DuelTransactionAction.OPEN_PACK) {
        throw new ConflictException('Pack-provider transaction monitoring is not enabled');
      }
      if (
        !transaction.expectedSigner ||
        !transaction.expectedProgramId ||
        !transaction.expectedMessageHash ||
        !transaction.expectedFromStatus ||
        !transaction.expectedToStatus ||
        !parseExpectedAccounts(transaction.expectedAccounts) ||
        !transaction.expectedInstructionDataHash ||
        !parseExpectedAccounts(transaction.expectedInstructionAccounts) ||
        !transaction.recentBlockhash ||
        transaction.lastValidBlockHeight === null
      ) {
        throw new ConflictException(
          'Transaction intent is missing required verification constraints',
        );
      }
      if (transaction.expectedProgramId !== input.requiredProgramId) {
        throw new ConflictException(
          'Transaction intent does not target the configured escrow program',
        );
      }
      if (transaction.wallet !== transaction.expectedSigner) {
        throw new ConflictException('Prepared transaction wallet does not match expected signer');
      }
      assertWalletSubmissionActor({
        ...(input.actorWallet ? { actorWallet: input.actorWallet } : {}),
        creatorWallet: transaction.duel.creatorWallet,
        expectedSigner: transaction.expectedSigner,
        opponentWallet: transaction.duel.opponentWallet,
        transactionWallet: transaction.wallet,
      });
      const instructionAccounts = parseExpectedAccounts(transaction.expectedInstructionAccounts);
      if (
        !instructionAccounts?.some(
          (account) => account.address === transaction.expectedSigner && account.isSigner === true,
        )
      ) {
        throw new ConflictException('Expected signer is not bound to the target instruction');
      }
      let duelStatus = transaction.duel.status;
      let recoveryEventRecorded = false;
      if (shouldEnterCommittingOnCreatorSubmission(transaction)) {
        const metadata = parseFundingSubmissionMetadata(transaction.metadata);
        if (!metadata) {
          throw new ConflictException('Funding intent is missing escrow submission metadata');
        }
        const changed = await database.duel.updateMany({
          data: {
            escrowAddress: metadata.escrowAddress,
            status: DatabaseDuelStatus.COMMITTING,
            version: { increment: 1 },
          },
          where: {
            id: transaction.duel.id,
            status: DatabaseDuelStatus.MATCHED,
            version: transaction.duel.version,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException('Duel changed during creator submission');
        }
        await database.duelEvent.create({
          data: {
            actorWallet: transaction.wallet,
            data: {
              escrowAddress: metadata.escrowAddress,
              feeAmountLamports: metadata.feeAmountLamports,
              feeAsset: 'WSOL',
              signature: input.signature,
              ...(input.recovery ? { submissionSource: 'rpc-discovery' } : {}),
              transactionId: transaction.id,
            },
            duelId: transaction.duel.id,
            fromStatus: DatabaseDuelStatus.MATCHED,
            id: createId('evt'),
            sequence: transaction.duel.version + 1,
            toStatus: DatabaseDuelStatus.COMMITTING,
            type: input.recovery
              ? 'duel.transaction_submission_recovered'
              : 'duel.funding_submitted',
          },
        });
        duelStatus = DatabaseDuelStatus.COMMITTING;
        recoveryEventRecorded = input.recovery === true;
      }
      if (duelStatus !== transaction.expectedFromStatus) {
        throw new ConflictException('Duel state does not match the transaction intent');
      }
      if (
        (!canTransition(
          toApiStatus(transaction.expectedFromStatus),
          toApiStatus(transaction.expectedToStatus),
        ) &&
          transaction.expectedFromStatus !== transaction.expectedToStatus) ||
        !isTransactionTransition(
          transaction.action.toLowerCase(),
          toApiStatus(transaction.expectedFromStatus),
          toApiStatus(transaction.expectedToStatus),
        )
      ) {
        throw new ConflictException('Transaction intent contains an invalid duel transition');
      }

      const submittedAt = new Date();
      if (input.recovery && !recoveryEventRecorded) {
        const changed = await database.duel.updateMany({
          data: { version: { increment: 1 } },
          where: {
            id: transaction.duel.id,
            status: duelStatus,
            version: transaction.duel.version,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException('Duel changed during recovered submission binding');
        }
        await database.duelEvent.create({
          data: {
            actorWallet: transaction.wallet,
            data: {
              signature: input.signature,
              submissionSource: 'rpc-discovery',
              transactionId: transaction.id,
            },
            duelId: transaction.duel.id,
            fromStatus: duelStatus,
            id: createId('evt'),
            sequence: transaction.duel.version + 1,
            toStatus: duelStatus,
            type: 'duel.transaction_submission_recovered',
          },
        });
      }
      const updated = await database.duelTransaction.updateMany({
        data: {
          ...(input.recovery ? { lastRecoveryCheckedAt: submittedAt } : {}),
          nextCheckAt: submittedAt,
          nextRecoveryCheckAt: null,
          recoveryAlertCode: null,
          recoveryCandidateAt: null,
          recoveryCandidateSignature: null,
          recoveredAt: input.recovery ? submittedAt : null,
          signature: input.signature,
          status: DuelTransactionStatus.SUBMITTED,
          submissionIdempotencyKey: input.idempotencyKey,
          submittedAt,
        },
        where: { id: transaction.id, status: DuelTransactionStatus.PREPARED },
      });
      if (updated.count !== 1)
        throw new ConflictException('Transaction state changed during submit');
      return toBoundSubmission(transaction.id, transaction.duelId, input.signature);
    });
  }

  async bindRecoveredSubmission(input: {
    duelId: string;
    requiredProgramId: string;
    signature: string;
    transactionId: string;
  }): Promise<BoundSubmission> {
    return this.bindSubmission({
      ...input,
      idempotencyKey: recoveredSubmissionKey(input.transactionId, input.signature),
      recovery: true,
    });
  }

  async findPending(limit: number, now: Date): Promise<MonitoredTransaction[]> {
    const rows = await this.database.duelTransaction.findMany({
      include: { duel: { select: { status: true } } },
      orderBy: [{ nextCheckAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      where: {
        OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
        signature: { not: null },
        status: { in: ACTIVE_STATUS_VALUES },
      },
    });
    return rows.flatMap((row) => {
      const expectedAccounts = parseExpectedAccounts(row.expectedAccounts);
      const expectedInstructionAccounts = parseExpectedAccounts(row.expectedInstructionAccounts);
      if (
        !row.signature ||
        !row.submittedAt ||
        !row.expectedSigner ||
        !row.expectedProgramId ||
        !row.expectedMessageHash ||
        !expectedAccounts ||
        !row.expectedInstructionDataHash ||
        !expectedInstructionAccounts ||
        !row.expectedFromStatus ||
        !row.expectedToStatus
      ) {
        return [];
      }
      return [
        {
          action: row.action.toLowerCase() as MonitoredTransaction['action'],
          allowMultipleInstructionMatches: row.allowMultipleInstructionMatches,
          checkAttempts: row.checkAttempts,
          duelId: row.duelId,
          duelStatus: toApiStatus(row.duel.status),
          expectedAccounts,
          expectedInstructionAccounts,
          expectedInstructionDataHash: row.expectedInstructionDataHash,
          expectedMessageHash: row.expectedMessageHash,
          expectedFromStatus: toApiStatus(row.expectedFromStatus),
          expectedProgramId: row.expectedProgramId,
          expectedSigner: row.expectedSigner,
          expectedToStatus: toApiStatus(row.expectedToStatus),
          id: row.id,
          lastValidBlockHeight: row.lastValidBlockHeight,
          recentBlockhash: row.recentBlockhash,
          signature: row.signature,
          status: row.status === DuelTransactionStatus.CONFIRMED ? 'confirmed' : 'submitted',
          submittedAt: row.submittedAt,
          wallet: row.wallet,
        },
      ];
    });
  }

  async findParticipantReconciliationBatch(input: {
    actorWallet?: string;
    duelId: string;
  }): Promise<ParticipantReconciliationBatch> {
    const duel = await this.database.duel.findUnique({
      select: { creatorWallet: true, opponentWallet: true, status: true },
      where: { id: input.duelId },
    });
    if (!duel) throw new NotFoundException(`Duel ${input.duelId} was not found`);
    assertDuelReconciliationActor({
      ...(input.actorWallet ? { actorWallet: input.actorWallet } : {}),
      creatorWallet: duel.creatorWallet,
      opponentWallet: duel.opponentWallet,
    });

    const rows = await this.database.duelTransaction.findMany({
      include: { duel: { select: { status: true } } },
      orderBy: [{ createdAt: 'asc' }],
      take: 20,
      where: {
        duelId: input.duelId,
        signature: { not: null },
        status: { in: ACTIVE_STATUS_VALUES },
      },
    });
    const transactions: MonitoredTransaction[] = rows.flatMap((row) => {
      const expectedAccounts = parseExpectedAccounts(row.expectedAccounts);
      const expectedInstructionAccounts = parseExpectedAccounts(row.expectedInstructionAccounts);
      if (
        !row.signature ||
        !row.submittedAt ||
        !row.expectedSigner ||
        !row.expectedProgramId ||
        !row.expectedMessageHash ||
        !expectedAccounts ||
        !row.expectedInstructionDataHash ||
        !expectedInstructionAccounts ||
        !row.expectedFromStatus ||
        !row.expectedToStatus
      ) {
        return [];
      }
      return [
        {
          action: row.action.toLowerCase() as MonitoredTransaction['action'],
          allowMultipleInstructionMatches: row.allowMultipleInstructionMatches,
          checkAttempts: row.checkAttempts,
          duelId: row.duelId,
          duelStatus: toApiStatus(row.duel.status),
          expectedAccounts,
          expectedFromStatus: toApiStatus(row.expectedFromStatus),
          expectedInstructionAccounts,
          expectedInstructionDataHash: row.expectedInstructionDataHash,
          expectedMessageHash: row.expectedMessageHash,
          expectedProgramId: row.expectedProgramId,
          expectedSigner: row.expectedSigner,
          expectedToStatus: toApiStatus(row.expectedToStatus),
          id: row.id,
          lastValidBlockHeight: row.lastValidBlockHeight,
          recentBlockhash: row.recentBlockhash,
          signature: row.signature,
          status: row.status === DuelTransactionStatus.CONFIRMED ? 'confirmed' : 'submitted',
          submittedAt: row.submittedAt,
          wallet: row.wallet,
        },
      ];
    });
    if (transactions.length !== rows.length) {
      throw new ConflictException('Active transaction lacks required verification constraints');
    }
    return {
      duelId: input.duelId,
      duelStatus: toApiStatus(duel.status),
      transactions,
    };
  }

  async findPreparedForRecovery(
    limit: number,
    preparedAfter: Date,
    now: Date,
  ): Promise<PreparedRecoveryIntent[]> {
    const rows = await this.database.duelTransaction.findMany({
      include: {
        duel: {
          select: {
            creatorWallet: true,
            opponentWallet: true,
            status: true,
          },
        },
      },
      orderBy: [{ nextRecoveryCheckAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      where: {
        action: DuelTransactionAction.FUND,
        createdAt: { gte: preparedAfter },
        OR: [{ nextRecoveryCheckAt: null }, { nextRecoveryCheckAt: { lte: now } }],
        recoveredAt: null,
        signature: null,
        status: DuelTransactionStatus.PREPARED,
      },
    });

    return rows.flatMap((row) => {
      const expectedAccounts = parseExpectedAccounts(row.expectedAccounts);
      const expectedInstructionAccounts = parseExpectedAccounts(row.expectedInstructionAccounts);
      const metadata = parseFundingSubmissionMetadata(row.metadata);
      if (
        !row.expectedSigner ||
        row.expectedSigner !== row.wallet ||
        ![row.duel.creatorWallet, row.duel.opponentWallet].includes(row.wallet) ||
        !row.expectedProgramId ||
        !row.expectedMessageHash ||
        !expectedAccounts ||
        !row.expectedInstructionDataHash ||
        !expectedInstructionAccounts ||
        !row.expectedFromStatus ||
        !row.expectedToStatus ||
        row.expectedFromStatus !== DatabaseDuelStatus.COMMITTING ||
        row.expectedToStatus !== DatabaseDuelStatus.FUNDED ||
        !row.serializedTransaction ||
        !row.recentBlockhash ||
        row.lastValidBlockHeight === null ||
        !metadata ||
        !containsWritableAddress(expectedAccounts, metadata.escrowAddress) ||
        !containsWritableAddress(expectedInstructionAccounts, metadata.escrowAddress) ||
        !expectedInstructionAccounts.some(
          (account) => account.address === row.expectedSigner && account.isSigner === true,
        )
      ) {
        return [];
      }

      return [
        {
          action: 'fund' as const,
          allowMultipleInstructionMatches: row.allowMultipleInstructionMatches,
          checkAttempts: row.checkAttempts,
          duelId: row.duelId,
          duelStatus: toApiStatus(row.duel.status),
          escrowAddress: metadata.escrowAddress,
          expectedAccounts,
          expectedFromStatus: toApiStatus(row.expectedFromStatus),
          expectedInstructionAccounts,
          expectedInstructionDataHash: row.expectedInstructionDataHash,
          expectedMessageHash: row.expectedMessageHash,
          expectedProgramId: row.expectedProgramId,
          expectedSigner: row.expectedSigner,
          expectedToStatus: toApiStatus(row.expectedToStatus),
          id: row.id,
          lastValidBlockHeight: row.lastValidBlockHeight,
          preparedAt: row.createdAt,
          recentBlockhash: row.recentBlockhash,
          recoveryCheckAttempts: row.recoveryCheckAttempts,
          wallet: row.wallet,
        },
      ];
    });
  }

  async recordRecoveryAttempt(
    transactionId: string,
    now: Date,
    nextRecoveryCheckAt: Date,
  ): Promise<void> {
    await this.database.duelTransaction.updateMany({
      data: {
        lastRecoveryCheckedAt: now,
        nextRecoveryCheckAt,
        recoveryCheckAttempts: { increment: 1 },
      },
      where: {
        id: transactionId,
        signature: null,
        status: DuelTransactionStatus.PREPARED,
      },
    });
  }

  async recordRecoveryAlert(input: {
    code: RecoveryAlertCode;
    nextRecoveryCheckAt: Date;
    now: Date;
    signature: string;
    transactionId: string;
  }): Promise<void> {
    await this.database.$transaction(async (database) => {
      const monitored = await database.duelTransaction.findUnique({
        include: { duel: true },
        where: { id: input.transactionId },
      });
      if (
        !monitored ||
        monitored.signature ||
        monitored.status !== DuelTransactionStatus.PREPARED
      ) {
        return;
      }
      const isReplay =
        monitored.recoveryAlertCode === input.code &&
        monitored.recoveryCandidateSignature === input.signature;
      const metadata = parseFundingSubmissionMetadata(monitored.metadata);
      const routing = recoveryAlertRouting({
        currentStatus: monitored.duel.status,
        storedEscrowAddress: monitored.duel.escrowAddress,
        validatedEscrowAddress: metadata?.escrowAddress ?? null,
      });
      await database.duelTransaction.update({
        data: {
          lastRecoveryCheckedAt: input.now,
          nextRecoveryCheckAt: input.nextRecoveryCheckAt,
          recoveryAlertCode: input.code,
          recoveryCandidateAt: monitored.recoveryCandidateAt ?? input.now,
          recoveryCandidateSignature: input.signature,
          recoveryCheckAttempts: { increment: 1 },
        },
        where: { id: monitored.id },
      });
      if (isReplay && routing.targetStatus === monitored.duel.status) return;
      const changed = await database.duel.updateMany({
        data: {
          escrowAddress: routing.escrowAddress,
          status: routing.targetStatus,
          version: { increment: 1 },
        },
        where: {
          id: monitored.duel.id,
          status: monitored.duel.status,
          version: monitored.duel.version,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('Duel changed during recovery alert recording');
      }
      await database.duelEvent.create({
        data: {
          data: {
            action: 'fund',
            code: input.code,
            escrowConflict: routing.escrowConflict,
            signature: input.signature,
            transactionId: monitored.id,
          },
          duelId: monitored.duel.id,
          fromStatus: monitored.duel.status,
          id: createId('evt'),
          sequence: monitored.duel.version + 1,
          toStatus: routing.targetStatus,
          type:
            routing.targetStatus === DatabaseDuelStatus.REFUNDING
              ? 'duel.unbound_funding_recovery_started'
              : 'duel.transaction_recovery_alert',
        },
      });
    });
  }

  async getDuelAnalytics(duelId: string): Promise<TransactionDuelAnalytics | null> {
    const duel = await this.database.duel.findUnique({
      select: { mode: true, stakeAmount: true, stakeDecimals: true, status: true },
      where: { id: duelId },
    });
    if (!duel) return null;
    return {
      mode:
        duel.mode === DatabaseDuelMode.DIRECT
          ? 'direct'
          : duel.mode === DatabaseDuelMode.HOUSE
            ? 'house'
            : 'open',
      status: toApiStatus(duel.status),
      tier: Number(duel.stakeAmount) / 10 ** duel.stakeDecimals,
    };
  }

  async recordConfirmed(transactionId: string, now: Date, nextCheckAt: Date): Promise<void> {
    await this.database.$transaction(async (database) => {
      const current = await database.duelTransaction.findUnique({ where: { id: transactionId } });
      if (!current || !ACTIVE_STATUSES.has(current.status)) return;
      await database.duelTransaction.update({
        data: {
          checkAttempts: { increment: 1 },
          confirmationStatus: 'confirmed',
          confirmedAt: current.confirmedAt ?? now,
          lastCheckedAt: now,
          nextCheckAt,
          status: DuelTransactionStatus.CONFIRMED,
        },
        where: { id: transactionId },
      });
    });
  }

  async recordPending(
    transactionId: string,
    now: Date,
    nextCheckAt: Date,
    markStuck: boolean,
  ): Promise<void> {
    await this.database.$transaction(async (database) => {
      const current = await database.duelTransaction.findUnique({ where: { id: transactionId } });
      if (!current || !ACTIVE_STATUSES.has(current.status)) return;
      await database.duelTransaction.update({
        data: {
          checkAttempts: { increment: 1 },
          ...(markStuck
            ? {
                errorCode: 'RECONCILIATION_STUCK',
                errorMessage: 'Transaction confirmation exceeded the service threshold',
                stuckAt: current.stuckAt ?? now,
              }
            : {}),
          lastCheckedAt: now,
          nextCheckAt,
        },
        where: { id: transactionId },
      });
    });
  }

  async recordTerminal(
    transactionId: string,
    status: 'expired' | 'failed',
    code: string,
    now: Date,
  ): Promise<void> {
    await this.database.$transaction(async (database) => {
      const monitored = await database.duelTransaction.findUnique({
        include: { duel: true },
        where: { id: transactionId },
      });
      if (!monitored || !ACTIVE_STATUSES.has(monitored.status)) return;
      const transactionStatus =
        status === 'expired' ? DuelTransactionStatus.EXPIRED : DuelTransactionStatus.FAILED;
      await database.duelTransaction.update({
        data: {
          checkAttempts: { increment: 1 },
          errorCode: code,
          errorMessage:
            status === 'expired'
              ? 'Transaction expired before finalization'
              : 'Transaction failed verification or execution on Solana devnet',
          lastCheckedAt: now,
          nextCheckAt: null,
          status: transactionStatus,
        },
        where: { id: monitored.id },
      });

      const fromStatus = toApiStatus(monitored.duel.status);
      const target = recoveryStatusForTerminalTransaction({
        action: monitored.action,
        creatorWallet: monitored.duel.creatorWallet,
        fromStatus,
        wallet: monitored.wallet,
      });
      if (!target || !canTransition(fromStatus, target)) return;
      const targetStatus = toDatabaseStatus(target);
      const changed = await database.duel.updateMany({
        data: {
          ...(targetStatus === DatabaseDuelStatus.CANCELLED
            ? { cancellationReason: `creator_funding_${status}` }
            : {}),
          status: targetStatus,
          version: { increment: 1 },
        },
        where: {
          id: monitored.duel.id,
          status: monitored.duel.status,
          version: monitored.duel.version,
        },
      });
      if (changed.count !== 1) throw new ConflictException('Duel changed during recovery');
      await database.duelEvent.create({
        data: {
          data: { action: monitored.action.toLowerCase(), code, transactionId },
          duelId: monitored.duel.id,
          fromStatus: monitored.duel.status,
          id: createId('evt'),
          sequence: monitored.duel.version + 1,
          toStatus: targetStatus,
          type:
            targetStatus === DatabaseDuelStatus.CANCELLED
              ? 'duel.creator_funding_terminal'
              : 'duel.transaction_terminal',
        },
      });
    });
  }

  async recordFinalized(transactionId: string, now: Date): Promise<boolean> {
    return this.database.$transaction(async (database) => {
      const monitored = await database.duelTransaction.findUnique({
        include: { duel: true },
        where: { id: transactionId },
      });
      if (!monitored) return false;
      if (monitored.status === DuelTransactionStatus.FINALIZED) return monitored.errorCode === null;
      if (!ACTIVE_STATUSES.has(monitored.status)) return false;
      if (!monitored.expectedFromStatus || !monitored.expectedToStatus) {
        await rejectFinalization(database, monitored.id, now, 'MISSING_INTENT_CONSTRAINTS');
        return false;
      }
      const from = toApiStatus(monitored.expectedFromStatus);
      const to = toApiStatus(monitored.expectedToStatus);
      if (
        monitored.duel.status !== monitored.expectedFromStatus ||
        (!canTransition(from, to) && from !== to) ||
        !isTransactionTransition(monitored.action.toLowerCase(), from, to)
      ) {
        await rejectFinalization(database, monitored.id, now, 'DUEL_STATE_MISMATCH');
        return false;
      }
      if (monitored.action === DuelTransactionAction.FUND) {
        return finalizeFundingSide(database, monitored, now);
      }
      const changed = await database.duel.updateMany({
        data: {
          ...(monitored.expectedToStatus === DatabaseDuelStatus.FUNDED ? { fundedAt: now } : {}),
          ...(monitored.expectedToStatus === DatabaseDuelStatus.SETTLED ? { settledAt: now } : {}),
          status: monitored.expectedToStatus,
          version: { increment: 1 },
        },
        where: {
          id: monitored.duel.id,
          status: monitored.expectedFromStatus,
          version: monitored.duel.version,
        },
      });
      if (changed.count !== 1) throw new ConflictException('Duel changed during finalization');
      await database.duelTransaction.update({
        data: {
          checkAttempts: { increment: 1 },
          confirmationStatus: 'finalized',
          confirmedAt: monitored.confirmedAt ?? now,
          errorCode: null,
          errorMessage: null,
          finalizedAt: now,
          lastCheckedAt: now,
          nextCheckAt: null,
          status: DuelTransactionStatus.FINALIZED,
        },
        where: { id: monitored.id },
      });
      await database.duelEvent.create({
        data: {
          data: {
            action: monitored.action.toLowerCase(),
            confirmationStatus: 'finalized',
            signature: monitored.signature,
            transactionId: monitored.id,
          },
          duelId: monitored.duel.id,
          fromStatus: monitored.expectedFromStatus,
          id: createId('evt'),
          sequence: monitored.duel.version + 1,
          toStatus: monitored.expectedToStatus,
          type: 'duel.transaction_finalized',
        },
      });
      return true;
    });
  }
}

async function finalizeFundingSide(
  database: Prisma.TransactionClient,
  monitored: FundingTransactionRecord,
  now: Date,
): Promise<boolean> {
  const finalized = await database.duelTransaction.findMany({
    select: { id: true, wallet: true },
    where: {
      action: DuelTransactionAction.FUND,
      duelId: monitored.duelId,
      id: { not: monitored.id },
      status: DuelTransactionStatus.FINALIZED,
    },
  });
  const quorum = resolveFundingQuorum({
    creatorWallet: monitored.duel.creatorWallet,
    currentAlreadyFinalized: false,
    currentWallet: monitored.wallet,
    finalizedWallets: finalized.map((transaction) => transaction.wallet),
    opponentWallet: monitored.duel.opponentWallet,
  });
  if (quorum === 'invalid') {
    const target = DatabaseDuelStatus.REFUNDING;
    const changed = await database.duel.updateMany({
      data: { status: target, version: { increment: 1 } },
      where: {
        id: monitored.duel.id,
        status: DatabaseDuelStatus.COMMITTING,
        version: monitored.duel.version,
      },
    });
    if (changed.count !== 1) throw new ConflictException('Duel changed during funding recovery');
    await markFinalizedTransaction(database, monitored, now, 'FUNDING_QUORUM_INVALID');
    await database.duelEvent.create({
      data: {
        data: {
          action: 'fund',
          code: 'FUNDING_QUORUM_INVALID',
          transactionId: monitored.id,
        },
        duelId: monitored.duel.id,
        fromStatus: monitored.duel.status,
        id: createId('evt'),
        sequence: monitored.duel.version + 1,
        toStatus: target,
        type: 'duel.funding_quorum_invalid',
      },
    });
    return false;
  }

  const target = quorum === 'complete' ? DatabaseDuelStatus.FUNDED : DatabaseDuelStatus.COMMITTING;
  const changed = await database.duel.updateMany({
    data: {
      ...(target === DatabaseDuelStatus.FUNDED ? { fundedAt: now } : {}),
      status: target,
      version: { increment: 1 },
    },
    where: {
      id: monitored.duel.id,
      status: DatabaseDuelStatus.COMMITTING,
      version: monitored.duel.version,
    },
  });
  if (changed.count !== 1) throw new ConflictException('Duel changed during funding finalization');
  await markFinalizedTransaction(database, monitored, now);
  await database.duelEvent.create({
    data: {
      data: {
        action: 'fund',
        confirmationStatus: 'finalized',
        finalizedSides: quorum === 'complete' ? 2 : 1,
        requiredSides: 2,
        signature: monitored.signature,
        transactionId: monitored.id,
        wallet: monitored.wallet,
      },
      duelId: monitored.duel.id,
      fromStatus: monitored.duel.status,
      id: createId('evt'),
      sequence: monitored.duel.version + 1,
      toStatus: target,
      type: quorum === 'complete' ? 'duel.funding_finalized' : 'duel.funding_side_finalized',
    },
  });
  return true;
}

async function markFinalizedTransaction(
  database: Prisma.TransactionClient,
  monitored: {
    confirmedAt: Date | null;
    id: string;
  },
  now: Date,
  errorCode: string | null = null,
): Promise<void> {
  await database.duelTransaction.update({
    data: {
      checkAttempts: { increment: 1 },
      confirmationStatus: 'finalized',
      confirmedAt: monitored.confirmedAt ?? now,
      errorCode,
      errorMessage: errorCode ? 'Finalized funding transaction did not satisfy quorum' : null,
      finalizedAt: now,
      lastCheckedAt: now,
      nextCheckAt: null,
      status: DuelTransactionStatus.FINALIZED,
    },
    where: { id: monitored.id },
  });
}

export type FundingQuorum = 'complete' | 'idempotent' | 'invalid' | 'pending';

export function resolveFundingQuorum(input: {
  creatorWallet: string;
  currentAlreadyFinalized: boolean;
  currentWallet: string;
  finalizedWallets: string[];
  opponentWallet: string | null;
}): FundingQuorum {
  if (input.currentAlreadyFinalized) return 'idempotent';
  if (!input.opponentWallet || input.creatorWallet === input.opponentWallet) return 'invalid';
  const participants = new Set([input.creatorWallet, input.opponentWallet]);
  if (!participants.has(input.currentWallet)) return 'invalid';
  if (input.finalizedWallets.some((wallet) => !participants.has(wallet))) return 'invalid';
  if (new Set(input.finalizedWallets).size !== input.finalizedWallets.length) return 'invalid';
  if (input.finalizedWallets.includes(input.currentWallet)) return 'invalid';
  const finalizedParticipants = new Set([...input.finalizedWallets, input.currentWallet]);
  return finalizedParticipants.size === 2 &&
    finalizedParticipants.has(input.creatorWallet) &&
    finalizedParticipants.has(input.opponentWallet)
    ? 'complete'
    : 'pending';
}

interface FundingTransactionRecord {
  confirmedAt: Date | null;
  duel: {
    creatorWallet: string;
    id: string;
    opponentWallet: string | null;
    status: DatabaseDuelStatus;
    version: number;
  };
  duelId: string;
  id: string;
  signature: string | null;
  wallet: string;
}

async function rejectFinalization(
  database: Prisma.TransactionClient,
  transactionId: string,
  now: Date,
  code: string,
): Promise<void> {
  await database.duelTransaction.update({
    data: {
      checkAttempts: { increment: 1 },
      errorCode: code,
      errorMessage: 'Transaction could not advance the duel state',
      lastCheckedAt: now,
      nextCheckAt: null,
      status: DuelTransactionStatus.FAILED,
    },
    where: { id: transactionId },
  });
}

function parseExpectedAccounts(value: Prisma.JsonValue | null): ExpectedAccountConstraint[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed: ExpectedAccountConstraint[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (typeof item.address !== 'string') return null;
    if (item.isSigner !== undefined && typeof item.isSigner !== 'boolean') return null;
    if (item.isWritable !== undefined && typeof item.isWritable !== 'boolean') return null;
    parsed.push({
      address: item.address,
      ...(typeof item.isSigner === 'boolean' ? { isSigner: item.isSigner } : {}),
      ...(typeof item.isWritable === 'boolean' ? { isWritable: item.isWritable } : {}),
    });
  }
  return parsed;
}

function parseFundingSubmissionMetadata(
  value: Prisma.JsonValue | null,
): { escrowAddress: string; feeAmountLamports: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.escrowAddress !== 'string' || typeof value.feeAmountLamports !== 'string') {
    return null;
  }
  return { escrowAddress: value.escrowAddress, feeAmountLamports: value.feeAmountLamports };
}

function containsWritableAddress(
  constraints: ExpectedAccountConstraint[],
  address: string,
): boolean {
  return constraints.some(
    (constraint) => constraint.address === address && constraint.isWritable === true,
  );
}

function recoveredSubmissionKey(transactionId: string, signature: string): string {
  return `rpc-recovery:${transactionId}:${signature}`;
}

export function recoveryAlertTarget(status: DatabaseDuelStatus): DatabaseDuelStatus {
  const recoverableStatuses = new Set<DatabaseDuelStatus>([
    DatabaseDuelStatus.MATCHED,
    DatabaseDuelStatus.COMMITTING,
    DatabaseDuelStatus.FUNDED,
    DatabaseDuelStatus.OPENING,
    DatabaseDuelStatus.AWAITING_ASSETS,
    DatabaseDuelStatus.SETTLING,
    DatabaseDuelStatus.CANCELLING,
    DatabaseDuelStatus.CANCELLED,
    DatabaseDuelStatus.FAILED,
  ]);
  if (recoverableStatuses.has(status)) {
    return DatabaseDuelStatus.REFUNDING;
  }
  return status;
}

export function recoveryAlertRouting(input: {
  currentStatus: DatabaseDuelStatus;
  storedEscrowAddress: string | null;
  validatedEscrowAddress: string | null;
}): {
  escrowAddress: string | null;
  escrowConflict: boolean;
  targetStatus: DatabaseDuelStatus;
} {
  const targetStatus = recoveryAlertTarget(input.currentStatus);
  if (targetStatus !== DatabaseDuelStatus.REFUNDING) {
    return {
      escrowAddress: input.storedEscrowAddress,
      escrowConflict: false,
      targetStatus,
    };
  }
  const escrowConflict =
    !input.validatedEscrowAddress ||
    (Boolean(input.storedEscrowAddress) &&
      input.storedEscrowAddress !== input.validatedEscrowAddress);
  if (escrowConflict) {
    return {
      escrowAddress: input.storedEscrowAddress,
      escrowConflict: true,
      targetStatus: input.currentStatus,
    };
  }
  return {
    escrowAddress: input.validatedEscrowAddress,
    escrowConflict: false,
    targetStatus,
  };
}

function toBoundSubmission(
  transactionId: string,
  duelId: string,
  signature: string,
): BoundSubmission {
  return { duelId, signature, status: 'submitted', transactionId };
}

function toApiStatus(status: DatabaseDuelStatus): DuelStatus {
  return status.toLowerCase() as DuelStatus;
}

function toDatabaseStatus(status: DuelStatus): DatabaseDuelStatus {
  const mapped = Object.values(DatabaseDuelStatus).find(
    (candidate) => candidate.toLowerCase() === status,
  );
  if (!mapped) throw new ConflictException(`Unsupported duel status ${status}`);
  return mapped;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function assertWalletSubmissionActor(input: {
  actorWallet?: string;
  creatorWallet: string;
  expectedSigner: string;
  opponentWallet: string | null;
  transactionWallet: string;
}): void {
  if (!input.actorWallet) return;
  if (
    input.actorWallet !== input.transactionWallet ||
    input.actorWallet !== input.expectedSigner ||
    ![input.creatorWallet, input.opponentWallet].includes(input.actorWallet)
  ) {
    throw new ForbiddenException(
      'Wallet session cannot submit a transaction for another signer or duel participant',
    );
  }
}

export function assertDuelReconciliationActor(input: {
  actorWallet?: string;
  creatorWallet: string;
  opponentWallet: string | null;
}): void {
  if (!input.actorWallet) return;
  if (![input.creatorWallet, input.opponentWallet].includes(input.actorWallet)) {
    throw new ForbiddenException('Wallet session cannot reconcile another duel');
  }
}

export function isIdempotentSubmissionReplay(
  transaction: {
    signature: string | null;
    status: DuelTransactionStatus;
    submissionIdempotencyKey: string | null;
  },
  input: { idempotencyKey: string; signature: string },
): boolean {
  return (
    transaction.submissionIdempotencyKey === input.idempotencyKey &&
    transaction.signature === input.signature &&
    ACTIVE_STATUSES.has(transaction.status)
  );
}

export function shouldEnterCommittingOnCreatorSubmission(input: {
  action: DuelTransactionAction;
  duel: { creatorWallet: string; status: DatabaseDuelStatus };
  expectedFromStatus: DatabaseDuelStatus | null;
  wallet: string;
}): boolean {
  return (
    input.action === DuelTransactionAction.FUND &&
    input.wallet === input.duel.creatorWallet &&
    input.duel.status === DatabaseDuelStatus.MATCHED &&
    input.expectedFromStatus === DatabaseDuelStatus.COMMITTING
  );
}

export function recoveryStatusForTerminalTransaction(input: {
  action: DuelTransactionAction;
  creatorWallet: string;
  fromStatus: DuelStatus;
  wallet: string;
}): DuelStatus | null {
  if (input.action === DuelTransactionAction.REFUND && input.fromStatus === 'refunding') {
    return null;
  }
  if (
    input.action === DuelTransactionAction.FUND &&
    input.wallet === input.creatorWallet &&
    input.fromStatus === 'committing'
  ) {
    return 'cancelled';
  }
  return recoveryStatusAfterTransactionFailure(input.fromStatus);
}
