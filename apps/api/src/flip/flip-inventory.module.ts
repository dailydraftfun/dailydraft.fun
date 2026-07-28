import { Module } from '@nestjs/common';

import {
  DeterministicFlipAcquisitionFixtureProvider,
  FLIP_ACQUISITION_PROVIDER,
} from './flip-acquisition.provider.js';
import { FlipAcquisitionService } from './flip-acquisition.service.js';
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
    FlipAcquisitionService,
    FlipInventorySnapshotService,
    FlipOutcomeSelectionService,
    FlipRulesService,
    FlipSessionStateService,
  ],
  providers: [
    FlipAcquisitionService,
    FlipInventorySnapshotService,
    FlipOutcomeSelectionService,
    FlipRulesService,
    FlipSessionStateService,
    {
      provide: FLIP_ACQUISITION_PROVIDER,
      useClass: DeterministicFlipAcquisitionFixtureProvider,
    },
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
