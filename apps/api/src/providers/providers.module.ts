import { Module } from '@nestjs/common';

import { CollectorCryptPackProvider } from './collector-crypt-pack.provider.js';
import { MockPackProvider } from './mock-pack.provider.js';
import { PackProviderService } from './pack-provider.service.js';

@Module({
  exports: [PackProviderService],
  providers: [CollectorCryptPackProvider, MockPackProvider, PackProviderService],
})
export class ProvidersModule {}
