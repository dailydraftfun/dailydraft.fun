import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '@dailydraft/db';

import {
  RealValuePolicyDeniedException,
  RealValuePolicyService,
} from './real-value-policy.service.js';

describe('RealValuePolicyService', () => {
  test('retains immutable evidence before allowing a devnet admission', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const service = new RealValuePolicyService(database(rows));
    const evaluatedAt = new Date('2026-07-23T12:00:00.000Z');

    await expect(
      service.assertAllowed(
        'duel.funding.prepare',
        {
          NODE_ENV: 'production',
          DAILYDRAFT_NETWORK: 'solana-devnet',
          DAILYDRAFT_PROVIDER_MODE: 'dailydraft-devnet',
        },
        evaluatedAt,
      ),
    ).resolves.toMatchObject({
      allowed: true,
      capability: 'duel.funding.prepare',
      runtimeMode: 'devnet',
    });
    expect(rows).toEqual([
      expect.objectContaining({
        allowed: true,
        capability: 'duel.funding.prepare',
        denialReason: null,
        evaluatedAt,
        runtimeMode: 'devnet',
      }),
    ]);
  });

  test('retains denial evidence before returning a machine-readable rejection', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const service = new RealValuePolicyService(database(rows));
    let rejection: unknown;

    try {
      await service.assertAllowed('duel.create.house', {
        NODE_ENV: 'production',
        DAILYDRAFT_NETWORK: 'solana-mainnet',
        DAILYDRAFT_REAL_VALUE_MODE: 'true',
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(RealValuePolicyDeniedException);
    expect((rejection as RealValuePolicyDeniedException).getResponse()).toMatchObject({
      capability: 'duel.create.house',
      code: 'REAL_VALUE_POLICY_DENIED',
      reason: 'policy_missing',
      runtimeMode: 'production',
    });
    expect(rows).toEqual([
      expect.objectContaining({
        allowed: false,
        capability: 'duel.create.house',
        denialReason: 'policy_missing',
        runtimeMode: 'production',
      }),
    ]);
  });

  test('fails closed when decision evidence cannot be retained', async () => {
    const service = new RealValuePolicyService({
      realValuePolicyDecision: {
        create: () => Promise.reject(new Error('database unavailable')),
      },
    } as unknown as DatabaseClient);

    await expect(
      service.assertAllowed('matchmaking.search', { NODE_ENV: 'test' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'REAL_VALUE_POLICY_EVIDENCE_UNAVAILABLE',
        reason: 'decision_evidence_unavailable',
      }),
    });
  });
});

function database(rows: Array<Record<string, unknown>>): DatabaseClient {
  return {
    realValuePolicyDecision: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        rows.push(data);
        return Promise.resolve(data);
      },
    },
  } as unknown as DatabaseClient;
}
