import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import { HouseTreasuryModule } from '../treasury/house-treasury.module.js';
import { DevnetDemoSettlementService } from './devnet-demo-settlement.service.js';
import { DevnetDemoSignerService } from './devnet-demo-signer.service.js';
import { DuelFundingService } from './duel-funding.service.js';
import { PrismaTransactionMonitorRepository } from './prisma-transaction-monitor.repository.js';
import { ProviderSettlementService } from './provider-settlement.service.js';
import { SolanaRpcClient, SolanaRpcGateway } from './solana-rpc.client.js';
import {
  ProviderSettlementController,
  TransactionReconciliationController,
  TransactionSubmissionController,
} from './transaction-monitor.controller.js';
import { TransactionMonitorRepository } from './transaction-monitor.repository.js';
import { TransactionMonitorService } from './transaction-monitor.service.js';
import { WorkerKeyGuard } from './worker-key.guard.js';

@Module({
  controllers: [
    TransactionSubmissionController,
    TransactionReconciliationController,
    ProviderSettlementController,
  ],
  exports: [
    DevnetDemoSettlementService,
    DevnetDemoSignerService,
    DuelFundingService,
    SolanaRpcGateway,
  ],
  imports: [AdminModule, AnalyticsModule, AuthModule, HouseTreasuryModule],
  providers: [
    WorkerKeyGuard,
    IntegrationKeyGuard,
    DevnetDemoSettlementService,
    DevnetDemoSignerService,
    ProviderSettlementService,
    DuelFundingService,
    TransactionMonitorService,
    { provide: TransactionMonitorRepository, useClass: PrismaTransactionMonitorRepository },
    { provide: SolanaRpcGateway, useClass: SolanaRpcClient },
  ],
})
export class TransactionsModule {}
