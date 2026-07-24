import { describe, expect, test } from 'bun:test';

import type { FantasyOracleMode } from './match-data-oracle.js';
import { MatchDataOracleService } from './match-data-oracle.service.js';
import { MockMatchDataOracle } from './mock-match-data-oracle.js';

describe('MatchDataOracleService', () => {
  test('selects the mock adapter and fails closed for unavailable modes', () => {
    const mock = new MockMatchDataOracle();
    const service = new MatchDataOracleService(mock);

    expect(service.forMode('mock')).toBe(mock);
    expect(() => service.forMode('live')).toThrow('live match-data oracle is not configured');
    expect(() => service.forMode('unknown' as FantasyOracleMode)).toThrow(
      'Unknown match-data oracle mode',
    );
  });
});
