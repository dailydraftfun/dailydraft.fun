import { Injectable, NotFoundException } from '@nestjs/common';

import {
  CANONICAL_VALUATION_POLICY,
  CANONICAL_VALUATION_POLICY_HASH,
} from './valuation-policy.js';

@Injectable()
export class ValuationPolicyService {
  findCurrent() {
    return {
      hashAlgorithm: 'sha256' as const,
      policy: CANONICAL_VALUATION_POLICY,
      policyHash: CANONICAL_VALUATION_POLICY_HASH,
    };
  }

  findOne(policyHash: string) {
    if (policyHash !== CANONICAL_VALUATION_POLICY_HASH) {
      throw new NotFoundException(`Valuation policy ${policyHash} was not found`);
    }
    return this.findCurrent();
  }
}
