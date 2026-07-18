import { describe, expect, test } from 'bun:test';
import type { DatabaseClient, Prisma } from '@openpacksduel/db';
import {
  DuelSide,
  DuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
  ProviderMode,
} from '@openpacksduel/db';
import { Keypair } from '@solana/web3.js';

import {
  decodeEscrowV4RefundState,
  deriveEscrowV2Addresses,
  ESCROW_DUEL_VERSION,
  ESCROW_V2_PROGRAM_ID,
  ESCROW_V4_DUEL_ACCOUNT_DISCRIMINATOR,
  ESCROW_V4_DUEL_ACCOUNT_SIZE,
} from '../contracts/openpacksduel-escrow-v2.js';
import type { DevnetDemoSignerService } from './devnet-demo-signer.service.js';
import { DevnetRefundOrchestratorService } from './devnet-refund-orchestrator.service.js';
import { nonceFromDuelId } from './duel-funding.service.js';
import type { ProviderSettlementService } from './provider-settlement.service.js';
import { type SolanaAccountInfo, SolanaRpcGateway } from './solana-rpc.client.js';
import type { TransactionMonitorRepository } from './transaction-monitor.repository.js';
import type {
  SolanaAddressSignature,
  SolanaSignatureStatus,
  SolanaTransactionEnvelope,
} from './transaction-monitor.types.js';

const CREATOR = Keypair.generate().publicKey;
const OPPONENT = Keypair.generate().publicKey;
const SIGNER = Keypair.generate().publicKey;

describe('Duel v4 refund state decoder', () => {
  test('decodes status and all custody flags from the pinned account layout', () => {
    const state = decodeEscrowV4RefundState(
      escrowAccount('refunding', {
        creatorCard: true,
        creatorPayment: false,
        opponentCard: true,
        opponentPayment: true,
      }),
    );

    expect(state).toEqual({
      custody: {
        creatorCard: true,
        creatorPayment: false,
        opponentCard: true,
        opponentPayment: true,
      },
      hasResultCommitment: false,
      status: 'refunding',
      version: ESCROW_DUEL_VERSION,
    });
  });

  test('fails closed on an unknown layout, version, status, or boolean flag', () => {
    expect(() => decodeEscrowV4RefundState(new Uint8Array(10))).toThrow('unexpected size');
    const wrongVersion = escrowAccount('refunding', emptyCustody());
    wrongVersion[8] = 3;
    expect(() => decodeEscrowV4RefundState(wrongVersion)).toThrow('version');
    const wrongStatus = escrowAccount('refunding', emptyCustody());
    wrongStatus[11] = 255;
    expect(() => decodeEscrowV4RefundState(wrongStatus)).toThrow('status');
    const wrongFlag = escrowAccount('refunding', emptyCustody());
    wrongFlag[236] = 2;
    expect(() => decodeEscrowV4RefundState(wrongFlag)).toThrow('custody flag');
  });
});

