import { Module } from '@nestjs/common';

import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import { SolanaRpcClient, SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  controllers: [AdminController],
  exports: [AdminService],
  providers: [
    AdminService,
    IntegrationKeyGuard,
    { provide: SolanaRpcGateway, useClass: SolanaRpcClient },
  ],
})
export class AdminModule {}
