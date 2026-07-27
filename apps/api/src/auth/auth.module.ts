import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { WalletAuthRepository } from './auth.repository.js';
import { DuelMutationGuard } from './duel-mutation.guard.js';
import { PrismaWalletAuthRepository } from './prisma-auth.repository.js';
import { WalletAuthService } from './wallet-auth.service.js';
import { WalletSessionGuard } from './wallet-session.guard.js';

@Module({
  controllers: [AuthController],
  exports: [DuelMutationGuard, WalletAuthService, WalletSessionGuard],
  providers: [
    DuelMutationGuard,
    WalletAuthService,
    WalletSessionGuard,
    { provide: WalletAuthRepository, useClass: PrismaWalletAuthRepository },
  ],
})
export class AuthModule {}