describe('DevnetRefundOrchestratorService', () => {
  test.each(
    Array.from({ length: 16 }, (_, mask) => mask),
  )('submits exactly the remaining escrow-v4 custody mask %i', async (mask) => {
    const custody = {
      creatorCard: Boolean(mask & 1),
      creatorPayment: Boolean(mask & 2),
      opponentCard: Boolean(mask & 4),
      opponentPayment: Boolean(mask & 8),
    };
    const fixture = new RefundFixture('refunding', custody);

    const summary = await fixture.service.reconcile(20);

    expect(summary.errors).toBe(0);
    expect(summary.submitted).toBe(Object.values(custody).filter(Boolean).length);
    expect(fixture.preparedAssets.sort()).toEqual(expectedAssets(custody).sort());
    expect(fixture.boundSignatures).toHaveLength(summary.submitted);
  });

  test('routes a committed result to settlement recovery without broadcasting refunds', async () => {
    const fixture = new RefundFixture('result_submitted', {
      creatorCard: true,
      creatorPayment: true,
      opponentCard: true,
      opponentPayment: true,
    });

    const summary = await fixture.service.reconcile(20);

    expect(summary.routedToSettlement).toBe(1);
    expect(fixture.duel.status).toBe(DuelStatus.SETTLING);
    expect(fixture.preparedAssets).toEqual([]);
    expect(fixture.events[0]?.type).toBe('duel.refund_routed_to_settlement_recovery');
  });

  test('marks refunded only after chain custody and every required public signature finalize', async () => {
    const fixture = new RefundFixture('refunded', emptyCustody());
    fixture.requireAllAssets();
    fixture.finalizeAllRefunds();

    const summary = await fixture.service.reconcile(20);

    expect(summary.completed).toBe(1);
    expect(fixture.duel.status).toBe(DuelStatus.REFUNDED);
    expect(fixture.events[0]).toEqual(
      expect.objectContaining({
        data: {
          chainStatus: 'refunded',
          refunds: expect.arrayContaining([
            { asset: 'payment:creator', signature: 'payment-creator-signature' },
            { asset: 'payment:opponent', signature: 'payment-opponent-signature' },
            { asset: 'card:creator', signature: 'card-creator-signature' },
            { asset: 'card:opponent', signature: 'card-opponent-signature' },
          ]),
        },
        type: 'duel.refund_custody_finalized',
      }),
    );
    expect(JSON.stringify(fixture.events[0])).not.toContain('serializedTransaction');
  });

  test('keeps the duel refunding while one required refund lacks finalized proof', async () => {
    const fixture = new RefundFixture('refunded', emptyCustody());
    fixture.requireAllAssets();
    fixture.finalizeAllRefunds();
    fixture.duel.transactions.pop();

    const summary = await fixture.service.reconcile(20);

    expect(summary.completed).toBe(0);
    expect(fixture.duel.status).toBe(DuelStatus.REFUNDING);
  });

  test('does not double-submit an active or lost-response refund intent', async () => {
    const fixture = new RefundFixture('refunding', {
      ...emptyCustody(),
      creatorPayment: true,
    });
    fixture.duel.transactions.push(
      refundTransaction('payment', 'creator', DuelTransactionStatus.PREPARED, null),
    );

    const summary = await fixture.service.reconcile(20);

    expect(summary.submitted).toBe(0);
    expect(fixture.preparedAssets).toEqual([]);
  });

  test('creates a new bounded attempt after a submitted refund expires', async () => {
    const fixture = new RefundFixture('refunding', {
      ...emptyCustody(),
      opponentPayment: true,
    });
    fixture.duel.transactions.push(
      refundTransaction('payment', 'opponent', DuelTransactionStatus.EXPIRED, 'expired-signature'),
    );

    await fixture.service.reconcile(20);

    expect(fixture.preparedKeys).toEqual([`refund:${fixture.duel.id}:payment:opponent:v1:2`]);
  });
});

class RefundFixture {
  readonly boundSignatures: string[] = [];
  readonly events: Array<{ data: unknown; type: string }> = [];
  readonly preparedAssets: string[] = [];
  readonly preparedKeys: string[] = [];
  readonly duel = {
    creatorWallet: CREATOR.toBase58(),
    devnetPackSnapshots: [] as Array<{
      assetReference: string | null;
      side: DuelSide;
    }>,
    escrowAddress: '',
    id: 'duel_refund_fixture',
    opponentWallet: OPPONENT.toBase58(),
    providerMode: ProviderMode.OPENPACKSDUEL_DEVNET,
    status: DuelStatus.REFUNDING,
    transactions: [] as Array<
      RefundTransactionFixture & {
        action: DuelTransactionAction;
        wallet: string;
      }
    >,
    updatedAt: new Date('2026-07-18T00:00:00.000Z'),
    version: 1,
  };
  readonly rpc: FixtureRpc;
  readonly service: DevnetRefundOrchestratorService;

