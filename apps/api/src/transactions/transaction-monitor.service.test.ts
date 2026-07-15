import { describe, expect, test } from 'bun:test';

import { SolanaRpcGateway, SolanaRpcUnavailableError } from './solana-rpc.client.js';
import { TransactionMonitorRepository } from './transaction-monitor.repository.js';
import { nextRecoveryCheckAt, TransactionMonitorService } from './transaction-monitor.service.js';
import { monitoredTransaction, transactionEnvelope } from './transaction-monitor.test-fixtures.js';
import type {
  MonitoredTransaction,
  PreparedRecoveryIntent,
  SolanaAddressSignature,
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

  test('recovers a finalized broadcast after the API submission response is lost', async () => {
    const intent = preparedRecoveryIntent();
    const repository = new RecoveryRepository(intent);
    const rpc = new RecoveryRpc(transactionEnvelope());
    const service = new TransactionMonitorService(repository, rpc);

    const summary = await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());

    expect(summary.recovered).toBe(1);
    expect(summary.finalized).toBe(1);
    expect(repository.bound).toEqual(['4'.repeat(88)]);
    expect(repository.finalized).toEqual([intent.id]);
  });

  test('does not bind the same discovered broadcast twice', async () => {
    const intent = preparedRecoveryIntent();
    const repository = new RecoveryRepository(intent);
    const rpc = new RecoveryRpc(transactionEnvelope());
    const service = new TransactionMonitorService(repository, rpc);

    await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());
    const replay = await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());

    expect(replay.recovered).toBe(0);
    expect(repository.bound).toHaveLength(1);
    expect(rpc.addressLookups).toBe(1);
  });

  test('rejects a discovered signature whose full message was mutated', async () => {
    const intent = preparedRecoveryIntent();
    const envelope = transactionEnvelope();
    envelope.transaction.message.instructions.unshift({
      accounts: [0],
      data: '3',
      programIdIndex: 2,
    });
    const repository = new RecoveryRepository(intent);
    const service = new TransactionMonitorService(repository, new RecoveryRpc(envelope));

    const summary = await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());

    expect(summary.recovered).toBe(0);
    expect(summary.recoveryRejected).toBe(1);
    expect(repository.bound).toEqual([]);
  });

  test('refuses recovery when the duel was cancelled during discovery', async () => {
    const intent = preparedRecoveryIntent({ duelStatus: 'cancelled' });
    const repository = new RecoveryRepository(intent);
    const service = new TransactionMonitorService(
      repository,
      new RecoveryRpc(transactionEnvelope()),
    );

    const summary = await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());

    expect(summary.recovered).toBe(0);
    expect(summary.recoveryAlerts).toBe(1);
    expect(repository.alerts).toEqual(['4'.repeat(88)]);
    expect(repository.bound).toEqual([]);
    expect(repository.finalized).toEqual([]);
  });

  test('does not alert on an unrelated finalized transaction touching a cancelled escrow', async () => {
    const intent = preparedRecoveryIntent({ duelStatus: 'cancelled' });
    const envelope = transactionEnvelope();
    envelope.transaction.message.instructions.unshift({
      accounts: [0],
      data: '3',
      programIdIndex: 2,
    });
    const repository = new RecoveryRepository(intent);
    const service = new TransactionMonitorService(repository, new RecoveryRpc(envelope));

    const summary = await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());

    expect(summary.recoveryRejected).toBe(1);
    expect(summary.recoveryAlerts).toBe(0);
    expect(repository.alerts).toEqual([]);
  });

  test('continues normal reconciliation when recovery RPC discovery fails', async () => {
    const transaction = monitoredTransaction();
    const intent = preparedRecoveryIntent();
    const repository = new RecoveryOutageRepository(transaction, intent);
    const service = new TransactionMonitorService(repository, new RecoveryOutageRpc());

    const summary = await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());

    expect(summary.recoveryErrors).toBe(1);
    expect(summary.finalized).toBe(1);
    expect(repository.recoveryAttempts).toEqual([intent.id]);
  });

  test('backs off repeated recovery scans up to one hour', () => {
    const now = new Date('2026-07-15T20:00:00.000Z');

    expect(nextRecoveryCheckAt(now, 0).getTime() - now.getTime()).toBe(60_000);
    expect(nextRecoveryCheckAt(now, 99).getTime() - now.getTime()).toBe(3_600_000);
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

  async getFinalizedSignaturesForAddress(): Promise<SolanaAddressSignature[]> {
    return [];
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

  async bindRecoveredSubmission(): Promise<never> {
    throw new Error('Not used by reconciliation tests');
  }

  async findPending(): Promise<MonitoredTransaction[]> {
    return [this.transaction];
  }

  async findPreparedForRecovery(): Promise<PreparedRecoveryIntent[]> {
    return [];
  }

  async recordRecoveryAlert(): Promise<void> {}

  async recordRecoveryAttempt(
    _transactionId: string,
    _now: Date,
    _nextRecoveryCheckAt: Date,
  ): Promise<void> {}

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

class RecoveryRpc extends FakeRpc {
  addressLookups = 0;

  constructor(envelope: SolanaTransactionEnvelope) {
    super({ confirmationStatus: 'finalized', err: null }, 1_000n, envelope);
  }

  override async getFinalizedSignaturesForAddress(): Promise<SolanaAddressSignature[]> {
    this.addressLookups += 1;
    return [
      {
        blockTime: 1_784_155_260,
        confirmationStatus: 'finalized',
        signature: '4'.repeat(88),
      },
    ];
  }
}

class RecoveryRepository extends TransactionMonitorRepository {
  readonly alerts: string[] = [];
  readonly bound: string[] = [];
  readonly finalized: string[] = [];
  #boundSignature: string | null = null;

  constructor(private readonly intent: PreparedRecoveryIntent) {
    super();
  }

  async bindSubmission(): Promise<never> {
    throw new Error('Not used by recovery tests');
  }

  async bindRecoveredSubmission(input: { signature: string }): Promise<{
    duelId: string;
    signature: string;
    status: 'submitted';
    transactionId: string;
  }> {
    if (!this.#boundSignature) {
      this.#boundSignature = input.signature;
      this.bound.push(input.signature);
    }
    return {
      duelId: this.intent.duelId,
      signature: input.signature,
      status: 'submitted',
      transactionId: this.intent.id,
    };
  }

  async findPreparedForRecovery(): Promise<PreparedRecoveryIntent[]> {
    return this.#boundSignature ? [] : [this.intent];
  }

  async findPending(): Promise<MonitoredTransaction[]> {
    if (!this.#boundSignature || this.finalized.length > 0) return [];
    return [
      {
        ...this.intent,
        duelStatus: 'committing',
        signature: this.#boundSignature,
        status: 'submitted',
        submittedAt: this.intent.preparedAt,
      },
    ];
  }

  async recordRecoveryAlert(input: { signature: string }): Promise<void> {
    this.alerts.push(input.signature);
  }

  async recordRecoveryAttempt(): Promise<void> {}

  async recordConfirmed(): Promise<void> {}

  async recordFinalized(transactionId: string): Promise<boolean> {
    this.finalized.push(transactionId);
    return true;
  }

  async recordPending(): Promise<void> {}

  async recordTerminal(): Promise<void> {}
}

class RecoveryOutageRepository extends FakeRepository {
  readonly recoveryAttempts: string[] = [];

  constructor(
    transaction: MonitoredTransaction,
    private readonly intent: PreparedRecoveryIntent,
  ) {
    super(transaction);
  }

  override async findPreparedForRecovery(): Promise<PreparedRecoveryIntent[]> {
    return [this.intent];
  }

  override async recordRecoveryAttempt(transactionId: string): Promise<void> {
    this.recoveryAttempts.push(transactionId);
  }
}

class RecoveryOutageRpc extends FakeRpc {
  constructor() {
    super({ confirmationStatus: 'finalized', err: null });
  }

  override async getFinalizedSignaturesForAddress(): Promise<SolanaAddressSignature[]> {
    throw new SolanaRpcUnavailableError('discovery unavailable');
  }
}

function preparedRecoveryIntent(
  overrides: Partial<PreparedRecoveryIntent> = {},
): PreparedRecoveryIntent {
  const monitored = monitoredTransaction({
    action: 'fund',
    duelStatus: 'matched',
    expectedFromStatus: 'committing',
    expectedToStatus: 'funded',
  });
  const {
    signature: _signature,
    status: _status,
    submittedAt: _submittedAt,
    ...intent
  } = monitored;
  const escrow = intent.expectedAccounts.find(
    (account) => account.address !== intent.expectedSigner && account.isWritable,
  );
  if (!escrow) throw new Error('Recovery fixture requires an escrow account');
  return {
    ...intent,
    escrowAddress: escrow.address,
    preparedAt: new Date('2026-07-15T20:00:00.000Z'),
    recoveryCheckAttempts: 0,
    ...overrides,
  };
}

async function withEscrowProgram<T>(programId: string, callback: () => Promise<T>): Promise<T> {
  const previous = process.env.ESCROW_PROGRAM_ID;
  process.env.ESCROW_PROGRAM_ID = programId;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.ESCROW_PROGRAM_ID;
    else process.env.ESCROW_PROGRAM_ID = previous;
  }
}
