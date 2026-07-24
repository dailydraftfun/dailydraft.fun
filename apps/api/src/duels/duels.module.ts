import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import { PacksModule } from '../packs/packs.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { DuelRepository } from './duel.repository.js';
import { DuelOpeningService } from './duel-opening.service.js';
import {
  DuelLeaderboardController,
  DuelProfilesController,
  DuelsController,
} from './duels.controller.js';
import { DuelsService } from './duels.service.js';
import { PrismaDuelRepository } from './prisma-duel.repository.js';
import { ProviderOpeningRepository } from './provider-opening.repository.js';

@Module({
  controllers: [DuelsController, DuelProfilesController, DuelLeaderboardController],
  imports: [
    AdminModule,
    AnalyticsModule,
    AuthModule,
    PacksModule,
    ProvidersModule,
    TransactionsModule,
  ],
  providers: [
    DuelsService,
    DuelOpeningService,
    ProviderOpeningRepository,
    IntegrationKeyGuard,
    { provide: DuelRepository, useClass: PrismaDuelRepository },
  ],
})
export class DuelsModule {}
