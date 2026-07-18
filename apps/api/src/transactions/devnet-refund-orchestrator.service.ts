import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  type DatabaseClient,
  DuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
  type Prisma,
  ProviderMode,
} from '@openpacksduel/db';
import { PublicKey } from '@solana/web3.js';

import {
  decodeEscrowV4RefundState,
  deriveEscrowV2Addresses,
  ESCROW_V2_PROGRAM_ID,
  type EscrowV2Role,
  type EscrowV4RefundState,
} from '../contracts/openpacksduel-escrow-v2.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DevnetDemoSignerService } from './devnet-demo-signer.service.js';
import { nonceFromDuelId } from './duel-funding.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { ProviderSettlementService } from './provider-settlement.service.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway } from './solana-rpc.client.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { TransactionMonitorRepository } from './transaction-monitor.repository.js';

const ACTIVE_REFUND_STATUSES = new Set<DuelTransactionStatus>([
  DuelTransactionStatus.PREPARED,
  DuelTransactionStatus.SUBMITTED,
  DuelTransactionStatus.CONFIRMED,
]);

type RefundKind = 'card' | 'payment';

interface RefundAsset {
  kind: RefundKind;
  side: EscrowV2Role;
}

interface RefundTransaction {
  idempotencyKey: string | null;
  lastRecoveryCheckedBlockHeight: bigint | null;
  lastValidBlockHeight: bigint | null;
  metadata: Prisma.JsonValue | null;
  signature: string | null;
  status: DuelTransactionStatus;
}

export interface RefundOrchestrationSummary {
  completed: number;
  errors: number;
  routedToSettlement: number;
  submitted: number;
}

