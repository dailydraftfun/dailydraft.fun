import { Module } from '@nestjs/common';

import { FlipInventorySnapshotService } from './flip-inventory-snapshot.service.js';
import { FlipRulesService } from './flip-rules.service.js';
import {
  FLIP_SESSION_CLOCK,
  FLIP_SESSION_ENVIRONMENT,
  FlipSessionStateService,
} from './flip-session-state.service.js';

/**
 * Fixture-only Marketplace Flip foundation. It intentionally exports no
 * controller or production capability: live acquisition, economics, and
 * promotion remain separate human-reviewed gates.
 */
@Module({
  exports: [FlipInventorySnapshotService, FlipRulesService, FlipSessionStateService],
  providers: [
    FlipInventorySnapshotService,
    FlipRulesService,
    FlipSessionStateService,
    {
      provide: FLIP_SESSION_CLOCK,
      useValue: { now: () => new Date() },
    },
    {
      provide: FLIP_SESSION_ENVIRONMENT,
      useFactory: () => process.env,
    },
  ],
})
export class FlipInventoryModule {}
