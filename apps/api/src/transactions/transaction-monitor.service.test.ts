import { describe, expect, test } from 'bun:test';

import { SolanaRpcGateway, SolanaRpcUnavailableError } from './solana-rpc.client.js';
import {
  type BoundSubmission,
  type ParticipantReconciliationBatch,
  TransactionMonitorRepository,
} from './transaction-monitor.repository.js';
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

  test('scopes recovery and reconciliation to the authenticated duel batch', async () => {
    const transaction = monitoredTransaction();
    const repository = new FakeRepository(transaction);
    const service = new TransactionMonitorService(
      repository,
      new FakeRpc({ confirmationStatus: 'finalized', err: null }),
    );

    const result = await service.reconcileDuel({
      actorWallet: transaction.wallet,
      duelId: transaction.duelId,
    });

    expect(result.reconciliation.checked).toBe(1);
    expect(result.reconciliation.finalized).toBe(1);
    expect(result.activeTransactionCount).toBe(0);
    expect(result.duelStatus).toBe('settled');
    expect(result.unboundTransactionCount).toBe(0);
    expect(repository.recoveryLookups).toBe(2);
  });

  test('recovers an unbound broadcast from participant-triggered reconciliation', async () => {
    const intent = preparedRecoveryIntent();
    const repository = new RecoveryRepository(intent);
    const service = new TransactionMonitorService(
      repository,
      new RecoveryRpc(transactionEnvelope()),
    );

    const result = await withEscrowProgram(intent.expectedProgramId, () =>
      service.reconcileDuel({ actorWallet: intent.wallet, duelId: intent.duelId }),
    );

    expect(result.reconciliation.recovered).toBe(1);
    expect(result.reconciliation.finalized).toBe(1);
    expect(result.activeTransactionCount).toBe(0);
    expect(result.unboundTransactionCount).toBe(0);
    expect(result.duelStatus).toBe('funded');
  });

  test('keeps an unbound intent active until absence is finality-safe', async () => {
    const intent = preparedRecoveryIntent({ lastValidBlockHeight: 2_000n });
    const repository = new RecoveryRepository(intent);
    const service = new TransactionMonitorService(repository, new FakeRpc(null, 2_010n));

    const result = await withEscrowProgram(intent.expectedProgramId, () =>
      service.reconcileDuel({ actorWallet: intent.wallet, duelId: intent.duelId }),
    );

    expect(result.unboundTransactionCount).toBe(1);
    expect(result.reconciliation.expired).toBe(0);
  });

  test('certifies an unbound intent absent only after blockhash finality', async () => {
    const intent = preparedRecoveryIntent({ lastValidBlockHeight: 1_000n });
    const repository = new RecoveryRepository(intent);
    const service = new TransactionMonitorService(repository, new FakeRpc(null, 1_065n));

    const result = await withEscrowProgram(intent.expectedProgramId, () =>
      service.reconcileDuel({ actorWallet: intent.wallet, duelId: intent.duelId }),
    );

    expect(result.unboundTransactionCount).toBe(0);
    expect(result.reconciliation.expired).toBe(1);
    expect(repository.expired).toEqual([intent.id]);
  });

  test('opportunistically checks finality after binding a submitted signature', async () => {
    const transaction = monitoredTransaction();
    const repository = new SubmissionRepository(transaction);
    const service = new TransactionMonitorService(
      repository,
      new FakeRpc({ confirmationStatus: 'finalized', err: null }),
    );

    const submission = await withEscrowProgram(transaction.expectedProgramId, () =>
      service.bindSubmission({
        actorWallet: transaction.wallet,
        duelId: transaction.duelId,
        idempotencyKey: 'opd-submit-tx_123456789012',
        signature: transaction.signature,
        transactionId: transaction.id,
      }),
    );

    expect(submission.status).toBe('submitted');
    expect(repository.finalized).toEqual([transaction.id]);
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

  test('rechecks a terminal provider transaction rejected by the legacy access verifier', async () => {
    const transaction = monitoredTransaction({ duelStatus: 'refunding' });
    const repository = new RecoverableTerminalRepository(transaction);
    const service = new TransactionMonitorService(
      repository,
      new FakeRpc({ confirmationStatus: 'finalized', err: null }),
    );

    const summary = await service.reconcile();

    expect(summary.finalized).toBe(1);
    expect(repository.finalized).toEqual([transaction.id]);
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

  test.each([
    ['commit_result', 'awaiting_assets', 'awaiting_assets', 'settling'],
    ['settle', 'settling', 'settling', 'settled'],
  ] as const)('recovers an unbound provider %s broadcast only from its exact lifecycle state', async (action, duelStatus, expectedFromStatus, expectedToStatus) => {
    const intent = preparedRecoveryIntent({
      action,
      duelStatus,
      expectedFromStatus,
      expectedToStatus,
    });
    const repository = new RecoveryRepository(intent);
    const service = new TransactionMonitorService(
      repository,
      new RecoveryRpc(transactionEnvelope()),
    );

    const summary = await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());

    expect(summary.recovered).toBe(1);
    expect(repository.bound).toEqual(['4'.repeat(88)]);
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

  test('does not certify an intent absent when a finalized candidate envelope is unavailable', async () => {
    const intent = preparedRecoveryIntent();
    const repository = new RecoveryRepository(intent);
    const service = new TransactionMonitorService(repository, new MissingEnvelopeRecoveryRpc());

    const summary = await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());

    expect(summary.recovered).toBe(0);
    expect(summary.recoveryErrors).toBe(0);
    expect(repository.checkedBlockHeights).toEqual([null]);
  });

  test('does not certify absence when the finalized signature page is full and truncated', async () => {
    const intent = preparedRecoveryIntent();
    const repository = new RecoveryRepository(intent);
    const service = new TransactionMonitorService(repository, new FullPageRecoveryRpc());

    const summary = await withEscrowProgram(intent.expectedProgramId, () => service.reconcile());

    expect(summary.recovered).toBe(0);
    expect(summary.recoveryRejected).toBe(10);
    expect(repository.checkedBlockHeights).toEqual([null]);
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
  recoveryLookups = 0;
  readonly terminal: Array<{ code: string; id: string; status: 'expired' | 'failed' }> = [];

  constructor(protected readonly transaction: MonitoredTransaction) {
    super();
  }

  async bindSubmission(): Promise<BoundSubmission> {
    throw new Error('Not used by reconciliation tests');
  }

  async bindRecoveredSubmission(): Promise<never> {
    throw new Error('Not used by reconciliation tests');
  }

  async findPending(): Promise<MonitoredTransaction[]> {
    return [this.transaction];
  }

  async findParticipantReconciliationBatch(): Promise<ParticipantReconciliationBatch> {
    const terminal = this.finalized.length > 0 || this.terminal.length > 0;
    return {
      duelId: this.transaction.duelId,
      duelStatus: terminal ? this.transaction.expectedToStatus : this.transaction.duelStatus,
      transactions: terminal ? [] : [this.transaction],
    };
  }

  async findPreparedForRecovery(): Promise<PreparedRecoveryIntent[]> {
    this.recoveryLookups += 1;
    return [];
  }

  async recordPreparedRecoveryExpired(): Promise<void> {}

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

class SubmissionRepository extends FakeRepository {
  override async bindSubmission(): Promise<{
    duelId: string;
    signature: string;
    status: 'submitted';
    transactionId: string;
  }> {
    return {
      duelId: this.transaction.duelId,
      signature: this.transaction.signature,
      status: 'submitted',
      transactionId: this.transaction.id,
    };
  }
}

class RecoverableTerminalRepository extends FakeRepository {
  override async findPending(): Promise<MonitoredTransaction[]> {
    return [];
  }

  override async findRecoverableTerminal(): Promise<MonitoredTransaction[]> {
    return [this.transaction];
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

class MissingEnvelopeRecoveryRpc extends RecoveryRpc {
  constructor() {
    super(transactionEnvelope());
  }

  override async getTransaction(): Promise<null> {
    return null;
  }
}

class FullPageRecoveryRpc extends RecoveryRpc {
  constructor() {
    super(transactionEnvelope());
  }

  override async getFinalizedSignaturesForAddress(): Promise<SolanaAddressSignature[]> {
    const signatureCharacters = '123456789A';
    return Array.from({ length: 10 }, (_, index) => ({
      blockTime: 1_784_155_260 + index,
      confirmationStatus: 'finalized' as const,
      signature: (signatureCharacters[index] ?? '1').repeat(88),
    }));
  }

  override async getTransaction(): Promise<SolanaTransactionEnvelope> {
    const envelope = transactionEnvelope();
    envelope.transaction.message.instructions.unshift({
      accounts: [0],
      data: '3',
      programIdIndex: 2,
    });
    return envelope;
  }
}

class RecoveryRepository extends TransactionMonitorRepository {
  readonly alerts: string[] = [];
  readonly bound: string[] = [];
  readonly checkedBlockHeights: Array<bigint | null> = [];
  readonly expired: string[] = [];
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
    return this.#boundSignature || this.expired.length > 0 ? [] : [this.intent];
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

  async findParticipantReconciliationBatch(): Promise<ParticipantReconciliationBatch> {
    return {
      duelId: this.intent.duelId,
      duelStatus: this.finalized.length > 0 ? 'funded' : this.intent.duelStatus,
      transactions:
        !this.#boundSignature || this.finalized.length > 0
          ? []
          : [
              {
                ...this.intent,
                duelStatus: 'committing',
                signature: this.#boundSignature,
                status: 'submitted',
                submittedAt: this.intent.preparedAt,
              },
            ],
    };
  }

  async recordRecoveryAlert(input: { signature: string }): Promise<void> {
    this.alerts.push(input.signature);
  }

  async recordRecoveryAttempt(
    _transactionId: string,
    _now: Date,
    _nextRecoveryCheckAt: Date,
    checkedBlockHeight?: bigint,
  ): Promise<void> {
    this.checkedBlockHeights.push(checkedBlockHeight ?? null);
  }

  override async recordPreparedRecoveryExpired(transactionId: string): Promise<void> {
    this.expired.push(transactionId);
  }

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
    lastRecoveryCheckedBlockHeight: null,
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
