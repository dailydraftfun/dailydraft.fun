import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import {
  canonicalJson,
  evaluateRealValuePolicy,
  NON_PRODUCTION_POLICY_HASH,
  NON_PRODUCTION_POLICY_VERSION,
  REAL_VALUE_CAPABILITIES,
  REAL_VALUE_POLICY_SCHEMA_VERSION,
  resolveRealValueRuntime,
} from './real-value-policy.js';

describe('real-value policy contract', () => {
  test('pins the non-production policy and keeps every fixture capability available', () => {
    const fixturePolicy = {
      capabilities: REAL_VALUE_CAPABILITIES,
      policyVersion: NON_PRODUCTION_POLICY_VERSION,
      productionApproved: false,
      runtimeModes: ['fixture', 'devnet'],
      schemaVersion: REAL_VALUE_POLICY_SCHEMA_VERSION,
    };
    expect(createHash('sha256').update(canonicalJson(fixturePolicy)).digest('hex')).toBe(
      NON_PRODUCTION_POLICY_HASH,
    );

    for (const capability of REAL_VALUE_CAPABILITIES) {
      expect(evaluateRealValuePolicy(capability, { NODE_ENV: 'test' })).toMatchObject({
        allowed: true,
        capability,
        denialReason: null,
        evidence: {
          approvalEvidence: null,
          productionEnabled: false,
          runtimeMode: 'fixture',
        },
        policyHash: NON_PRODUCTION_POLICY_HASH,
        policyVersion: NON_PRODUCTION_POLICY_VERSION,
        runtimeMode: 'fixture',
      });
    }
  });

  test('keeps explicit devnet verification available without production approval', () => {
    expect(
      evaluateRealValuePolicy('duel.funding.prepare', {
        NODE_ENV: 'production',
        DAILYDRAFT_NETWORK: 'solana-devnet',
        DAILYDRAFT_PROVIDER_MODE: 'dailydraft-devnet',
        DAILYDRAFT_REAL_VALUE_PRODUCTION_ENABLED: 'true',
      }),
    ).toMatchObject({
      allowed: true,
      evidence: {
        approvalEvidence: null,
        productionEnabled: false,
        runtimeMode: 'devnet',
      },
      policyVersion: NON_PRODUCTION_POLICY_VERSION,
      runtimeMode: 'devnet',
    });
  });

  test('denies production when the policy or explicit production approval is absent', () => {
    expect(evaluateRealValuePolicy('duel.create.direct', productionEnvironment())).toMatchObject({
      allowed: false,
      denialReason: 'policy_missing',
    });
    expect(
      evaluateRealValuePolicy(
        'duel.create.direct',
        productionEnvironment({
          DAILYDRAFT_REAL_VALUE_POLICY_JSON: JSON.stringify(validPolicy()),
        }),
      ),
    ).toMatchObject({
      allowed: false,
      denialReason: 'production_approval_missing',
    });
  });

  test('fails closed with a stable reason for malformed and incomplete policy inputs', () => {
    const cases: Array<{
      expected: string;
      mutate: (policy: Record<string, unknown>) => void;
    }> = [
      {
        expected: 'policy_schema_unsupported',
        mutate: (policy) => {
          policy.schemaVersion = 'dailydraft.real-value-policy.v2';
        },
      },
      {
        expected: 'policy_version_missing',
        mutate: (policy) => {
          delete policy.policyVersion;
        },
      },
      {
        expected: 'legal_approval_missing',
        mutate: (policy) => {
          delete (policy.approvals as Record<string, unknown>).legal;
        },
      },
      {
        expected: 'jurisdiction_policy_missing',
        mutate: (policy) => {
          delete (policy.approvals as Record<string, unknown>).jurisdiction;
        },
      },
      {
        expected: 'age_policy_missing',
        mutate: (policy) => {
          delete (policy.approvals as Record<string, unknown>).age;
        },
      },
      {
        expected: 'limits_policy_missing',
        mutate: (policy) => {
          delete (policy.approvals as Record<string, unknown>).limits;
        },
      },
      {
        expected: 'sanctions_policy_missing',
        mutate: (policy) => {
          delete (policy.approvals as Record<string, unknown>).sanctions;
        },
      },
      {
        expected: 'disclosure_policy_missing',
        mutate: (policy) => {
          delete (policy.approvals as Record<string, unknown>).disclosure;
        },
      },
      {
        expected: 'production_approval_missing',
        mutate: (policy) => {
          delete (policy.approvals as Record<string, unknown>).production;
        },
      },
      {
        expected: 'capability_configuration_missing',
        mutate: (policy) => {
          policy.capabilities = [];
        },
      },
    ];

    expect(
      evaluateRealValuePolicy(
        'duel.create.direct',
        productionEnvironment({
          DAILYDRAFT_REAL_VALUE_POLICY_JSON: '{not-json',
        }),
      ),
    ).toMatchObject({ allowed: false, denialReason: 'policy_malformed' });

    for (const { expected, mutate } of cases) {
      const policy = validPolicy() as unknown as Record<string, unknown>;
      mutate(policy);
      expect(
        evaluateRealValuePolicy(
          'duel.create.direct',
          productionEnvironment({
            DAILYDRAFT_REAL_VALUE_POLICY_JSON: JSON.stringify(policy),
          }),
        ),
      ).toMatchObject({ allowed: false, denialReason: expected });
    }
  });

  test('enables only explicitly approved production capabilities and binds exact evidence', () => {
    const environment = productionEnvironment({
      DAILYDRAFT_REAL_VALUE_POLICY_JSON: JSON.stringify(validPolicy()),
      DAILYDRAFT_REAL_VALUE_PRODUCTION_ENABLED: 'true',
    });
    const allowed = evaluateRealValuePolicy('duel.create.direct', environment);
    const denied = evaluateRealValuePolicy('provider.escrow.prepare', environment);

    expect(allowed).toMatchObject({
      allowed: true,
      capability: 'duel.create.direct',
      evidence: {
        approvalEvidence: validPolicy().approvals,
        configuredCapabilities: ['duel.create.direct', 'duel.funding.prepare'],
        configurationPresent: true,
        configurationValid: true,
        productionEnabled: true,
        runtimeMode: 'production',
      },
      policyVersion: 'legal-release-2026-07-23',
      runtimeMode: 'production',
    });
    expect(allowed.policyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(denied).toMatchObject({
      allowed: false,
      denialReason: 'capability_disabled',
      policyHash: allowed.policyHash,
      policyVersion: allowed.policyVersion,
    });
  });

  test('rejects ambiguous runtime markers instead of treating them as fixtures', () => {
    expect(resolveRealValueRuntime({ DAILYDRAFT_REAL_VALUE_MODE: 'yes' })).toBe('unclassified');
    expect(
      evaluateRealValuePolicy('duel.create.direct', {
        DAILYDRAFT_REAL_VALUE_MODE: 'yes',
      }),
    ).toMatchObject({ allowed: false, denialReason: 'runtime_unclassified' });
  });
});

function productionEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DAILYDRAFT_NETWORK: 'solana-mainnet',
    DAILYDRAFT_PROVIDER_MODE: 'collector-crypt-production',
    DAILYDRAFT_REAL_VALUE_MODE: 'true',
    ...overrides,
  };
}

function validPolicy() {
  return {
    approvals: {
      age: 'policy/age/2026-07',
      disclosure: 'policy/disclosure/2026-07',
      jurisdiction: 'policy/jurisdiction/2026-07',
      legal: 'approval/legal/2026-07',
      limits: 'policy/limits/2026-07',
      production: 'approval/production/2026-07',
      sanctions: 'policy/sanctions/2026-07',
    },
    capabilities: ['duel.funding.prepare', 'duel.create.direct'],
    policyVersion: 'legal-release-2026-07-23',
    schemaVersion: REAL_VALUE_POLICY_SCHEMA_VERSION,
  };
}
