import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { type DatabaseClient, DuelStatus, ProviderMode } from '@openpacksduel/db';

import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DevnetDemoSignerService } from './devnet-demo-signer.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { ProviderSettlementService } from './provider-settlement.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { TransactionMonitorService } from './transaction-monitor.service.js';

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
      .update(`openpacksduel-demo-result:v1:${duelId}`)
      .digest('hex');

    for (let step = 0; step < 4; step += 1) {
      await this.monitor.reconcile(20);
      const duel = await this.database.duel.findUnique({
        select: { providerMode: true, status: true },
        where: { id: duelId },
      });
      if (!duel) throw new ConflictException(`Duel ${duelId} was not found`);
      if (duel.providerMode !== ProviderMode.OPENPACKSDUEL_DEVNET) {
        throw new ConflictException('Automatic settlement is limited to OpenPacks devnet packs');
      }
      if (duel.status === DuelStatus.SETTLED) return;

      if (duel.status === DuelStatus.AWAITING_ASSETS) {
        await this.submitPrepared({
          duelId,
          idempotencyKey: `demo:${duelId}:commit-result:v1`,
          operation: 'commit_result',
          providerRequestId,
        });
        await this.monitor.reconcile(20);
        continue;
      }

      if (duel.status === DuelStatus.SETTLING) {
        await this.submitPrepared({
          duelId,
          idempotencyKey: `demo:${duelId}:settle:v1`,
          operation: 'settle',
          providerRequestId,
        });
        await this.monitor.reconcile(20);
        continue;
      }

      throw new ConflictException(
        `OpenPacks devnet settlement cannot continue from ${duel.status.toLowerCase()}`,
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
