import { Module } from '@nestjs/common';

import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import { SolanaRpcClient, SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import { WorkerKeyGuard } from '../transactions/worker-key.guard.js';
import {
  HouseTreasuryAdminController,
  HouseTreasuryReconciliationController,
} from './house-treasury.controller.js';
import { HouseTreasuryService } from './house-treasury.service.js';

@Module({
  controllers: [HouseTreasuryAdminController, HouseTreasuryReconciliationController],
  exports: [HouseTreasuryService],
  providers: [
    HouseTreasuryService,
    IntegrationKeyGuard,
    WorkerKeyGuard,
    { provide: SolanaRpcGateway, useClass: SolanaRpcClient },
  ],
})
export class HouseTreasuryModule {}
