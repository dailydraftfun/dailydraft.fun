import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { FantasyOracleMode, MatchDataOracle } from './match-data-oracle.js';
// biome-ignore lint/style/useImportType: Nest uses the provider class as a runtime injection token.
import { MockMatchDataOracle } from './mock-match-data-oracle.js';

/**
 * Selects the match-data adapter for a given mode. Only the deterministic mock
 * adapter is wired in this foundation pass; requesting the `live` feed fails
 * closed so the loop cannot ingest real data before a provider is approved.
 */
@Injectable()
export class MatchDataOracleService {
  constructor(private readonly mock: MockMatchDataOracle) {}

  forMode(mode: FantasyOracleMode): MatchDataOracle {
    if (mode === 'mock') {
      return this.mock;
    }
    if (mode === 'live') {
      throw new ServiceUnavailableException('The live match-data oracle is not configured');
    }
    throw new ConflictException('Unknown match-data oracle mode');
  }
}
