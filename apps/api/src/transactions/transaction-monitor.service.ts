import {
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AnalyticsService } from '../analytics/analytics.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { HouseTreasuryService } from '../treasury/house-treasury.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DevnetRefundOrchestratorService } from './devnet-refund-orchestrator.service.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway, SolanaRpcUnavailableError } from './solana-rpc.client.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import {
  type PreparedRecoveryScope,
  TransactionMonitorRepository,
} from './transaction-monitor.repository.js';
import type {
  DuelReconciliationResult,
  MonitoredTransaction,
  PreparedRecoveryIntent,
  ReconciliationSummary,
  SolanaAddressSignature,
  SolanaSignatureStatus,
  SolanaTransactionEnvelope,
} from './transaction-monitor.types.js';
import { TransactionVerificationError, verifyTransactionEnvelope } from './transaction-verifier.js';

const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 100;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_STUCK_THRESHOLD_MS = 10 * 60 * 1_000;
const DEFAULT_RECOVERY_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RECOVERY_SIGNATURE_LIMIT = 10;
const DEFAULT_RECOVERY_INTENT_BUDGET = 20;
const DEFAULT_RECOVERY_CANDIDATE_BUDGET = 50;
const DEFAULT_RECOVERY_RETRY_MS = 60_000;
const MAX_RECOVERY_RETRY_MS = 60 * 60 * 1_000;
const RECOVERY_BLOCK_TIME_SKEW_MS = 2 * 60 * 1_000;
const RECOVERY_FINALITY_BLOCK_BUFFER = 64n;

@Injectable()
export class TransactionMonitorService {
  constructor(
    private readonly repository: TransactionMonitorRepository,
    private readonly rpc: SolanaRpcGateway,
    @Optional() private readonly analytics?: AnalyticsService,
    @Optional() private readonly treasury?: HouseTreasuryService,
    @Optional() private readonly refunds?: DevnetRefundOrchestratorService,
  ) {}

  async bindSubmission(input: {
    actorWallet?: string;
    duelId: string;
    idempotencyKey: string;
    signature: string;
    transactionId: string;
  }) {
    const requiredProgramId = process.env.ESCROW_PROGRAM_ID?.trim();
    if (!requiredProgramId) {
      throw new ServiceUnavailableException('Escrow program is not configured');
    }
    await this.assertDevnet(input.duelId);
    const submission = await this.repository.bindSubmission({ ...input, requiredProgramId });
    try {
      await this.reconcileDuel({
        ...(input.actorWallet ? { actorWallet: input.actorWallet } : {}),
        duelId: input.duelId,
      });
    } catch (error) {
      if (
        !(error instanceof SolanaRpcUnavailableError) &&
        !(error instanceof ServiceUnavailableException)
      ) {
        throw error;
      }
    }
    return submission;
  }

  async reconcileDuel(input: {
    actorWallet?: string;
    duelId: string;
  }): Promise<DuelReconciliationResult> {
    await this.assertDevnet(input.duelId);
    await this.repository.findParticipantReconciliationBatch(input);
    const now = new Date();
    const recoveryScope: PreparedRecoveryScope = {
      duelId: input.duelId,
      ignoreSchedule: true,
    };
    const summary = emptySummary();
    try {
      await this.recoverUnboundBroadcasts(DEFAULT_BATCH_LIMIT, now, summary, recoveryScope);
    } catch {
      summary.recoveryErrors += 1;
      await this.analytics?.recordServer({
        duelId: input.duelId,
        name: 'solana_rpc_error',
      });
    }
    const batch = await this.repository.findParticipantReconciliationBatch(input);
    await this.reconcileTransactions(batch.transactions, now, summary);
    const current = await this.repository.findParticipantReconciliationBatch(input);
    const remainingUnbound = await this.repository.findPreparedForRecovery(
      recoveryIntentBudget(),
      new Date(now.getTime() - recoveryRetentionMs()),
      now,
      recoveryScope,
    );
    return {
      activeTransactionCount: current.transactions.length,
      duelId: current.duelId,
      duelStatus: current.duelStatus,
      reconciliation: summary,
      unboundTransactionCount: remainingUnbound.length,
    };
  }

