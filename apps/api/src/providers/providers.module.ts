import { Module } from '@nestjs/common';

import { TransactionsModule } from '../transactions/transactions.module.js';
import { CollectorCryptPackProvider } from './collector-crypt-pack.provider.js';
import { DevnetDemoPackProvider } from './devnet-demo-pack.provider.js';
import { MockPackProvider } from './mock-pack.provider.js';
import { PackProviderService } from './pack-provider.service.js';
import { PokemonTcgClient } from './pokemon-tcg.client.js';
import { ValuationPolicyController } from './valuation-policy.controller.js';
import { ValuationPolicyService } from './valuation-policy.service.js';

@Module({
  controllers: [ValuationPolicyController],
  exports: [PackProviderService, ValuationPolicyService],
  imports: [TransactionsModule],
  providers: [
    CollectorCryptPackProvider,
    DevnetDemoPackProvider,
    MockPackProvider,
    PackProviderService,
    PokemonTcgClient,
    ValuationPolicyService,
  ],
})
export class ProvidersModule {}
