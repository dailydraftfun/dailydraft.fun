export const OPERATION_PROOFS = {
  create: /replays an idempotent create request from durable storage/gi,
  fund: /replays an already finalized transaction idempotently/gi,
  match: /bounds retries to Prisma serialization and deadlock conflicts/gi,
  open: /leases a side so concurrent opens broadcast one deposit and replay the result/gi,
  settle: /persists and replays a provider result intent by idempotency key/gi,
  refund: /does not double-submit an active or lost-response refund intent/gi,
  reserve: /serializes concurrent retries into one reservation and one ledger entry/gi,
  resume: /restores a finalized .* transaction after .* moved the duel to refunding/gi,
} as const;

export const INVARIANT_PROOFS = {
  conflict: [
    /accepts a concurrent no-broadcast expiry without overwriting its evidence/gi,
    /evaluates concurrent duels against one locked exposure snapshot/gi,
    /does not emit an event when the optimistic version check loses a race/gi,
    /bounds retries to Prisma serialization and deadlock conflicts/gi,
  ],
  duplicatePrevention: [
    /replays an idempotent create request from durable storage/gi,
    /replays an already finalized transaction idempotently/gi,
    /leases a side so concurrent opens broadcast one deposit and replay the result/gi,
    /persists and replays a provider result intent by idempotency key/gi,
    /does not double-submit an active or lost-response refund intent/gi,
    /serializes concurrent retries into one reservation and one ledger entry/gi,
    /does not bind the same discovered broadcast twice/gi,
  ],
  recovery: [
    /reconciles a devnet settlement misclassified as refunding before returning the receipt/gi,
    /records provider recovery alerts with provider metadata and action labels/gi,
    /renews an expired provider intent only after a finalized recovery scan clears it/gi,
    /routes a committed result to settlement recovery without broadcasting refunds/gi,
    /restores a finalized .* transaction after .* moved the duel to refunding/gi,
    /routes an expired committing duel with finalized funding into refunding/gi,
    /recovers a finalized broadcast after the API submission response is lost/gi,
  ],
  retry: [
    /bounds retries to Prisma serialization and deadlock conflicts/gi,
    /creates a new bounded attempt after a submitted refund expires/gi,
    /renews an expired provider intent only after a finalized recovery scan clears it/gi,
    /aborts every hung attempt and stops at the configured retry bound/gi,
    /retries HTTP, JSON-RPC, and malformed failures before returning a later result/gi,
  ],
} as const;

export const FORBIDDEN_TARGET_VARIABLES = [
  'API_URL',
  'CRON_SECRET',
  'DATABASE_URL',
  'ESCROW_FEE_RECIPIENT',
  'ESCROW_PROVIDER_SIGNER',
  'DAILYDRAFT_API_URL',
  'DAILYDRAFT_API_KEYS',
  'DAILYDRAFT_DEVNET_PROVIDER_KEYPAIR_JSON',
  'DAILYDRAFT_DEVNET_FUNDING_SIGNER',
  'DAILYDRAFT_HOUSE_DEVNET_FUNDING_SIGNER',
  'DAILYDRAFT_PROVIDER_MODE',
  'POKEMON_TCG_API_KEY',
  'NEXT_PUBLIC_DUEL_API_URL',
  'NEXT_PUBLIC_SOLANA_RPC_URL',
  'SOLANA_RPC_URL',
] as const;

export interface SoakConfiguration {
  concurrency: number;
  iterationTimeoutMs: number;
  iterations: number;
  maxP95Ms: number;
  reportPath?: string;
}

export interface IterationEvidence {
  durationMs: number;
  exitCode: number;
  invariants: Record<keyof typeof INVARIANT_PROOFS, number>;
  operations: Record<keyof typeof OPERATION_PROOFS, number>;
  timedOut: boolean;
}

export interface SoakMetrics {
  conflicts: number;
  duplicatePreventions: number;
  errors: number;
  iterations: number;
  latencyMs: {
    max: number;
    p50: number;
    p95: number;
  };
  operations: Record<keyof typeof OPERATION_PROOFS, number>;
  recoveries: number;
  retries: number;
  timeouts: number;
}

export interface BudgetEvaluation {
  expectedInvariantProofs: Record<keyof typeof INVARIANT_PROOFS, number>;
  passed: boolean;
  violations: string[];
}

const DEFAULTS: SoakConfiguration = {
  concurrency: 3,
  iterationTimeoutMs: 60_000,
  iterations: 12,
  maxP95Ms: 45_000,
};

export function parseConfiguration(arguments_: string[]): SoakConfiguration {
  const configuration = { ...DEFAULTS };
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);

    switch (flag) {
      case '--concurrency':
        configuration.concurrency = boundedInteger(flag, value, 1, 8);
        break;
      case '--iteration-timeout-ms':
        configuration.iterationTimeoutMs = boundedInteger(flag, value, 1_000, 120_000);
        break;
      case '--iterations':
        configuration.iterations = boundedInteger(flag, value, 1, 100);
        break;
      case '--max-p95-ms':
        configuration.maxP95Ms = boundedInteger(flag, value, 1_000, 120_000);
        break;
      case '--report':
        configuration.reportPath = safeReportPath(value);
        break;
      default:
        throw new Error(`Unsupported argument: ${flag}`);
    }
    index += 1;
  }
  return configuration;
}

