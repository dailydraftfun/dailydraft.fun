import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type {
  GeneratedPack,
  GeneratePackInput,
  OpenPackInput,
  ProviderPackSnapshot,
} from './pack-provider.js';
import { PackProvider } from './pack-provider.js';

/**
 * Fail-closed boundary for the Collector Crypt partner integration.
 *
 * No HTTP paths or response shapes are encoded here until Collector Crypt
 * confirms the partner contract, authentication, idempotency, alternate
 * recipient behavior, and sandbox availability.
 */
@Injectable()
export class CollectorCryptPackProvider extends PackProvider {
  readonly mode = 'collector-crypt-sandbox' as const;

  async generatePack(_input: GeneratePackInput): Promise<GeneratedPack> {
    return unavailable();
  }

  async openPack(_input: OpenPackInput): Promise<ProviderPackSnapshot> {
    return unavailable();
  }

  async getPack(_providerReference: string): Promise<ProviderPackSnapshot> {
    return unavailable();
  }
}

function unavailable(): never {
  throw new ServiceUnavailableException(
    'Collector Crypt pack operations are disabled until the partner API contract is confirmed',
  );
}
