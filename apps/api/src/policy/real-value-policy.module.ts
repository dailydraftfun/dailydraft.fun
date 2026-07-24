import { Global, Module } from '@nestjs/common';

import { RealValuePolicyGuard } from './real-value-policy.guard.js';
import { RealValuePolicyService } from './real-value-policy.service.js';

@Global()
@Module({
  exports: [RealValuePolicyGuard, RealValuePolicyService],
  providers: [RealValuePolicyGuard, RealValuePolicyService],
})
export class RealValuePolicyModule {}
