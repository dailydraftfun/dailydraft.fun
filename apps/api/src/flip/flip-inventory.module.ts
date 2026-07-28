import { Module } from '@nestjs/common';

import { FlipInventorySnapshotService } from './flip-inventory-snapshot.service.js';
import { FlipRulesService } from './flip-rules.service.js';

@Module({
  exports: [FlipInventorySnapshotService, FlipRulesService],
  providers: [FlipInventorySnapshotService, FlipRulesService],
})
export class FlipInventoryModule {}
