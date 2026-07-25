import { createHash } from 'node:crypto';
import {
  type DatabaseClient,
  DuelStatus,
  DuelTransactionStatus,
  ProviderMode,
} from '@dailydraft/db';
import { ConflictException, Inject, Injectable } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DevnetDemoSignerService } from './devnet-demo-signer.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { ProviderSettlementService } from './provider-settlement.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { TransactionMonitorService } from './transaction-monitor.service.js';

const MAX_SETTLEMENT_POLL_ATTEMPTS = 120;
const DEFAULT_SETTLEMENT_POLL_MS = 1_000;

@Injectable()
export class DevnetDemoSettlementService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly settlement: ProviderSettlementService,
    private readonly signer: DevnetDemoSignerService,
    private readonly monitor: TransactionMonitorService,
  ) {}

  async finalizeDuel(duelId: string): Promise<void> {
    const providerRequestId = createHash('sha256')
      .update(`dailydraft-demo-result:v1:${duelId}`)
      .digest('hex');

    for (let attempt = 0; attempt < MAX_SETTLEMENT_POLL_ATTEMPTS; attempt += 1) {
      await this.monitor.reconcile(20);
      const duel = await this.database.duel.findUnique({
        select: { providerMode: true, status: true },
        where: { id: duelId },
      });
      if (!duel) throw new ConflictException(`Duel ${duelId} was not found`);
      if (duel.providerMode !== ProviderMode.DAILYDRAFT_DEVNET) {
        throw new ConflictException('Automatic settlement is limited to DailyDraft devnet packs');
      }
      if (duel.status === DuelStatus.SETTLED) return;

      if (duel.status === DuelStatus.AWAITING_ASSETS) {
        const idempotencyKey = `demo:${duelId}:commit-result:v1`;
        if (await this.shouldPrepare(idempotencyKey)) {
          await this.submitPrepared({
            duelId,
            idempotencyKey,
            operation: 'commit_result',
            providerRequestId,
          });
        }
        await wait(settlementPollMs());
        continue;
      }

      if (duel.status === DuelStatus.SETTLING) {
        const idempotencyKey = `demo:${duelId}:settle:v1`;
        if (await this.shouldPrepare(idempotencyKey)) {
          await this.submitPrepared({
            duelId,
            idempotencyKey,
            operation: 'settle',
            providerRequestId,
          });
        }
        await wait(settlementPollMs());
        continue;
      }

      throw new ConflictException(
        `DailyDraft devnet settlement cannot continue from ${duel.status.toLowerCase()}`,
      );
    }

    const final = await this.database.duel.findUnique({
      select: { status: true },
      where: { id: duelId },
    });
    if (final?.status !== DuelStatus.SETTLED) {
      throw new ConflictException('Devnet settlement did not reach finalized state');
    }
  }

  private async shouldPrepare(idempotencyKey: string): Promise<boolean> {
    const active = await this.database.duelTransaction.findUnique({
      select: {
        lastRecoveryCheckedBlockHeight: true,
        lastValidBlockHeight: true,
        status: true,
      },
      where: { idempotencyKey },
    });
    if (!active) return true;
    return (
      active.status === DuelTransactionStatus.PREPARED &&
      active.lastValidBlockHeight !== null &&
      active.lastRecoveryCheckedBlockHeight !== null &&
      active.lastRecoveryCheckedBlockHeight > active.lastValidBlockHeight
    );
  }

  private async submitPrepared(input: {
    duelId: string;
    idempotencyKey: string;
    operation: 'commit_result' | 'settle';
    providerRequestId: string;
  }): Promise<void> {
    const prepared = await this.settlement.prepare({
      assetStandard: 'legacy-spl-nft',
      callerWallet: this.signer.publicKey.toBase58(),
      duelId: input.duelId,
      idempotencyKey: input.idempotencyKey,
      operation: input.operation,
      providerRequestId: input.providerRequestId,
    });
    if (!prepared.intentId) {
      throw new ConflictException('Devnet settlement transaction is not monitored');
    }
    const signature = await this.signer.signAndSendPrepared(prepared);
    await this.monitor.bindSubmission({
      duelId: input.duelId,
      idempotencyKey: `${input.idempotencyKey}:submission`,
      signature,
      transactionId: prepared.intentId,
    });
  }
}

function settlementPollMs(): number {
  const parsed = Number.parseInt(process.env.DAILYDRAFT_SETTLEMENT_POLL_MS ?? '', 10);
  return Number.isInteger(parsed)
    ? Math.max(10, Math.min(parsed, 5_000))
    : DEFAULT_SETTLEMENT_POLL_MS;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
