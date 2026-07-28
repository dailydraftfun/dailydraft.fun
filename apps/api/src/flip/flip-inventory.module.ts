import { Module } from '@nestjs/common';

import { FlipInventorySnapshotService } from './flip-inventory-snapshot.service.js';
import { FlipOutcomeSelectionService } from './flip-outcome-selection.service.js';
import { FlipRulesService } from './flip-rules.service.js';
import {
  FLIP_SESSION_CLOCK,
  FLIP_SESSION_ENVIRONMENT,
  FlipSessionStateService,
} from './flip-session-state.service.js';
import {
  EnvironmentFlipProviderHealthAdapter,
  FLIP_PROVIDER_HEALTH_ADAPTER,
} from './flip-tier-admission.policy.js';

/**
 * Fixture-only Marketplace Flip foundation. It intentionally exports no
 * controller or production capability: live acquisition, economics, and
 * promotion remain separate human-reviewed gates.
 */
@Module({
  exports: [
    FlipInventorySnapshotService,
    FlipOutcomeSelectionService,
    FlipRulesService,
    FlipSessionStateService,
  ],
  providers: [
    FlipInventorySnapshotService,
    FlipOutcomeSelectionService,
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
    {
      inject: [FLIP_SESSION_ENVIRONMENT],
      provide: FLIP_PROVIDER_HEALTH_ADAPTER,
      useFactory: (environment: NodeJS.ProcessEnv) =>
        new EnvironmentFlipProviderHealthAdapter(environment),
    },
  ],
})
export class FlipInventoryModule {}