  constructor(
    status: Parameters<typeof escrowAccount>[0],
    custody: Parameters<typeof escrowAccount>[1],
  ) {
    this.duel.escrowAddress = deriveEscrowV2Addresses(
      CREATOR,
      nonceFromDuelId(this.duel.id),
    ).duel.toBase58();
    this.rpc = new FixtureRpc(escrowAccount(status, custody));
    const database = {
      duel: {
        findMany: async () => (this.duel.status === DuelStatus.REFUNDING ? [this.duel] : []),
        findUnique: async () => ({
          status: this.duel.status,
          version: this.duel.version,
        }),
        updateMany: async ({ data }: { data: { status: DuelStatus }; where: unknown }) => {
          if (this.duel.status !== DuelStatus.REFUNDING) return { count: 0 };
          this.duel.status = data.status;
          this.duel.version += 1;
          return { count: 1 };
        },
      },
      duelEvent: {
        create: async ({ data }: { data: { data: unknown; type: string } }) => {
          this.events.push({ data: data.data, type: data.type });
          return data;
        },
      },
    };
    const databaseClient = {
      ...database,
      $transaction: async <T>(callback: (client: typeof database) => Promise<T>) =>
        callback(database),
    };
    const settlement = {
      prepare: async (input: {
        idempotencyKey: string;
        operation: 'refund_card' | 'refund_payment';
        side: 'creator' | 'opponent';
      }) => {
        const kind = input.operation === 'refund_card' ? 'card' : 'payment';
        this.preparedAssets.push(`${kind}:${input.side}`);
        this.preparedKeys.push(input.idempotencyKey);
        const transaction = refundTransaction(
          kind,
          input.side,
          DuelTransactionStatus.PREPARED,
          null,
          input.idempotencyKey,
        );
        this.duel.transactions.push(transaction);
        return {
          expectedSigner: SIGNER.toBase58(),
          intentId: transaction.id,
          lastValidBlockHeight: '200',
          recentBlockhash: Keypair.generate().publicKey.toBase58(),
          serializedTransactionBase64: 'fixture',
        };
      },
    };
    const signer = {
      publicKey: SIGNER,
      signAndSendPrepared: async () => `${this.boundSignatures.length + 1}`.repeat(88),
    };
    const repository = {
      bindSubmission: async (input: { signature: string; transactionId: string }) => {
        this.boundSignatures.push(input.signature);
        const transaction = this.duel.transactions.find(
          (candidate) => candidate.id === input.transactionId,
        );
        if (transaction) {
          transaction.signature = input.signature;
          transaction.status = DuelTransactionStatus.SUBMITTED;
        }
        return {
          duelId: this.duel.id,
          signature: input.signature,
          status: 'submitted' as const,
          transactionId: input.transactionId,
        };
      },
    };
    this.service = new DevnetRefundOrchestratorService(
      databaseClient as unknown as DatabaseClient,
      settlement as unknown as ProviderSettlementService,
      signer as unknown as DevnetDemoSignerService,
      repository as unknown as TransactionMonitorRepository,
      this.rpc,
    );
  }

  requireAllAssets(): void {
    this.duel.transactions.push(
      fundingTransaction(CREATOR.toBase58()),
      fundingTransaction(OPPONENT.toBase58()),
    );
    this.duel.devnetPackSnapshots.push(
      { assetReference: Keypair.generate().publicKey.toBase58(), side: DuelSide.CREATOR },
      { assetReference: Keypair.generate().publicKey.toBase58(), side: DuelSide.OPPONENT },
    );
  }

  finalizeAllRefunds(): void {
    for (const kind of ['payment', 'card'] as const) {
      for (const side of ['creator', 'opponent'] as const) {
        this.duel.transactions.push(
          refundTransaction(
            kind,
            side,
            DuelTransactionStatus.FINALIZED,
            `${kind}-${side}-signature`,
          ),
        );
      }
    }
  }
}

class FixtureRpc extends SolanaRpcGateway {
  constructor(private readonly data: Uint8Array) {
    super();
  }

