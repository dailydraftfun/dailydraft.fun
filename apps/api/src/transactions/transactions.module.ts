import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
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
  imports: [AuthModule],
  providers: [
    WorkerKeyGuard,
    TransactionMonitorService,
    { provide: TransactionMonitorRepository, useClass: PrismaTransactionMonitorRepository },
    { provide: SolanaRpcGateway, useClass: SolanaRpcClient },
  ],
})
export class TransactionsModule {}
