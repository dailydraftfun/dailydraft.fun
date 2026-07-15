import { ConflictException, Injectable } from '@nestjs/common';

import type { Duel } from '../domain.js';
// biome-ignore lint/style/useImportType: Nest uses the provider class as a runtime injection token.
import { CollectorCryptPackProvider } from './collector-crypt-pack.provider.js';
// biome-ignore lint/style/useImportType: Nest uses the provider class as a runtime injection token.
import { MockPackProvider } from './mock-pack.provider.js';
import type { PackProvider } from './pack-provider.js';

@Injectable()
export class PackProviderService {
  constructor(
    private readonly mock: MockPackProvider,
    private readonly collectorCrypt: CollectorCryptPackProvider,
  ) {}

  forDuel(duel: Pick<Duel, 'environment' | 'providerMode'>): PackProvider {
    if (duel.providerMode === 'mock') {
      if (duel.environment !== 'solana-devnet') {
        throw new ConflictException('The mock pack provider is devnet-only');
      }
      return this.mock;
    }
    return this.collectorCrypt;
  }
}