  async reconcile(requestedLimit = DEFAULT_BATCH_LIMIT): Promise<ReconciliationSummary> {
    await this.assertDevnet();
    const now = new Date();
    const limit = Math.max(1, Math.min(requestedLimit, MAX_BATCH_LIMIT));
    const summary = emptySummary();
    try {
      await this.recoverUnboundBroadcasts(limit, now, summary);
    } catch {
      summary.recoveryErrors += 1;
      await this.analytics?.recordServer({ name: 'solana_rpc_error' });
    }
    await this.reconcileRefunds(limit, summary);
    const transactions = await this.repository.findPending(limit, now);
    const recoverableTerminal = await this.repository.findRecoverableTerminal(limit);
    if (transactions.length === 0 && recoverableTerminal.length === 0) {
      await this.treasury?.reconcileLifecycle(limit);
      return summary;
    }

    await this.reconcileTransactions(transactions, now, summary);
    await this.reconcileTransactions(recoverableTerminal, now, summary);
    await this.reconcileRefunds(limit, summary);
    await this.treasury?.reconcileLifecycle(limit);
    return summary;
  }

  private async reconcileRefunds(limit: number, summary: ReconciliationSummary): Promise<void> {
    if (!this.refunds || process.env.OPENPACKSDUEL_NETWORK !== 'solana-devnet') return;
    try {
      await this.refunds.reconcile(limit);
    } catch {
      summary.recoveryErrors += 1;
    }
  }

  private async reconcileTransactions(
    transactions: MonitoredTransaction[],
    now: Date,
    summary: ReconciliationSummary,
  ): Promise<void> {
    if (transactions.length === 0) return;
    let statuses: Array<SolanaSignatureStatus | null>;
    try {
      statuses = await this.rpc.getSignatureStatuses(
        transactions.map((transaction) => transaction.signature),
      );
    } catch (error) {
      if (error instanceof SolanaRpcUnavailableError) {
        await this.analytics?.recordServer({ name: 'solana_rpc_error' });
      }
      throw error;
    }
    if (statuses.length !== transactions.length) {
      throw new ServiceUnavailableException('Solana devnet RPC returned an incomplete response');
    }

    let blockHeight: bigint | null = null;
    for (const [index, transaction] of transactions.entries()) {
      summary.checked += 1;
      const status = statuses[index] ?? null;
      try {
        if (status === null && transaction.lastValidBlockHeight !== null) {
          blockHeight ??= await this.rpc.getBlockHeight();
        }
        if (
          status === null &&
          transaction.lastValidBlockHeight !== null &&
          blockHeight !== null &&
          blockHeight > transaction.lastValidBlockHeight
        ) {
          await this.repository.recordTerminal(transaction.id, 'expired', 'BLOCKHASH_EXPIRED', now);
          summary.expired += 1;
          await this.recordSettlementFailure(transaction);
          continue;
        }
        await this.reconcileOne(transaction, status, now, summary);
      } catch (error) {
        if (error instanceof SolanaRpcUnavailableError) {
          await this.analytics?.recordServer({
            duelId: transaction.duelId,
            name: 'solana_rpc_error',
            status: transaction.duelStatus,
          });
          await this.recordPending(transaction, now, summary);
          continue;
        }
        throw error;
      }
    }
  }

