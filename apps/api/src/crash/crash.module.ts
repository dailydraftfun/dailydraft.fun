import { Module } from '@nestjs/common';

import { CRASH_CLOCK, CRASH_ENVIRONMENT, CrashStageStateService } from './crash-stage-state.js';

/**
 * Durable fixture-only Crash foundation. It intentionally exports no
 * controller or production capability: the state service remains unreachable
 * from public HTTP until the separate architecture/economics HITL gate closes.
 */
@Module({
  exports: [CrashStageStateService],
  providers: [
    CrashStageStateService,
    {
      provide: CRASH_CLOCK,
      useValue: { now: () => new Date() },
    },
    {
      provide: CRASH_ENVIRONMENT,
      useFactory: () => process.env,
    },
  ],
})
export class CrashModule {}