@Injectable()
export class DevnetRefundOrchestratorService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly settlement: ProviderSettlementService,
    private readonly signer: DevnetDemoSignerService,
    private readonly repository: TransactionMonitorRepository,
    private readonly rpc: SolanaRpcGateway,
  ) {}

  async reconcile(requestedLimit: number): Promise<RefundOrchestrationSummary> {
    await this.rpc.assertDevnet();
    const limit = Math.max(1, Math.min(requestedLimit, 100));
    const summary: RefundOrchestrationSummary = {
      completed: 0,
      errors: 0,
      routedToSettlement: 0,
      submitted: 0,
    };
    const duels = await this.database.duel.findMany({
      include: {
        devnetPackSnapshots: {
          select: { assetReference: true, side: true },
        },
        transactions: {
          select: {
            action: true,
            idempotencyKey: true,
            lastRecoveryCheckedBlockHeight: true,
            lastValidBlockHeight: true,
            metadata: true,
            signature: true,
            status: true,
            wallet: true,
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      where: {
        providerMode: ProviderMode.OPENPACKSDUEL_DEVNET,
        status: DuelStatus.REFUNDING,
      },
    });

    for (const duel of duels) {
      try {
        const state = await this.readState({
          creatorWallet: duel.creatorWallet,
          escrowAddress: duel.escrowAddress,
          id: duel.id,
        });
        if (state.hasResultCommitment || state.status === 'settled') {
          if (await this.routeToSettlement(duel.id, state.status)) {
            summary.routedToSettlement += 1;
          }
          continue;
        }
        const refundTransactions = duel.transactions
          .filter((transaction) => transaction.action === DuelTransactionAction.REFUND)
          .map((transaction) => transaction as RefundTransaction);
        const required = requiredAssets(duel, refundTransactions);
        if (state.status === 'refunded') {
          if (await this.complete(duel.id, state, required, refundTransactions)) {
            summary.completed += 1;
          }
          continue;
        }
        for (const asset of heldAssets(state)) {
          const idempotencyKey = nextPreparationKey(duel.id, asset, refundTransactions);
          if (!idempotencyKey) continue;
          await this.submit({
            asset,
            duelId: duel.id,
            idempotencyKey,
          });
          summary.submitted += 1;
        }
      } catch {
        summary.errors += 1;
      }
    }
    return summary;
  }

  private async readState(input: {
    creatorWallet: string;
    escrowAddress: string | null;
    id: string;
  }): Promise<EscrowV4RefundState> {
    if (!input.escrowAddress) throw new ConflictException('Refunding duel has no escrow address');
    const creator = new PublicKey(input.creatorWallet);
    const expected = deriveEscrowV2Addresses(creator, nonceFromDuelId(input.id)).duel.toBase58();
    if (input.escrowAddress !== expected) {
      throw new ConflictException('Persisted duel escrow does not match escrow v2 PDA');
    }
    const account = await this.rpc.getAccountInfo(input.escrowAddress);
    if (!account) throw new ConflictException('Refunding duel escrow account was not found');
    if (account.owner !== ESCROW_V2_PROGRAM_ID.toBase58()) {
      throw new ConflictException('Refunding duel escrow has an unexpected owner');
    }
    return decodeEscrowV4RefundState(account.data);
  }

  private async submit(input: {
    asset: RefundAsset;
    duelId: string;
    idempotencyKey: string;
  }): Promise<void> {
    const prepared = await this.settlement.prepare({
      ...(input.asset.kind === 'card' ? { assetStandard: 'legacy-spl-nft' as const } : {}),
      callerWallet: this.signer.publicKey.toBase58(),
      duelId: input.duelId,
      idempotencyKey: input.idempotencyKey,
      operation: input.asset.kind === 'card' ? 'refund_card' : 'refund_payment',
      side: input.asset.side,
    });
    if (!prepared.intentId) {
      throw new ConflictException('Devnet refund transaction is not monitored');
    }
    const signature = await this.signer.signAndSendPrepared(prepared);
    await this.repository.bindSubmission({
      duelId: input.duelId,
      idempotencyKey: `${input.idempotencyKey}:submission`,
      requiredProgramId: ESCROW_V2_PROGRAM_ID.toBase58(),
      signature,
      transactionId: prepared.intentId,
    });
  }

  private async routeToSettlement(duelId: string, chainStatus: string): Promise<boolean> {
    return this.database.$transaction(async (database) => {
      const duel = await database.duel.findUnique({
        select: { status: true, version: true },
        where: { id: duelId },
      });
      if (!duel || duel.status !== DuelStatus.REFUNDING) return false;
      const changed = await database.duel.updateMany({
        data: { status: DuelStatus.SETTLING, version: { increment: 1 } },
        where: {
          id: duelId,
          status: DuelStatus.REFUNDING,
          version: duel.version,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('Duel changed during refund recovery routing');
      }
      await database.duelEvent.create({
        data: {
          data: {
            chainStatus,
            code: 'RESULT_COMMITMENT_PRESENT',
          },
          duelId,
          fromStatus: DuelStatus.REFUNDING,
          id: createId('evt'),
          sequence: duel.version + 1,
          toStatus: DuelStatus.SETTLING,
          type: 'duel.refund_routed_to_settlement_recovery',
        },
      });
      return true;
    });
  }

  private async complete(
    duelId: string,
    state: EscrowV4RefundState,
    required: RefundAsset[],
    transactions: RefundTransaction[],
  ): Promise<boolean> {
    if (heldAssets(state).length > 0 || required.length === 0) return false;
    const proofs = required.map((asset) => {
      const finalized = transactions.find(
        (transaction) =>
          transaction.status === DuelTransactionStatus.FINALIZED &&
          transaction.signature &&
          sameAsset(parseRefundAsset(transaction.metadata), asset),
      );
      return finalized?.signature
        ? { asset: assetKey(asset), signature: finalized.signature }
        : null;
    });
    if (proofs.some((proof) => proof === null)) return false;
    const finalizedProofs = proofs.filter(
      (proof): proof is { asset: string; signature: string } => proof !== null,
    );
    return this.database.$transaction(async (database) => {
      const duel = await database.duel.findUnique({
        select: { status: true, version: true },
        where: { id: duelId },
      });
      if (!duel || duel.status !== DuelStatus.REFUNDING) return false;
      const changed = await database.duel.updateMany({
        data: { status: DuelStatus.REFUNDED, version: { increment: 1 } },
        where: {
          id: duelId,
          status: DuelStatus.REFUNDING,
          version: duel.version,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('Duel changed during refund finalization');
      }
      await database.duelEvent.create({
        data: {
          data: {
            chainStatus: state.status,
            refunds: finalizedProofs,
          },
          duelId,
          fromStatus: DuelStatus.REFUNDING,
          id: createId('evt'),
          sequence: duel.version + 1,
          toStatus: DuelStatus.REFUNDED,
          type: 'duel.refund_custody_finalized',
        },
      });
      return true;
    });
  }
}

function heldAssets(state: EscrowV4RefundState): RefundAsset[] {
  return (Object.entries(state.custody) as Array<[keyof typeof state.custody, boolean]>).flatMap(
    ([key, held]) => {
      if (!held) return [];
      return [
        {
          kind: key.endsWith('Card') ? ('card' as const) : ('payment' as const),
          side: key.startsWith('creator') ? ('creator' as const) : ('opponent' as const),
        },
      ];
    },
  );
}

function requiredAssets(
  duel: {
    creatorWallet: string;
    devnetPackSnapshots: Array<{ assetReference: string | null; side: string }>;
    opponentWallet: string | null;
    transactions: Array<{
      action: DuelTransactionAction;
      metadata: Prisma.JsonValue | null;
      status: DuelTransactionStatus;
      wallet: string;
    }>;
  },
  refundTransactions: RefundTransaction[],
): RefundAsset[] {
  const required = new Map<string, RefundAsset>();
  for (const transaction of duel.transactions) {
    if (
      transaction.action !== DuelTransactionAction.FUND ||
      transaction.status !== DuelTransactionStatus.FINALIZED
    ) {
      continue;
    }
    const side =
      transaction.wallet === duel.creatorWallet
        ? 'creator'
        : transaction.wallet === duel.opponentWallet
          ? 'opponent'
          : null;
    if (side) required.set(`payment:${side}`, { kind: 'payment', side });
  }
  for (const snapshot of duel.devnetPackSnapshots) {
    if (!snapshot.assetReference) continue;
    const side = snapshot.side.toLowerCase();
    if (side === 'creator' || side === 'opponent') {
      required.set(`card:${side}`, { kind: 'card', side });
    }
  }
  for (const transaction of refundTransactions) {
    const asset = parseRefundAsset(transaction.metadata);
    if (asset) required.set(assetKey(asset), asset);
  }
  return [...required.values()];
}

function nextPreparationKey(
  duelId: string,
  asset: RefundAsset,
  transactions: RefundTransaction[],
): string | null {
  const attempts = transactions.filter((transaction) =>
    sameAsset(parseRefundAsset(transaction.metadata), asset),
  );
  const active = attempts.find((transaction) => ACTIVE_REFUND_STATUSES.has(transaction.status));
  if (active) {
    if (
      active.status === DuelTransactionStatus.PREPARED &&
      !active.signature &&
      active.idempotencyKey &&
      active.lastValidBlockHeight !== null &&
      active.lastRecoveryCheckedBlockHeight !== null &&
      active.lastRecoveryCheckedBlockHeight > active.lastValidBlockHeight
    ) {
      return active.idempotencyKey;
    }
    return null;
  }
  if (attempts.some((transaction) => transaction.status === DuelTransactionStatus.FINALIZED)) {
    throw new ConflictException('Finalized refund did not clear its escrow custody flag');
  }
  return `refund:${duelId}:${assetKey(asset)}:v1:${attempts.length + 1}`;
}

function parseRefundAsset(value: Prisma.JsonValue | null): RefundAsset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const proof = value.proof;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return null;
  const side = proof.side;
  if (side !== 'creator' && side !== 'opponent') return null;
  if (typeof proof.cardMint === 'string') return { kind: 'card', side };
  if (typeof proof.player === 'string') return { kind: 'payment', side };
  return null;
}

function sameAsset(left: RefundAsset | null, right: RefundAsset): boolean {
  return left?.kind === right.kind && left.side === right.side;
}

function assetKey(asset: RefundAsset): string {
  return `${asset.kind}:${asset.side}`;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
