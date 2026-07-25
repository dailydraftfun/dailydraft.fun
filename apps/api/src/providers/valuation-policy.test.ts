import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import {
  CANONICAL_VALUATION_POLICY,
  CANONICAL_VALUATION_POLICY_HASH,
  currentValuationPolicy,
  DEVNET_DEMO_VALUATION_POLICY,
  DEVNET_DEMO_VALUATION_POLICY_HASH,
  requireCanonicalValuationPolicyHash,
  stableStringify,
} from './valuation-policy.js';
import { ValuationPolicyService } from './valuation-policy.service.js';

const originalProviderMode = process.env.DAILYDRAFT_PROVIDER_MODE;

afterEach(() => {
  if (originalProviderMode === undefined) delete process.env.DAILYDRAFT_PROVIDER_MODE;
  else process.env.DAILYDRAFT_PROVIDER_MODE = originalProviderMode;
});

describe('canonical valuation policy', () => {
  test('pins the published canonical JSON to its pre-funding SHA-256 commitment', () => {
    expect(
      createHash('sha256').update(stableStringify(CANONICAL_VALUATION_POLICY)).digest('hex'),
    ).toBe(CANONICAL_VALUATION_POLICY_HASH);
    expect(new ValuationPolicyService().findCurrent()).toEqual({
      hashAlgorithm: 'sha256',
      policy: CANONICAL_VALUATION_POLICY,
      policyHash: CANONICAL_VALUATION_POLICY_HASH,
    });
  });

  test('rejects missing, malformed, and different policy versions', () => {
    expect(() => requireCanonicalValuationPolicyHash(undefined)).toThrow(
      'unsupported or does not match',
    );
    expect(() => requireCanonicalValuationPolicyHash('a'.repeat(64))).toThrow(
      'unsupported or does not match',
    );
    expect(() => new ValuationPolicyService().findOne('a'.repeat(64))).toThrow('was not found');
  });

  test('publishes the distinct devnet Pokémon TCG market policy', () => {
    expect(
      createHash('sha256').update(stableStringify(DEVNET_DEMO_VALUATION_POLICY)).digest('hex'),
    ).toBe(DEVNET_DEMO_VALUATION_POLICY_HASH);
    expect(requireCanonicalValuationPolicyHash(DEVNET_DEMO_VALUATION_POLICY_HASH)).toBe(
      DEVNET_DEMO_VALUATION_POLICY_HASH,
    );
    expect(new ValuationPolicyService().findOne(DEVNET_DEMO_VALUATION_POLICY_HASH)).toEqual({
      hashAlgorithm: 'sha256',
      policy: DEVNET_DEMO_VALUATION_POLICY,
      policyHash: DEVNET_DEMO_VALUATION_POLICY_HASH,
    });
  });

  test('selects the policy that matches the configured provider mode', () => {
    process.env.DAILYDRAFT_PROVIDER_MODE = 'dailydraft-devnet';

    expect(currentValuationPolicy()).toEqual({
      policy: DEVNET_DEMO_VALUATION_POLICY,
      policyHash: DEVNET_DEMO_VALUATION_POLICY_HASH,
    });

    process.env.DAILYDRAFT_PROVIDER_MODE = 'collector-crypt-sandbox';

    expect(currentValuationPolicy()).toEqual({
      policy: CANONICAL_VALUATION_POLICY,
      policyHash: CANONICAL_VALUATION_POLICY_HASH,
    });
  });
});
