import { describe, expect, test } from 'bun:test';

import { SolanaRpcGateway } from './solana-rpc.client.js';
import { TransactionMonitorRepository } from './transaction-monitor.repository.js';
import { TransactionMonitorService } from './transaction-monitor.service.js';
import { monitoredTransaction, transactionEnvelope } from './transaction-monitor.test-fixtures.js';
import type {
  MonitoredTransaction,
  SolanaSignatureStatus,
  SolanaTransactionEnvelope,
} from './transaction-monitor.types.js';

describe('TransactionMonitorService', () => {
  test('records confirmed progress without advancing the duel', async () => {
    const repository = new FakeRepository(monitoredTransaction());
    const rpc = new FakeRpc({ confirmationStatus: 'confirmed', err: null });
    const service = new TransactionMonitorService(repository, rpc);

    const summary = await service.reconcile();

    expect(summary.confirmed).toBe(1);
    expect(summary.finalized).toBe(0);
    expect(repository.confirmed).toEqual(['tx_123456789012']);
    expect(repository.finalized).toEqual([]);
  });

  test('advances only after a finalized transaction passes intent verification', async () => {
    const repository = new FakeRepository(monitoredTransaction());
    const rpc = new FakeRpc({ confirmationStatus: 'finalized', err: null });
    const service = new TransactionMonitorService(repository, rpc);

    const summary = await service.reconcile();

    expect(summary.finalized).toBe(1);
    expect(repository.finalized).toEqual(['tx_123456789012']);
  });

  test('expires a missing signature only after its last valid block height', async () => {
    const repository = new FakeRepository(monitoredTransaction({ lastValidBlockHeight: 1_000n }));
    const rpc = new FakeRpc(null, 1_001n);
    const service = new TransactionMonitorService(repository, rpc);

    const summary = await service.reconcile();

    expect(summary.expired).toBe(1);
    expect(repository.terminal).toEqual([
      { code: 'BLOCKHASH_EXPIRED', id: 'tx_123456789012', status: 'expired' },
    ]);
  });

  test('fails a finalized transaction whose account constraints do not match', async () => {
    const repository = new FakeRepository(
      monitoredTransaction({
        expectedAccounts: [{ address: '11111111111111111111111111111111', isWritable: true }],
      }),
    );
    const rpc = new FakeRpc({ confirmationStatus: 'finalized', err: null });
    const service = new TransactionMonitorService(repository, rpc);

    const summary = await service.reconcile();

    expect(summary.failed).toBe(1);
    expect(repository.terminal[0]?.code).toBe('ACCOUNT_MISSING');
    expect(repository.finalized).toEqual([]);
  });
});

class FakeRpc extends SolanaRpcGateway {
  constructor(
    private readonly signatureStatus: SolanaSignatureStatus | null,
    private readonly blockHeight = 1_000n,
    private readonly envelope: SolanaTransactionEnvelope = transactionEnvelope(),
  ) {
    super();
  }

  async assertDevnet(): Promise<void> {}

  async getBlockHeight(): Promise<bigint> {
    return this.blockHeight;
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    return { blockhash: 'unused', lastValidBlockHeight: 2_000n };
  }

  async getSignatureStatuses(): Promise<Array<SolanaSignatureStatus | null>> {
    return [this.signatureStatus];
  }

  async getTransaction(): Promise<SolanaTransactionEnvelope | null> {
    return this.envelope;
  }
}

class FakeRepository extends TransactionMonitorRepository {
  readonly confirmed: string[] = [];
  readonly finalized: string[] = [];
  readonly pending: string[] = [];
  readonly terminal: Array<{ code: string; id: string; status: 'expired' | 'failed' }> = [];

  constructor(private readonly transaction: MonitoredTransaction) {
    super();
  }

  async bindSubmission(): Promise<never> {
    throw new Error('Not used by reconciliation tests');
  }

  async findPending(): Promise<MonitoredTransaction[]> {
    return [this.transaction];
  }

  async recordConfirmed(transactionId: string): Promise<void> {
    this.confirmed.push(transactionId);
  }

  async recordFinalized(transactionId: string): Promise<boolean> {
    this.finalized.push(transactionId);
    return true;
  }

  async recordPending(transactionId: string): Promise<void> {
    this.pending.push(transactionId);
  }

  async recordTerminal(
    transactionId: string,
    status: 'expired' | 'failed',
    code: string,
  ): Promise<void> {
    this.terminal.push({ code, id: transactionId, status });
  }
}
