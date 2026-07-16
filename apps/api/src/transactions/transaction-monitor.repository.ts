import type { DuelStatus } from '../domain.js';
import type {
  MonitoredTransaction,
  PreparedRecoveryIntent,
  RecoveryAlertCode,
} from './transaction-monitor.types.js';

export interface ParticipantReconciliationBatch {
  duelId: string;
  duelStatus: DuelStatus;
  transactions: MonitoredTransaction[];
}

export interface TransactionDuelAnalytics {
  mode: 'direct' | 'house' | 'open';
  status: DuelStatus;
  tier: number;
}

export interface BindSubmissionInput {
  actorWallet?: string;
  duelId: string;
  idempotencyKey: string;
  requiredProgramId: string;
  signature: string;
  transactionId: string;
  recovery?: boolean;
}

export interface BoundSubmission {
  duelId: string;
  signature: string;
  status: 'submitted';
  transactionId: string;
}

export abstract class TransactionMonitorRepository {
  abstract bindSubmission(input: BindSubmissionInput): Promise<BoundSubmission>;
  abstract bindRecoveredSubmission(input: {
    duelId: string;
    requiredProgramId: string;
    signature: string;
    transactionId: string;
  }): Promise<BoundSubmission>;
  abstract findPending(limit: number, now: Date): Promise<MonitoredTransaction[]>;
  abstract findParticipantReconciliationBatch(input: {
    actorWallet?: string;
    duelId: string;
  }): Promise<ParticipantReconciliationBatch>;
  abstract findPreparedForRecovery(
    limit: number,
    preparedAfter: Date,
    now: Date,
  ): Promise<PreparedRecoveryIntent[]>;
  abstract recordRecoveryAttempt(
    transactionId: string,
    now: Date,
    nextRecoveryCheckAt: Date,
    checkedBlockHeight?: bigint,
  ): Promise<void>;
  abstract recordRecoveryAlert(input: {
    code: RecoveryAlertCode;
    nextRecoveryCheckAt: Date;
    now: Date;
    signature: string;
    transactionId: string;
  }): Promise<void>;
  getDuelAnalytics(_duelId: string): Promise<TransactionDuelAnalytics | null> {
    return Promise.resolve(null);
  }
  abstract recordConfirmed(transactionId: string, now: Date, nextCheckAt: Date): Promise<void>;
  abstract recordFinalized(transactionId: string, now: Date): Promise<boolean>;
  abstract recordPending(
    transactionId: string,
    now: Date,
    nextCheckAt: Date,
    markStuck: boolean,
  ): Promise<void>;
  abstract recordTerminal(
    transactionId: string,
    status: 'expired' | 'failed',
    code: string,
    now: Date,
  ): Promise<void>;
}