  private async recoverUnboundBroadcasts(
    limit: number,
    now: Date,
    summary: ReconciliationSummary,
    scope?: PreparedRecoveryScope,
  ): Promise<void> {
    const requiredProgramId = process.env.ESCROW_PROGRAM_ID?.trim();
    if (!requiredProgramId) return;
    const preparedAfter = new Date(now.getTime() - recoveryRetentionMs());
    const intents = await this.repository.findPreparedForRecovery(
      Math.min(limit, recoveryIntentBudget()),
      preparedAfter,
      now,
      scope,
    );
    let remainingCandidateBudget = recoveryCandidateBudget();

    for (const intent of intents) {
      summary.recoveryChecked += 1;
      if (intent.expectedProgramId !== requiredProgramId) {
        summary.recoveryRejected += 1;
        await this.repository.recordRecoveryAttempt(
          intent.id,
          now,
          nextRecoveryCheckAt(now, intent.recoveryCheckAttempts),
        );
        continue;
      }
      let checkedBlockHeight: bigint;
      let signatures: SolanaAddressSignature[];
      const signatureLimit = recoverySignatureLimit();
      try {
        checkedBlockHeight = await this.rpc.getBlockHeight();
        signatures = await this.rpc.getFinalizedSignaturesForAddress(
          intent.escrowAddress,
          signatureLimit,
        );
      } catch (error) {
        if (error instanceof SolanaRpcUnavailableError) {
          await this.analytics?.recordServer({
            duelId: intent.duelId,
            name: 'solana_rpc_error',
            status: intent.duelStatus,
          });
        }
        summary.recoveryErrors += 1;
        await this.repository.recordRecoveryAttempt(
          intent.id,
          now,
          nextRecoveryCheckAt(now, intent.recoveryCheckAttempts),
        );
        continue;
      }
      let handled = false;
      let scanComplete = signatures.length < signatureLimit;
      for (const candidate of signatures) {
        if (
          candidate.blockTime !== null &&
          candidate.blockTime * 1_000 < intent.preparedAt.getTime() - RECOVERY_BLOCK_TIME_SKEW_MS
        ) {
          continue;
        }
        if (remainingCandidateBudget === 0) {
          summary.recoveryDeferred += 1;
          await this.repository.recordRecoveryAttempt(
            intent.id,
            now,
            nextRecoveryCheckAt(now, intent.recoveryCheckAttempts),
          );
          handled = true;
          break;
        }
        remainingCandidateBudget -= 1;
        summary.recoveryCandidates += 1;
        let envelope: SolanaTransactionEnvelope | null;
        try {
          envelope = await this.rpc.getTransaction(candidate.signature, 'finalized');
        } catch (error) {
          scanComplete = false;
          summary.recoveryErrors += 1;
          if (error instanceof SolanaRpcUnavailableError) {
            await this.analytics?.recordServer({
              duelId: intent.duelId,
              name: 'solana_rpc_error',
              status: intent.duelStatus,
            });
          }
          continue;
        }
        if (!envelope) {
          scanComplete = false;
          summary.recoveryRejected += 1;
          continue;
        }
        try {
          verifyTransactionEnvelope(
            recoveredMonitoredTransaction(intent, candidate.signature),
            envelope,
          );
        } catch (error) {
          if (!(error instanceof TransactionVerificationError)) throw error;
          summary.recoveryRejected += 1;
          continue;
        }
        if (!canBindRecoveredIntent(intent)) {
          await this.repository.recordRecoveryAlert({
            code: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH',
            nextRecoveryCheckAt: nextRecoveryCheckAt(now, intent.recoveryCheckAttempts),
            now,
            signature: candidate.signature,
            transactionId: intent.id,
          });
          summary.recoveryAlerts += 1;
          handled = true;
          break;
        }
        try {
          await this.repository.bindRecoveredSubmission({
            duelId: intent.duelId,
            requiredProgramId,
            signature: candidate.signature,
            transactionId: intent.id,
          });
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          await this.repository.recordRecoveryAlert({
            code: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH',
            nextRecoveryCheckAt: nextRecoveryCheckAt(now, intent.recoveryCheckAttempts),
            now,
            signature: candidate.signature,
            transactionId: intent.id,
          });
          summary.recoveryAlerts += 1;
          handled = true;
          break;
        }
        summary.recovered += 1;
        handled = true;
        break;
      }
      if (!handled) {
        if (
          scanComplete &&
          intent.lastValidBlockHeight !== null &&
          checkedBlockHeight > intent.lastValidBlockHeight + RECOVERY_FINALITY_BLOCK_BUFFER
        ) {
          await this.repository.recordPreparedRecoveryExpired(intent.id, now);
          summary.expired += 1;
        } else {
          await this.repository.recordRecoveryAttempt(
            intent.id,
            now,
            nextRecoveryCheckAt(now, intent.recoveryCheckAttempts),
            scanComplete ? checkedBlockHeight : undefined,
          );
        }
      }
      if (remainingCandidateBudget === 0) break;
    }
  }

  private async reconcileOne(
    transaction: MonitoredTransaction,
    status: SolanaSignatureStatus | null,
    now: Date,
    summary: ReconciliationSummary,
  ): Promise<void> {
    if (status?.err) {
      await this.repository.recordTerminal(
        transaction.id,
        'failed',
        'TRANSACTION_EXECUTION_ERROR',
        now,
      );
      summary.failed += 1;
      await this.recordSettlementFailure(transaction);
      return;
    }
    if (
      !status ||
      status.confirmationStatus === null ||
      status.confirmationStatus === 'processed'
    ) {
      await this.recordPending(transaction, now, summary);
      return;
    }

    const commitment = status.confirmationStatus;
    const envelope = await this.rpc.getTransaction(transaction.signature, commitment);
    if (!envelope) {
      await this.recordPending(transaction, now, summary);
      return;
    }
    try {
      verifyTransactionEnvelope(transaction, envelope);
    } catch (error) {
      if (!(error instanceof TransactionVerificationError)) throw error;
      await this.repository.recordTerminal(transaction.id, 'failed', error.code, now);
      summary.failed += 1;
      return;
    }

    if (commitment === 'confirmed') {
      await this.repository.recordConfirmed(transaction.id, now, nextCheckAt(now));
      summary.confirmed += 1;
      return;
    }
    const advanced = await this.repository.recordFinalized(transaction.id, now);
    if (advanced) {
      summary.finalized += 1;
      await this.recordFinalizedLifecycle(transaction.duelId);
    } else {
      summary.failed += 1;
      await this.recordSettlementFailure(transaction);
    }
  }