export function assertSafeEnvironment(environment: NodeJS.ProcessEnv): void {
  if (environment.SOAK_FIXTURE_MODE !== 'deterministic') {
    throw new Error('SOAK_FIXTURE_MODE must be deterministic');
  }
  if (environment.DAILYDRAFT_NETWORK !== 'solana-devnet') {
    throw new Error('DAILYDRAFT_NETWORK must be solana-devnet');
  }
  if (environment.NODE_ENV === 'production') {
    throw new Error('NODE_ENV must not be production');
  }
  for (const variable of FORBIDDEN_TARGET_VARIABLES) {
    if (environment[variable]?.trim()) {
      throw new Error(`${variable} must be unset; the soak runner cannot target external systems`);
    }
  }
}

export function collectEvidence(
  output: string,
): Pick<IterationEvidence, 'invariants' | 'operations'> {
  return {
    invariants: {
      conflict: countProofs(output, INVARIANT_PROOFS.conflict),
      duplicatePrevention: countProofs(output, INVARIANT_PROOFS.duplicatePrevention),
      recovery: countProofs(output, INVARIANT_PROOFS.recovery),
      retry: countProofs(output, INVARIANT_PROOFS.retry),
    },
    operations: Object.fromEntries(
      Object.entries(OPERATION_PROOFS).map(([operation, proof]) => [
        operation,
        countMatches(output, proof),
      ]),
    ) as IterationEvidence['operations'],
  };
}

export function summarizeMetrics(iterations: IterationEvidence[]): SoakMetrics {
  const durations = iterations.map(({ durationMs }) => durationMs);
  return {
    conflicts: sum(iterations.map(({ invariants }) => invariants.conflict)),
    duplicatePreventions: sum(iterations.map(({ invariants }) => invariants.duplicatePrevention)),
    errors: iterations.filter(({ exitCode }) => exitCode !== 0).length,
    iterations: iterations.length,
    latencyMs: {
      max: durations.length === 0 ? 0 : Math.max(...durations),
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
    },
    operations: Object.fromEntries(
      Object.keys(OPERATION_PROOFS).map((operation) => [
        operation,
        sum(
          iterations.map(
            ({ operations }) => operations[operation as keyof typeof OPERATION_PROOFS],
          ),
        ),
      ]),
    ) as SoakMetrics['operations'],
    recoveries: sum(iterations.map(({ invariants }) => invariants.recovery)),
    retries: sum(iterations.map(({ invariants }) => invariants.retry)),
    timeouts: iterations.filter(({ timedOut }) => timedOut).length,
  };
}

export function evaluateBudgets(
  configuration: SoakConfiguration,
  metrics: SoakMetrics,
): BudgetEvaluation {
  const expectedInvariantProofs = {
    conflict: configuration.iterations * INVARIANT_PROOFS.conflict.length,
    duplicatePrevention: configuration.iterations * INVARIANT_PROOFS.duplicatePrevention.length,
    recovery: configuration.iterations * INVARIANT_PROOFS.recovery.length,
    retry: configuration.iterations * INVARIANT_PROOFS.retry.length,
  };
  const violations: string[] = [];

  if (metrics.iterations !== configuration.iterations) {
    violations.push(`completed ${metrics.iterations}/${configuration.iterations} iterations`);
  }
  if (metrics.errors > 0) violations.push(`${metrics.errors} iteration(s) failed`);
  if (metrics.timeouts > 0) violations.push(`${metrics.timeouts} iteration(s) timed out`);
  if (metrics.latencyMs.p95 > configuration.maxP95Ms) {
    violations.push(`p95 ${metrics.latencyMs.p95}ms exceeded ${configuration.maxP95Ms}ms`);
  }
  for (const [operation, count] of Object.entries(metrics.operations)) {
    if (count < configuration.iterations) {
      violations.push(`${operation} proof count ${count} was below ${configuration.iterations}`);
    }
  }
  for (const [invariant, expected] of Object.entries(expectedInvariantProofs)) {
    const actual = invariantMetric(metrics, invariant as keyof typeof INVARIANT_PROOFS);
    if (actual < expected)
      violations.push(`${invariant} proof count ${actual} was below ${expected}`);
  }

  return { expectedInvariantProofs, passed: violations.length === 0, violations };
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))] ?? 0;
}

function boundedInteger(flag: string, value: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function safeReportPath(value: string): string {
  if (!value.startsWith('artifacts/') || value.includes('..') || !value.endsWith('.json')) {
    throw new Error('--report must be a JSON file under artifacts/');
  }
  return value;
}

function countMatches(output: string, proof: RegExp): number {
  return [...output.matchAll(new RegExp(proof.source, proof.flags))].length;
}

function countProofs(output: string, proofs: readonly RegExp[]): number {
  return sum(proofs.map((proof) => countMatches(output, proof)));
}

function invariantMetric(metrics: SoakMetrics, invariant: keyof typeof INVARIANT_PROOFS): number {
  switch (invariant) {
    case 'conflict':
      return metrics.conflicts;
    case 'duplicatePrevention':
      return metrics.duplicatePreventions;
    case 'recovery':
      return metrics.recoveries;
    case 'retry':
      return metrics.retries;
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
