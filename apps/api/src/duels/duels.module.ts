import { Module } from '@nestjs/common';

import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import { PacksModule } from '../packs/packs.module.js';
import { DuelsController } from './duels.controller.js';
import { DuelsService } from './duels.service.js';

@Module({
  controllers: [DuelsController],
  imports: [PacksModule],
  providers: [DuelsService, IntegrationKeyGuard],
})
export class DuelsModule {}
