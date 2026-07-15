import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DuelFundingService } from './duel-funding.service.js';
import { PrismaTransactionMonitorRepository } from './prisma-transaction-monitor.repository.js';
import { SolanaRpcClient, SolanaRpcGateway } from './solana-rpc.client.js';
import {
  TransactionReconciliationController,
  TransactionSubmissionController,
} from './transaction-monitor.controller.js';
import { TransactionMonitorRepository } from './transaction-monitor.repository.js';
import { TransactionMonitorService } from './transaction-monitor.service.js';
import { WorkerKeyGuard } from './worker-key.guard.js';

@Module({
  controllers: [TransactionSubmissionController, TransactionReconciliationController],
  exports: [DuelFundingService, SolanaRpcGateway],
  imports: [AdminModule, AnalyticsModule, AuthModule],
  providers: [
    WorkerKeyGuard,
    DuelFundingService,
    TransactionMonitorService,
    { provide: TransactionMonitorRepository, useClass: PrismaTransactionMonitorRepository },
    { provide: SolanaRpcGateway, useClass: SolanaRpcClient },
  ],
})
export class TransactionsModule {}
