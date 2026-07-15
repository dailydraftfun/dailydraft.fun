import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DuelsModule } from './duels/duels.module.js';
import { HealthModule } from './health/health.module.js';
import { PacksModule } from './packs/packs.module.js';

@Module({ imports: [DatabaseModule, AuthModule, HealthModule, PacksModule, DuelsModule] })
export class AppModule {}
