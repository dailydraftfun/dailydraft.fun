import { describe, expect, test } from 'bun:test';

import {
  canonicalFlipAcquisitionStringify,
  createFixtureFlipAcquisitionPolicy,
  hashFlipAcquisitionPolicy,
  validateFlipAcquisitionPolicy,
} from './flip-acquisition.policy.js';
import {
  DeterministicFlipAcquisitionFixtureProvider,
  type FlipAcquisitionProviderRequest,
} from './flip-acquisition.provider.js';

const RULES_HASH = 'a'.repeat(64);

describe('Flip acquisition policy and deterministic provider', () => {
  test('commits every reviewed branch and rejects tampering or missing branches', () => {
    const policy = createFixtureFlipAcquisitionPolicy({ rulesHash: RULES_HASH, rulesVersion: 1 });
    expect(validateFlipAcquisitionPolicy(policy)).toEqual(policy);
    expect(policy.failureBranches.map(({ branch }) => branch).sort()).toEqual([
      'refund',
      'reselection',
      'substitute',
    ]);
    expect(() => validateFlipAcquisitionPolicy({ ...policy, policyHash: 'b'.repeat(64) })).toThrow(
      'hash',
    );
    expect(() =>
      validateFlipAcquisitionPolicy({
        ...policy,
        failureBranches: policy.failureBranches.slice(0, 2),
      }),
    ).toThrow('exactly three');
    const { policyHash: _policyHash, ...unsigned } = policy;
    expect(hashFlipAcquisitionPolicy(unsigned)).toBe(policy.policyHash);
  });

  test('rejects malformed policy envelopes at every contract boundary', () => {
    const policy = createFixtureFlipAcquisitionPolicy({
      rulesHash: RULES_HASH,
      rulesVersion: 1,
    });
    expect(() => validateFlipAcquisitionPolicy(null)).toThrow('required');
    expect(() => validateFlipAcquisitionPolicy({ ...policy, activation: 'live' })).toThrow(
      'binding',
    );
    expect(() =>
      validateFlipAcquisitionPolicy({ ...policy, reviewedAt: 'not-a-timestamp' }),
    ).toThrow('timestamp');
    expect(() =>
      validateFlipAcquisitionPolicy({
        ...policy,
        failureBranches: [
          policy.failureBranches[0],
          policy.failureBranches[0],
          policy.failureBranches[2],
        ],
      }),
    ).toThrow('duplicated');
    expect(canonicalFlipAcquisitionStringify(undefined)).toBe('null');
  });

  test('reconciles one keyed fixture effect without duplicate execution evidence', async () => {
    const provider = new DeterministicFlipAcquisitionFixtureProvider();
    const request = providerRequest();
    expect(await provider.reconcile(request, null)).toBeNull();
    const first = await provider.execute(request);
    const replay = await provider.execute(request);
    expect(replay).toEqual(first);
    const restarted = new DeterministicFlipAcquisitionFixtureProvider();
    expect(await restarted.reconcile(request, first.providerReference)).toEqual(first);
    expect(first.evidence.providerRequestKey).toBe(request.providerRequestKey);
  });
});

function providerRequest(): FlipAcquisitionProviderRequest {
  return {
    amount: '25000000',
    assetReference: 'fixture-asset',
    currency: 'USDC',
    decimals: 6,
    destinationReference: 'fixture-wallet:destination',
    kind: 'purchase',
    listingReference: 'fixture-listing',
    operationKey: 'flip-acquisition:1:purchase',
    providerRequestKey: `fixture-acquisition:${'c'.repeat(40)}`,
    requestHash: 'd'.repeat(64),
    sessionReference: 'fixture-session',
    sourceReference: 'fixture-wallet:source',
  };
}
