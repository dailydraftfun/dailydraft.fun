import { afterEach, describe, expect, test } from 'bun:test';
import {
  CANONICAL_VALUATION_POLICY_HASH,
  DEVNET_DEMO_VALUATION_POLICY_HASH,
} from '../providers/valuation-policy.js';
import { PACK_TIER_CATALOG } from './pack-catalog.js';
import { PacksService } from './packs.service.js';

const originalProviderMode = process.env.DAILYDRAFT_PROVIDER_MODE;

afterEach(() => {
  if (originalProviderMode === undefined) delete process.env.DAILYDRAFT_PROVIDER_MODE;
  else process.env.DAILYDRAFT_PROVIDER_MODE = originalProviderMode;
});

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

  test('advertises the demo provider and its policy when devnet mode is configured', () => {
    process.env.DAILYDRAFT_PROVIDER_MODE = 'dailydraft-devnet';

    const result = new PacksService().findAll({ limit: 20 });

    expect(result.data[0]?.provider).toBe('dailydraft-devnet');
    expect(result.data[0]?.valuationPolicyHash).toBe(DEVNET_DEMO_VALUATION_POLICY_HASH);
  });
});
