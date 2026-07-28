import { Module } from '@nestjs/common';

import { AdminModule } from './admin/admin.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CrashModule } from './crash/crash.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DuelsModule } from './duels/duels.module.js';
import { FantasyModule } from './fantasy/fantasy.module.js';
import { FlipInventoryModule } from './flip/flip-inventory.module.js';
import { GachaModule } from './gacha/gacha.module.js';
import { GamesModule } from './games/games.module.js';
import { HealthModule } from './health/health.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';
import { PacksModule } from './packs/packs.module.js';
import { RealValuePolicyModule } from './policy/real-value-policy.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { RgsModule } from './rgs/rgs.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';
import { HouseTreasuryModule } from './treasury/house-treasury.module.js';

@Module({
  imports: [
    DatabaseModule,
    AdminModule,
    AnalyticsModule,
    AuthModule,
    CrashModule,
    HealthModule,
    RealValuePolicyModule,
    MatchmakingModule,
    PacksModule,
    ProvidersModule,
    FlipInventoryModule,
    GachaModule,
    GamesModule,
    RgsModule,
    FantasyModule,
    DuelsModule,
    TransactionsModule,
    HouseTreasuryModule,
  ],
})
export class AppModule {}
