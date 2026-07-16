import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '@openpacksduel/db';
import { DuelStatus, DuelTransactionStatus, ProviderMode } from '@openpacksduel/db';
import { Keypair } from '@solana/web3.js';

import { DevnetDemoSettlementService } from './devnet-demo-settlement.service.js';
import type { DevnetDemoSignerService } from './devnet-demo-signer.service.js';
import type { ProviderSettlementService } from './provider-settlement.service.js';
import type { TransactionMonitorService } from './transaction-monitor.service.js';

describe('DevnetDemoSettlementService', () => {
  const originalPollMs = process.env.OPENPACKSDUEL_SETTLEMENT_POLL_MS;

  beforeEach(() => {
    process.env.OPENPACKSDUEL_SETTLEMENT_POLL_MS = '10';
  });

  afterEach(() => {
    if (originalPollMs === undefined) delete process.env.OPENPACKSDUEL_SETTLEMENT_POLL_MS;
    else process.env.OPENPACKSDUEL_SETTLEMENT_POLL_MS = originalPollMs;
  });

  test('waits for finalization instead of resubmitting active commit and settlement intents', async () => {
    const fixture = new SettlementFixture();
    const service = new DevnetDemoSettlementService(
      fixture.database as unknown as DatabaseClient,
      fixture.settlement as unknown as ProviderSettlementService,
      fixture.signer as unknown as DevnetDemoSignerService,
      fixture.monitor as unknown as TransactionMonitorService,
    );

    await service.finalizeDuel(fixture.duelId);

    expect(fixture.preparedOperations).toEqual(['commit_result', 'settle']);
    expect(fixture.broadcasts).toBe(2);
    expect(fixture.bindings).toBe(2);
    expect(fixture.status).toBe(DuelStatus.SETTLED);
  });
});

class SettlementFixture {
  readonly duelId = 'duel_devnet_settlement';
  readonly preparedOperations: string[] = [];
  readonly transactions = new Map<
    string,
    {
      lastRecoveryCheckedBlockHeight: bigint | null;
      lastValidBlockHeight: bigint;
      status: DuelTransactionStatus;
    }
  >();
  bindings = 0;
  broadcasts = 0;
  reconciliations = 0;
  status: DuelStatus = DuelStatus.AWAITING_ASSETS;

  readonly database = {
    duel: {
      findUnique: async () => ({
        providerMode: ProviderMode.OPENPACKSDUEL_DEVNET,
        status: this.status,
      }),
    },
    duelTransaction: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        this.transactions.get(where.idempotencyKey) ?? null,
    },
  };

  readonly settlement = {
    prepare: async (input: { idempotencyKey: string; operation: string }) => {
      this.preparedOperations.push(input.operation);
      this.transactions.set(input.idempotencyKey, {
        lastRecoveryCheckedBlockHeight: null,
        lastValidBlockHeight: 200n,
        status: DuelTransactionStatus.PREPARED,
      });
      return {
        expectedSigner: this.signer.publicKey.toBase58(),
        intentId: `tx_${input.operation}`,
        lastValidBlockHeight: '200',
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        serializedTransactionBase64: 'fixture',
      };
    },
  };

  readonly signer = {
    publicKey: Keypair.generate().publicKey,
    signAndSendPrepared: async () => {
      this.broadcasts += 1;
      return `${this.broadcasts}`.repeat(88);
    },
  };

  readonly monitor = {
    bindSubmission: async () => {
      this.bindings += 1;
      const active = [...this.transactions.values()].find(
        (transaction) => transaction.status === DuelTransactionStatus.PREPARED,
      );
      if (active) active.status = DuelTransactionStatus.SUBMITTED;
    },
    reconcile: async () => {
      this.reconciliations += 1;
      if (this.reconciliations === 3) {
        this.status = DuelStatus.SETTLING;
        for (const transaction of this.transactions.values()) {
          transaction.status = DuelTransactionStatus.FINALIZED;
        }
      }
      if (this.reconciliations === 6) {
        this.status = DuelStatus.SETTLED;
        for (const transaction of this.transactions.values()) {
          transaction.status = DuelTransactionStatus.FINALIZED;
        }
      }
    },
  };
}
