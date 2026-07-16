import { Injectable, NotFoundException } from '@nestjs/common';

import { currentValuationPolicy, valuationPolicyForHash } from './valuation-policy.js';

@Injectable()
export class ValuationPolicyService {
  findCurrent() {
    const current = currentValuationPolicy();
    return {
      hashAlgorithm: 'sha256' as const,
      ...current,
    };
  }

  findOne(policyHash: string) {
    try {
      return {
        hashAlgorithm: 'sha256' as const,
        policy: valuationPolicyForHash(policyHash),
        policyHash,
      };
    } catch {
      throw new NotFoundException(`Valuation policy ${policyHash} was not found`);
    }
  }
}
