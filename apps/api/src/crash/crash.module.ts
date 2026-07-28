import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CrashController } from './crash.controller.js';
import {
  CRASH_DECISION_RULES,
  CrashDecisionService,
  loadCrashDecisionRules,
} from './crash-decision.service.js';
import { CRASH_CLOCK, CRASH_ENVIRONMENT, CrashStageStateService } from './crash-stage-state.js';

/**
 * Durable fixture-only Crash foundation. The authenticated controller remains
 * unreachable unless explicit non-production fixture mode and matching,
 * hash-committed rules are configured; it never promotes product capability.
 */
@Module({
  controllers: [CrashController],
  exports: [CrashDecisionService, CrashStageStateService],
  imports: [AuthModule],
  providers: [
    CrashStageStateService,
    CrashDecisionService,
    {
      provide: CRASH_DECISION_RULES,
      useFactory: () => loadCrashDecisionRules(),
    },
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
