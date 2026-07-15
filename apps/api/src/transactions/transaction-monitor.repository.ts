import type { MonitoredTransaction } from './transaction-monitor.types.js';

export interface BindSubmissionInput {
  actorWallet?: string;
  duelId: string;
  idempotencyKey: string;
  requiredProgramId: string;
  signature: string;
  transactionId: string;
}

export interface BoundSubmission {
  duelId: string;
  signature: string;
  status: 'submitted';
  transactionId: string;
}

export abstract class TransactionMonitorRepository {
  abstract bindSubmission(input: BindSubmissionInput): Promise<BoundSubmission>;
  abstract findPending(limit: number, now: Date): Promise<MonitoredTransaction[]>;
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
