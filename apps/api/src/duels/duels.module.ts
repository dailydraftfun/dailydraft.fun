import { Module } from '@nestjs/common';

import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import { PacksModule } from '../packs/packs.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { DuelRepository } from './duel.repository.js';
import { DuelOpeningService } from './duel-opening.service.js';
import { DuelsController } from './duels.controller.js';
import { DuelsService } from './duels.service.js';
import { PrismaDuelRepository } from './prisma-duel.repository.js';

@Module({
  controllers: [DuelsController],
  imports: [PacksModule, ProvidersModule],
  providers: [
    DuelsService,
    DuelOpeningService,
    IntegrationKeyGuard,
    { provide: DuelRepository, useClass: PrismaDuelRepository },
  ],
})
export class DuelsModule {}
