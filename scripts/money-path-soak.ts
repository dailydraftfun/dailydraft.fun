import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  assertSafeEnvironment,
  collectEvidence,
  evaluateBudgets,
  type IterationEvidence,
  parseConfiguration,
  summarizeMetrics,
} from './money-path-soak/core.js';

const TEST_FILES = [
  'scripts/money-path-soak/core.test.ts',
  'apps/api/src/duels/duels.service.test.ts',
  'apps/api/src/matchmaking/matchmaking.service.test.ts',
  'apps/api/src/transactions/funding-quorum.test.ts',
  'apps/api/src/transactions/duel-funding-rejection.test.ts',
  'apps/api/src/transactions/solana-rpc.client.test.ts',
  'apps/api/src/transactions/transaction-monitor.service.test.ts',
  'apps/api/src/duels/duel-opening.service.test.ts',
  'apps/api/src/providers/devnet-demo-pack.provider.test.ts',
  'apps/api/src/transactions/provider-settlement.service.test.ts',
  'apps/api/src/transactions/devnet-refund-orchestrator.service.test.ts',
  'apps/api/src/treasury/house-treasury.reservation.test.ts',
  'apps/api/src/transactions/prisma-transaction-monitor-recovery.test.ts',
  'apps/api/src/transactions/terminal-finalization-recovery.test.ts',
  'apps/api/src/duels/prisma-duel-expiry.test.ts',
] as const;

const configuration = parseConfiguration(process.argv.slice(2));
assertSafeEnvironment(process.env);

const startedAt = new Date();
const iterations = await runIterations(configuration.iterations, configuration.concurrency);
const metrics = summarizeMetrics(iterations.map(({ evidence }) => evidence));
const budgets = evaluateBudgets(configuration, metrics);
const report = {
  budgets,
  configuration: {
    concurrency: configuration.concurrency,
    iterationTimeoutMs: configuration.iterationTimeoutMs,
    iterations: configuration.iterations,
    maxP95Ms: configuration.maxP95Ms,
  },
  finishedAt: new Date().toISOString(),
  fixtureMode: 'deterministic',
  metrics,
  network: 'solana-devnet',
  passed: budgets.passed,
  scenarios: TEST_FILES,
  startedAt: startedAt.toISOString(),
  failures: iterations
    .filter(({ evidence }) => evidence.exitCode !== 0 || evidence.timedOut)
    .slice(0, 3)
    .map(({ evidence, index, output }) => ({
      exitCode: evidence.exitCode,
      index,
      output: output.slice(-4_000),
      timedOut: evidence.timedOut,
    })),
};

if (configuration.reportPath) {
  await mkdir(dirname(configuration.reportPath), { recursive: true });
  await writeFile(configuration.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(report, null, 2));
if (!budgets.passed) process.exitCode = 1;

async function runIterations(total: number, concurrency: number) {
  const results: Array<{ evidence: IterationEvidence; index: number; output: string }> = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(total, concurrency) }, async () => {
    while (nextIndex < total) {
      const index = nextIndex;
      nextIndex += 1;
      const result = await runIteration(index + 1);
      results[index] = result;
      console.error(
        JSON.stringify({
          durationMs: result.evidence.durationMs,
          exitCode: result.evidence.exitCode,
          iteration: index + 1,
          timedOut: result.evidence.timedOut,
        }),
      );
    }
  });
  await Promise.all(workers);
  return results;
}

async function runIteration(index: number) {
  const started = performance.now();
  const child = Bun.spawn(['bun', 'test', '--timeout', '20000', ...TEST_FILES], {
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      DAILYDRAFT_NETWORK: 'solana-devnet',
      SOAK_FIXTURE_MODE: 'deterministic',
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, configuration.iterationTimeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timeout);
  const output = `${stdout}\n${stderr}`;
  const evidence = collectEvidence(output);
  return {
    evidence: {
      durationMs: Math.round(performance.now() - started),
      exitCode: timedOut ? 124 : exitCode,
      ...evidence,
      timedOut,
    },
    index,
    output,
  };
}
