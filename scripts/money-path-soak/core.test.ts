import { describe, expect, test } from 'bun:test';

import {
  assertSafeEnvironment,
  collectEvidence,
  evaluateBudgets,
  type IterationEvidence,
  parseConfiguration,
  percentile,
  summarizeMetrics,
} from './core.js';

describe('money-path soak contract', () => {
  test('accepts bounded runner controls without accepting a target', () => {
    expect(
      parseConfiguration([
        '--iterations',
        '24',
        '--concurrency',
        '4',
        '--iteration-timeout-ms',
        '30000',
        '--max-p95-ms',
        '20000',
        '--report',
        'artifacts/soak.json',
      ]),
    ).toEqual({
      concurrency: 4,
      iterationTimeoutMs: 30_000,
      iterations: 24,
      maxP95Ms: 20_000,
      reportPath: 'artifacts/soak.json',
    });
    expect(() => parseConfiguration(['--api-url', 'https://example.com'])).toThrow(
      'Unsupported argument',
    );
    expect(() => parseConfiguration(['--iterations', '101'])).toThrow('between 1 and 100');
    expect(() => parseConfiguration(['--report', 'package.json'])).toThrow(
      'JSON file under artifacts',
    );
  });

  test('fails closed for production, RPC, database, or signer targets', () => {
    const safe = {
      OPENPACKSDUEL_NETWORK: 'solana-devnet',
      SOAK_FIXTURE_MODE: 'deterministic',
    };
    expect(() => assertSafeEnvironment(safe)).not.toThrow();
    expect(() =>
      assertSafeEnvironment({ ...safe, OPENPACKSDUEL_NETWORK: 'solana-mainnet' }),
    ).toThrow('must be solana-devnet');
    expect(() => assertSafeEnvironment({ ...safe, NODE_ENV: 'production' })).toThrow(
      'must not be production',
    );
    expect(() => assertSafeEnvironment({ ...safe, DATABASE_URL: 'postgresql://live' })).toThrow(
      'DATABASE_URL must be unset',
    );
    expect(() => assertSafeEnvironment({ ...safe, SOLANA_RPC_URL: 'https://rpc.example' })).toThrow(
      'SOLANA_RPC_URL must be unset',
    );
    expect(() =>
      assertSafeEnvironment({ ...safe, OPENPACKSDUEL_DEVNET_PROVIDER_KEYPAIR_JSON: '[1,2,3]' }),
    ).toThrow('OPENPACKSDUEL_DEVNET_PROVIDER_KEYPAIR_JSON must be unset');
  });

  test('extracts operation and invariant evidence from successful test names', () => {
    const output = [
      'replays an idempotent create request from durable storage',
      'replays an already finalized transaction idempotently',
      'bounds retries to Prisma serialization and deadlock conflicts',
      'leases a side so concurrent opens broadcast one deposit and replay the result',
      'persists and replays a provider result intent by idempotency key',
      'does not double-submit an active or lost-response refund intent',
      'serializes concurrent retries into one reservation and one ledger entry',
      'restores a finalized SETTLE transaction after the verifier moved the duel to refunding',
    ].join('\n');

    expect(collectEvidence(output)).toMatchObject({
      operations: {
        create: 1,
        fund: 1,
        match: 1,
        open: 1,
        refund: 1,
        reserve: 1,
        resume: 1,
        settle: 1,
      },
    });
  });

  test('fails explicit budgets when evidence, latency, or iteration health regresses', () => {
    const evidence = healthyIteration();
    const healthy = summarizeMetrics([evidence, evidence]);
    const passing = evaluateBudgets(
      {
        concurrency: 1,
        iterationTimeoutMs: 10_000,
        iterations: 2,
        maxP95Ms: 2_000,
      },
      healthy,
    );
    expect(passing.passed).toBe(true);

    const failing = evaluateBudgets(
      {
        concurrency: 1,
        iterationTimeoutMs: 10_000,
        iterations: 2,
        maxP95Ms: 500,
      },
      summarizeMetrics([{ ...evidence, exitCode: 1, timedOut: true }]),
    );
    expect(failing.passed).toBe(false);
    expect(failing.violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('completed 1/2'),
        expect.stringContaining('iteration(s) failed'),
        expect.stringContaining('timed out'),
        expect.stringContaining('p95'),
        expect.stringContaining('create proof count'),
      ]),
    );
  });

  test('calculates nearest-rank latency percentiles deterministically', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([40, 10, 20, 30], 50)).toBe(20);
    expect(percentile([40, 10, 20, 30], 95)).toBe(40);
  });
});

function healthyIteration(): IterationEvidence {
  return {
    durationMs: 1_000,
    exitCode: 0,
    invariants: {
      conflict: 4,
      duplicatePrevention: 7,
      recovery: 7,
      retry: 5,
    },
    operations: {
      create: 1,
      fund: 1,
      match: 1,
      open: 1,
      refund: 1,
      reserve: 1,
      resume: 1,
      settle: 1,
    },
    timedOut: false,
  };
}
