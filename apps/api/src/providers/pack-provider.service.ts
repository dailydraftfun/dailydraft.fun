import {
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { Duel } from '../domain.js';
// biome-ignore lint/style/useImportType: Nest uses the provider class as a runtime injection token.
import { CollectorCryptPackProvider } from './collector-crypt-pack.provider.js';
// biome-ignore lint/style/useImportType: Nest uses the provider class as a runtime injection token.
import { DevnetDemoPackProvider } from './devnet-demo-pack.provider.js';
// biome-ignore lint/style/useImportType: Nest uses the provider class as a runtime injection token.
import { MockPackProvider } from './mock-pack.provider.js';
import type { PackProvider } from './pack-provider.js';

@Injectable()
export class PackProviderService {
  constructor(
    private readonly mock: MockPackProvider,
    private readonly collectorCrypt: CollectorCryptPackProvider,
    @Optional() private readonly devnetDemo?: DevnetDemoPackProvider,
  ) {}

  forDuel(duel: Pick<Duel, 'environment' | 'providerMode'>): PackProvider {
    if (duel.providerMode === 'mock') {
      if (duel.environment !== 'solana-devnet') {
        throw new ConflictException('The mock pack provider is devnet-only');
      }
      return this.mock;
    }
    if (duel.providerMode === 'openpacksduel-devnet') {
      if (duel.environment !== 'solana-devnet') {
        throw new ConflictException('The OpenPacks demo provider is devnet-only');
      }
      if (!this.devnetDemo) {
        throw new ServiceUnavailableException('The OpenPacks demo provider is not configured');
      }
      return this.devnetDemo;
    }
    return this.collectorCrypt;
  }
}
