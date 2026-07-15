import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AnalyticsService } from '../analytics/analytics.service.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway, SolanaRpcUnavailableError } from './solana-rpc.client.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { TransactionMonitorRepository } from './transaction-monitor.repository.js';
import type {
  MonitoredTransaction,
  ReconciliationSummary,
  SolanaSignatureStatus,
} from './transaction-monitor.types.js';
import { TransactionVerificationError, verifyTransactionEnvelope } from './transaction-verifier.js';

const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 100;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_STUCK_THRESHOLD_MS = 10 * 60 * 1_000;

@Injectable()
export class TransactionMonitorService {
  constructor(
    private readonly repository: TransactionMonitorRepository,
    private readonly rpc: SolanaRpcGateway,
    @Optional() private readonly analytics?: AnalyticsService,
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
    return this.repository.bindSubmission({ ...input, requiredProgramId });
  }

  async reconcile(requestedLimit = DEFAULT_BATCH_LIMIT): Promise<ReconciliationSummary> {
    await this.assertDevnet();
    const now = new Date();
    const limit = Math.max(1, Math.min(requestedLimit, MAX_BATCH_LIMIT));
    const transactions = await this.repository.findPending(limit, now);
    const summary = emptySummary();
    if (transactions.length === 0) return summary;

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
    return summary;
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
  return { checked: 0, confirmed: 0, expired: 0, failed: 0, finalized: 0, pending: 0, stuck: 0 };
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
