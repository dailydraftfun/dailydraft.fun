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

  test('carries no trace of the retired brand in either published policy', () => {
    const published = `${stableStringify(CANONICAL_VALUATION_POLICY)}${stableStringify(
      DEVNET_DEMO_VALUATION_POLICY,
    )}`.toLowerCase();

    expect(published).not.toContain('openpacksduel');
    expect(published).toContain('dailydraft.valuation-policy.v1');
    expect(published).toContain('dailydraft-pokemon-tcg-market-usdc-v1');
  });
});

// The policy hashes are duplicated into the published OpenAPI document and the
// documentation fixtures, and nothing previously compared those copies to the
// constants they mirror. A rename that moved the hashes would have left the
// published contract advertising values the API rejects, so the whole documents
// are asserted rather than the fields that happened to be remembered.
const openapi = await Bun.file(
  new URL('../../../docs/public/openapi.yaml', import.meta.url),
).text();
const guide = await Bun.file(
  new URL('../../../docs/content/guides/valuation-and-proof.mdx', import.meta.url),
).text();

describe('published valuation-policy contract copies', () => {
  test('quotes both live hashes in the published valuation guide', () => {
    expect(guide).toContain(CANONICAL_VALUATION_POLICY_HASH);
    expect(guide).toContain(DEVNET_DEMO_VALUATION_POLICY_HASH);
    expect(guide).toContain(DEVNET_DEMO_VALUATION_POLICY.policyVersion);
    expect(guide.toLowerCase()).not.toContain('openpacksduel');
  });

  test('advertises exactly the supported policy hashes and identifiers', () => {
    expect(openapi).toContain(`            - ${CANONICAL_VALUATION_POLICY_HASH}\n`);
    expect(openapi).toContain(`            - ${DEVNET_DEMO_VALUATION_POLICY_HASH}\n`);
    expect(openapi).toContain(`const: ${CANONICAL_VALUATION_POLICY.schemaVersion}\n`);
    expect(
      openapi.match(
        new RegExp(
          `enum: \\[${CANONICAL_VALUATION_POLICY.policyVersion}, ${DEVNET_DEMO_VALUATION_POLICY.policyVersion}\\]`,
          'g',
        ),
      ),
    ).toHaveLength(2);
    expect(openapi.toLowerCase()).not.toContain('openpacksduel');
  });

  test.each([
    'equal-value',
    'provider-correction',
    'stale-value',
  ])('pins the %s fixture to a supported policy hash', async (fixture) => {
    const source = await Bun.file(
      new URL(`../../../docs/public/fixtures/valuation/${fixture}.json`, import.meta.url),
    ).text();

    expect(source.toLowerCase()).not.toContain('openpacksduel');
    expect(requireCanonicalValuationPolicyHash(JSON.parse(source).policyHash)).toBe(
      CANONICAL_VALUATION_POLICY_HASH,
    );
  });
});
