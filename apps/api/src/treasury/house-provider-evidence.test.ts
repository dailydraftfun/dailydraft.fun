import { describe, expect, test } from 'bun:test';

import {
  assertHouseProviderEvidence,
  createHouseProviderEvidence,
  providerReferenceKey,
} from './house-provider-evidence.js';

const PROVIDER = 'fixture-marketplace';
const SIGNING_KEY = 'fixture-marketplace-signing-key-32-bytes-minimum';
const PAYLOAD = {
  inventoryId: 'hinv_1234567890abcdef1234567890abcdef',
  provider: PROVIDER,
  reference: 'provider-reference',
  status: 'cancelled',
};

describe('house marketplace provider evidence', () => {
  test('verifies one provider-scoped canonical HMAC and stable reference key', () => {
    const evidence = createHouseProviderEvidence(PAYLOAD, SIGNING_KEY);
    const environment = {
      DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS: JSON.stringify({ [PROVIDER]: SIGNING_KEY }),
    };

    expect(() =>
      assertHouseProviderEvidence(PROVIDER, PAYLOAD, evidence, environment),
    ).not.toThrow();
    expect(providerReferenceKey(PROVIDER, 'provider-reference')).toHaveLength(64);
    expect(providerReferenceKey(PROVIDER, 'provider-reference')).not.toBe(
      providerReferenceKey(PROVIDER, 'different-reference'),
    );
  });

  test('rejects tampering, missing provider scope, and malformed key configuration', () => {
    const evidence = createHouseProviderEvidence(PAYLOAD, SIGNING_KEY);
    const environment = {
      DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS: JSON.stringify({ [PROVIDER]: SIGNING_KEY }),
    };

    expect(() =>
      assertHouseProviderEvidence(PROVIDER, { ...PAYLOAD, status: 'sold' }, evidence, environment),
    ).toThrow('provider evidence is invalid');
    expect(() =>
      assertHouseProviderEvidence('unknown-provider', PAYLOAD, evidence, environment),
    ).toThrow('not configured');
    expect(() =>
      assertHouseProviderEvidence(PROVIDER, PAYLOAD, evidence, {
        DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS: '{not-json',
      }),
    ).toThrow('keys are malformed');
    expect(() =>
      assertHouseProviderEvidence(PROVIDER, PAYLOAD, evidence, {
        DAILYDRAFT_MARKETPLACE_PROVIDER_KEYS: JSON.stringify({ [PROVIDER]: 'short' }),
      }),
    ).toThrow('keys are malformed');
  });
});
