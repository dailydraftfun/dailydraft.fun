import { Module } from '@nestjs/common';

import { GachaController } from './gacha.controller.js';
import { GachaInventorySnapshotService } from './gacha-inventory-snapshot.service.js';
import { GachaRipService } from './gacha-rip.service.js';
import {
  FixtureSportsPackGachaProvider,
  gachaFixtureModeEnabled,
} from './sports-pack-gacha.fixture.js';
import {
  CollectorCryptSportsPackGachaProvider,
  SportsPackGachaProvider,
} from './sports-pack-gacha.provider.js';

@Module({
  controllers: [GachaController],
  exports: [GachaInventorySnapshotService, GachaRipService, SportsPackGachaProvider],
  providers: [
    CollectorCryptSportsPackGachaProvider,
    FixtureSportsPackGachaProvider,
    GachaInventorySnapshotService,
    GachaRipService,
    {
      inject: [CollectorCryptSportsPackGachaProvider, FixtureSportsPackGachaProvider],
      provide: SportsPackGachaProvider,
      useFactory: (
        collectorCrypt: CollectorCryptSportsPackGachaProvider,
        fixture: FixtureSportsPackGachaProvider,
      ) => (gachaFixtureModeEnabled() ? fixture : collectorCrypt),
    },
  ],
})
export class GachaModule {}
