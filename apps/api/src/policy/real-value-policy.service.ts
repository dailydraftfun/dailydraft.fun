import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { DatabaseClient, Prisma } from '@openpacksduel/db';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import {
  evaluateRealValuePolicy,
  REAL_VALUE_POLICY_DENIAL_MESSAGES,
  type RealValueCapability,
  type RealValuePolicyDecision,
} from './real-value-policy.js';

export class RealValuePolicyDeniedException extends ServiceUnavailableException {
  constructor(readonly decision: Extract<RealValuePolicyDecision, { allowed: false }>) {
    super({
      capability: decision.capability,
      code: 'REAL_VALUE_POLICY_DENIED',
      message: REAL_VALUE_POLICY_DENIAL_MESSAGES[decision.denialReason],
      policyHash: decision.policyHash,
      policyVersion: decision.policyVersion,
      reason: decision.denialReason,
      runtimeMode: decision.runtimeMode,
    });
  }
}

@Injectable()
export class RealValuePolicyService {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  async assertAllowed(
    capability: RealValueCapability,
    environment: NodeJS.ProcessEnv = process.env,
    evaluatedAt = new Date(),
  ): Promise<RealValuePolicyDecision> {
    const decision = evaluateRealValuePolicy(capability, environment);
    try {
      await this.database.realValuePolicyDecision.create({
        data: {
          allowed: decision.allowed,
          capability: decision.capability,
          denialReason: decision.denialReason,
          evaluatedAt,
          evidence: decision.evidence as unknown as Prisma.InputJsonValue,
          id: createId(),
          policyHash: decision.policyHash,
          policyVersion: decision.policyVersion,
          runtimeMode: decision.runtimeMode,
          schemaVersion: decision.evidence.schemaVersion,
        },
      });
    } catch {
      throw new ServiceUnavailableException({
        capability,
        code: 'REAL_VALUE_POLICY_EVIDENCE_UNAVAILABLE',
        message: 'Real-value admission is disabled: decision evidence could not be retained',
        reason: 'decision_evidence_unavailable',
      });
    }
    if (!decision.allowed) throw new RealValuePolicyDeniedException(decision);
    return decision;
  }
}

function createId(): string {
  return `rvpd_${crypto.randomUUID().replaceAll('-', '')}`;
}