  private async recordPending(
    transaction: MonitoredTransaction,
    now: Date,
    summary: ReconciliationSummary,
  ): Promise<void> {
    const markStuck = now.getTime() - transaction.submittedAt.getTime() >= stuckThresholdMs();
    await this.repository.recordPending(transaction.id, now, nextCheckAt(now), markStuck);
    summary.pending += 1;
    if (markStuck) summary.stuck += 1;
  }

  private async assertDevnet(duelId?: string): Promise<void> {
    try {
      await this.rpc.assertDevnet();
    } catch (error) {
      if (error instanceof SolanaRpcUnavailableError) {
        await this.analytics?.recordServer({
          ...(duelId ? { duelId } : {}),
          name: 'solana_rpc_error',
        });
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }

  private async recordFinalizedLifecycle(duelId: string): Promise<void> {
    const duel = await this.repository.getDuelAnalytics(duelId);
    if (!duel || !['funded', 'refunded', 'settled'].includes(duel.status)) return;
    const name =
      duel.status === 'funded'
        ? 'duel_funded'
        : duel.status === 'refunded'
          ? 'duel_refunded'
          : 'duel_settled';
    await this.analytics?.recordServer({
      duelId,
      mode: duel.mode,
      name,
      status: duel.status,
      tier: duel.tier,
    });
  }

  private async recordSettlementFailure(transaction: MonitoredTransaction): Promise<void> {
    if (transaction.action !== 'settle') return;
    await this.analytics?.recordServer({
      duelId: transaction.duelId,
      name: 'settlement_failed',
      status: transaction.duelStatus,
    });
  }
}

function emptySummary(): ReconciliationSummary {
  return {
    checked: 0,
    confirmed: 0,
    expired: 0,
    failed: 0,
    finalized: 0,
    pending: 0,
    recoveryCandidates: 0,
    recoveryChecked: 0,
    recoveryDeferred: 0,
    recoveryErrors: 0,
    recoveryAlerts: 0,
    recoveryRejected: 0,
    recovered: 0,
    stuck: 0,
  };
}

function recoveredMonitoredTransaction(
  intent: PreparedRecoveryIntent,
  signature: string,
): MonitoredTransaction {
  return {
    ...intent,
    signature,
    status: 'submitted',
    submittedAt: intent.preparedAt,
  };
}

function nextCheckAt(now: Date): Date {
  return new Date(now.getTime() + pollIntervalMs());
}

function pollIntervalMs(): number {
  return boundedInteger(
    process.env.SOLANA_RECONCILIATION_POLL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    1_000,
    60_000,
  );
}

function stuckThresholdMs(): number {
  return boundedInteger(
    process.env.SOLANA_RECONCILIATION_STUCK_MS,
    DEFAULT_STUCK_THRESHOLD_MS,
    60_000,
    24 * 60 * 60 * 1_000,
  );
}

function recoveryRetentionMs(): number {
  return boundedInteger(
    process.env.SOLANA_RECOVERY_RETENTION_MS,
    DEFAULT_RECOVERY_RETENTION_MS,
    60 * 60 * 1_000,
    7 * 24 * 60 * 60 * 1_000,
  );
}

function recoverySignatureLimit(): number {
  return boundedInteger(
    process.env.SOLANA_RECOVERY_SIGNATURE_LIMIT,
    DEFAULT_RECOVERY_SIGNATURE_LIMIT,
    1,
    100,
  );
}

function recoveryIntentBudget(): number {
  return boundedInteger(
    process.env.SOLANA_RECOVERY_INTENT_BUDGET,
    DEFAULT_RECOVERY_INTENT_BUDGET,
    1,
    100,
  );
}

function recoveryCandidateBudget(): number {
  return boundedInteger(
    process.env.SOLANA_RECOVERY_CANDIDATE_BUDGET,
    DEFAULT_RECOVERY_CANDIDATE_BUDGET,
    1,
    500,
  );
}

export function nextRecoveryCheckAt(now: Date, attempts: number): Date {
  const exponent = Math.max(0, Math.min(attempts, 6));
  const delay = Math.min(DEFAULT_RECOVERY_RETRY_MS * 2 ** exponent, MAX_RECOVERY_RETRY_MS);
  return new Date(now.getTime() + delay);
}

export function canBindRecoveredFunding(status: PreparedRecoveryIntent['duelStatus']): boolean {
  return status === 'matched' || status === 'committing';
}

export function canBindRecoveredIntent(intent: PreparedRecoveryIntent): boolean {
  return intent.action === 'fund'
    ? canBindRecoveredFunding(intent.duelStatus)
    : intent.duelStatus === intent.expectedFromStatus;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
}