  async assertDevnet(): Promise<void> {}

  async getAccountInfo(): Promise<SolanaAccountInfo> {
    return { data: this.data, owner: ESCROW_V2_PROGRAM_ID.toBase58() };
  }

  async getBlockHeight(): Promise<bigint> {
    return 100n;
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    return { blockhash: 'unused', lastValidBlockHeight: 200n };
  }

  async getFinalizedSignaturesForAddress(): Promise<SolanaAddressSignature[]> {
    return [];
  }

  async getSignatureStatuses(): Promise<Array<SolanaSignatureStatus | null>> {
    return [];
  }

  async getTransaction(): Promise<SolanaTransactionEnvelope | null> {
    return null;
  }
}

interface RefundTransactionFixture {
  action: DuelTransactionAction;
  id: string;
  idempotencyKey: string | null;
  lastRecoveryCheckedBlockHeight: bigint | null;
  lastValidBlockHeight: bigint | null;
  metadata: Prisma.JsonValue | null;
  signature: string | null;
  status: DuelTransactionStatus;
  wallet: string;
}

function refundTransaction(
  kind: 'card' | 'payment',
  side: 'creator' | 'opponent',
  status: DuelTransactionStatus,
  signature: string | null,
  idempotencyKey = `refund:fixture:${kind}:${side}`,
): RefundTransactionFixture {
  return {
    action: DuelTransactionAction.REFUND,
    id: `tx_${kind}_${side}_${status.toLowerCase()}`,
    idempotencyKey,
    lastRecoveryCheckedBlockHeight: null,
    lastValidBlockHeight: 200n,
    metadata: {
      proof:
        kind === 'card' ? { cardMint: `${side}-mint`, side } : { player: `${side}-wallet`, side },
    },
    signature,
    status,
    wallet: SIGNER.toBase58(),
  };
}

function fundingTransaction(wallet: string): RefundTransactionFixture {
  return {
    action: DuelTransactionAction.FUND,
    id: `tx_fund_${wallet}`,
    idempotencyKey: null,
    lastRecoveryCheckedBlockHeight: null,
    lastValidBlockHeight: 200n,
    metadata: null,
    signature: `${wallet.slice(0, 8)}-funding-signature`,
    status: DuelTransactionStatus.FINALIZED,
    wallet,
  };
}

function escrowAccount(
  status:
    | 'initialized'
    | 'funded'
    | 'awaiting_result'
    | 'result_submitted'
    | 'refunding'
    | 'settled'
    | 'refunded',
  custody: {
    creatorCard: boolean;
    creatorPayment: boolean;
    opponentCard: boolean;
    opponentPayment: boolean;
  },
): Uint8Array {
  const data = new Uint8Array(ESCROW_V4_DUEL_ACCOUNT_SIZE);
  data.set(ESCROW_V4_DUEL_ACCOUNT_DISCRIMINATOR);
  data[8] = ESCROW_DUEL_VERSION;
  data[11] = [
    'initialized',
    'funded',
    'awaiting_result',
    'result_submitted',
    'refunding',
    'settled',
    'refunded',
  ].indexOf(status);
  data[236] = Number(custody.creatorPayment);
  data[237] = Number(custody.opponentPayment);
  data[238] = Number(custody.creatorCard);
  data[239] = Number(custody.opponentCard);
  if (status === 'result_submitted' || status === 'settled') data[496] = 1;
  return data;
}

function emptyCustody() {
  return {
    creatorCard: false,
    creatorPayment: false,
    opponentCard: false,
    opponentPayment: false,
  };
}

function expectedAssets(custody: ReturnType<typeof emptyCustody>): string[] {
  return [
    ...(custody.creatorCard ? ['card:creator'] : []),
    ...(custody.creatorPayment ? ['payment:creator'] : []),
    ...(custody.opponentCard ? ['card:opponent'] : []),
    ...(custody.opponentPayment ? ['payment:opponent'] : []),
  ];
}
