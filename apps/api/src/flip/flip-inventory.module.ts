import { Module } from '@nestjs/common';

import { FlipInventorySnapshotService } from './flip-inventory-snapshot.service.js';

@Module({
  exports: [FlipInventorySnapshotService],
  providers: [FlipInventorySnapshotService],
})
export class FlipInventoryModule {}
