import { Module } from '@nestjs/common';

import { CollectorCryptPackProvider } from './collector-crypt-pack.provider.js';
import { MockPackProvider } from './mock-pack.provider.js';
import { PackProviderService } from './pack-provider.service.js';
import { ValuationPolicyController } from './valuation-policy.controller.js';
import { ValuationPolicyService } from './valuation-policy.service.js';

@Module({
  controllers: [ValuationPolicyController],
  exports: [PackProviderService, ValuationPolicyService],
  providers: [
    CollectorCryptPackProvider,
    MockPackProvider,
    PackProviderService,
    ValuationPolicyService,
  ],
})
export class ProvidersModule {}
