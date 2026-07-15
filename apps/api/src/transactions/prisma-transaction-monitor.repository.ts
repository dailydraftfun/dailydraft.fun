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
  type TransactionDuelAnalytics,
  TransactionMonitorRepository,
} from './transaction-monitor.repository.js';
import type {
  ExpectedAccountConstraint,
  MonitoredTransaction,
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
      if (
        transaction.submissionIdempotencyKey === input.idempotencyKey &&
        transaction.signature === input.signature &&
        ACTIVE_STATUSES.has(transaction.status)
      ) {
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
      if (transaction.duel.status !== transaction.expectedFromStatus) {
        throw new ConflictException('Duel state does not match the transaction intent');
      }
      if (
        !canTransition(
          toApiStatus(transaction.expectedFromStatus),
          toApiStatus(transaction.expectedToStatus),
        ) ||
        !isTransactionTransition(
          transaction.action.toLowerCase(),
          toApiStatus(transaction.expectedFromStatus),
          toApiStatus(transaction.expectedToStatus),
        )
      ) {
        throw new ConflictException('Transaction intent contains an invalid duel transition');
      }

      const submittedAt = new Date();
      const updated = await database.duelTransaction.updateMany({
        data: {
          nextCheckAt: submittedAt,
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
      const target = recoveryStatusAfterTransactionFailure(fromStatus);
      if (!target || !canTransition(fromStatus, target)) return;
      const targetStatus = toDatabaseStatus(target);
      const changed = await database.duel.updateMany({
        data: { status: targetStatus, version: { increment: 1 } },
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
          type: 'duel.transaction_terminal',
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
        !canTransition(from, to) ||
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
