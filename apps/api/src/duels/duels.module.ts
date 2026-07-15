import { Module } from '@nestjs/common';

import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import { PacksModule } from '../packs/packs.module.js';
import { DuelRepository } from './duel.repository.js';
import { DuelsController } from './duels.controller.js';
import { DuelsService } from './duels.service.js';
import { PrismaDuelRepository } from './prisma-duel.repository.js';

@Module({
  controllers: [DuelsController],
  imports: [PacksModule],
  providers: [
    DuelsService,
    IntegrationKeyGuard,
    { provide: DuelRepository, useClass: PrismaDuelRepository },
  ],
})
export class DuelsModule {}
