import { describe, expect, test } from 'bun:test';
import { CANONICAL_VALUATION_POLICY_HASH } from '../providers/valuation-policy.js';
import { PACK_TIER_CATALOG } from './pack-catalog.js';
import { PacksService } from './packs.service.js';

describe('PacksService', () => {
  test('lists the active preview pack by default', () => {
    const result = new PacksService().findAll({ limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('pokemon_50');
    expect(result.data[0]?.name).toBe(PACK_TIER_CATALOG.find((pack) => pack.supported)?.name);
    expect(result.data[0]?.valuationPolicyHash).toBe(CANONICAL_VALUATION_POLICY_HASH);
    expect(result.hasMore).toBe(false);
  });

  test('rejects unknown pack ids', () => {
    expect(() => new PacksService().findOne('missing')).toThrow('was not found');
  });
});
