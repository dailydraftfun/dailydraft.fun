import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CrashController } from './crash.controller.js';
import {
  CRASH_CUSTODY_POLICY,
  CrashCustodyMovementService,
  loadCrashCustodyPolicy,
} from './crash-custody-movement.service.js';
import {
  CRASH_DECISION_RULES,
  CRASH_RISK_HEALTH,
  CrashDecisionService,
  loadCrashDecisionRules,
  loadCrashRiskHealth,
} from './crash-decision.service.js';
import { CrashRiskGate, CrashRiskPolicyService } from './crash-risk.policy.js';
import { CRASH_CLOCK, CRASH_ENVIRONMENT, CrashStageStateService } from './crash-stage-state.js';

/**
 * Durable fixture-only Crash foundation. The authenticated controller remains
 * unreachable unless explicit non-production fixture mode and matching,
 * hash-committed rules are configured; it never promotes product capability.
 */
@Module({
  controllers: [CrashController],
  exports: [CrashCustodyMovementService, CrashDecisionService, CrashStageStateService],
  imports: [AuthModule],
  providers: [
    CrashStageStateService,
    CrashCustodyMovementService,
    CrashDecisionService,
    {
      provide: CRASH_CUSTODY_POLICY,
      useFactory: () => loadCrashCustodyPolicy(),
    },
    {
      provide: CrashRiskGate,
      useFactory: () => new CrashRiskPolicyService(process.env),
    },
    {
      provide: CRASH_DECISION_RULES,
      useFactory: () => loadCrashDecisionRules(),
    },
    {
      provide: CRASH_RISK_HEALTH,
      useFactory: () => loadCrashRiskHealth(),
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
