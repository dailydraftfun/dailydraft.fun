import { Module } from '@nestjs/common';

import { AdminModule } from './admin/admin.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DuelsModule } from './duels/duels.module.js';
import { HealthModule } from './health/health.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';
import { PacksModule } from './packs/packs.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';

@Module({
  imports: [
    DatabaseModule,
    AdminModule,
    AnalyticsModule,
    AuthModule,
    HealthModule,
    MatchmakingModule,
    PacksModule,
    DuelsModule,
    TransactionsModule,
  ],
})
export class AppModule {}
