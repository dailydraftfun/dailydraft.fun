import { Module } from '@nestjs/common';

import { DuelsModule } from './duels/duels.module.js';
import { HealthModule } from './health/health.module.js';
import { PacksModule } from './packs/packs.module.js';

@Module({ imports: [HealthModule, PacksModule, DuelsModule] })
export class AppModule {}
