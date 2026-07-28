import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type {
  CrashDecision,
  CrashRoundStatus,
  CrashTransitionKind,
  DatabaseClient,
} from '@dailydraft/db';

import type { Money } from '../domain.js';
import {
  CRASH_CALCULATOR_VERSION,
  CRASH_RULES_SCHEMA_VERSION,
  type CrashCalculatorRuleSet,
  hashCrashCalculatorRuleSet,
  type UnsignedCrashCalculatorRuleSet,
} from './crash-calculators.js';
import {
  CRASH_CUSTODY_FIXTURE_VERSION,
  CRASH_PAYMENT_FIXTURE_VERSION,
  CRASH_PROVIDER_FIXTURE_VERSION,
  CRASH_SETTLEMENT_FIXTURE_VERSION,
  CRASH_STATE_MACHINE_VERSION,
  CRASH_STATE_RULES_SCHEMA_VERSION,
  CrashStageStateService,
  CrashStateMachineError,
  type CrashStateRules,
  crashStateMachineCapability,
  hashCrashStateRules,
  type UnsignedCrashStateRules,
} from './crash-stage-state.js';

const START = new Date('2026-07-28T12:00:00.000Z');
const TIMEOUT_MS = 30_000;
const FIXTURE_ENVIRONMENT = {
  DAILYDRAFT_CRASH_FIXTURE_MODE: 'true',
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;

describe('durable fixture-only Crash stage state machine', () => {
  test('persists reviewed rule references and resumes every non-terminal stage', async () => {
    const fixture = harness();
    let round = await fixture.create('round-resume');

    expect(round).toMatchObject({
      architectureVersion: 'synthetic-crash-architecture-v1',
      calculatorVersion: CRASH_CALCULATOR_VERSION,
      decisionDeadline: '2026-07-28T12:00:30.000Z',
      defaultAction: 'forfeit',
      rulesHash: CALCULATOR_RULES.rulesHash,
      rulesVersion: 'synthetic-state-machine-ci-v1',
      stage: 1,
      stateMachineRulesHash: STATE_RULES.stateMachineRulesHash,
      stateMachineVersion: CRASH_STATE_MACHINE_VERSION,
      status: 'active',
      version: 1,
    });
    expect(round.transitions).toEqual([
      expect.objectContaining({
        kind: 'round-started',
        sequence: 1,
        toStage: 1,
        toStatus: 'active',
      }),
    ]);

    for (const stage of [1, 2]) {
      fixture.clock.advance(1_000);
      round = await fixture.service.decide(
        round.id,
        STATE_RULES,
        continueDecision(stage, round.version, 900_000),
      );
      expect(round).toMatchObject({
        decisionDeadline: new Date(fixture.clock.now().getTime() + TIMEOUT_MS).toISOString(),
        stage: stage + 1,
        status: 'active',
        version: stage + 1,
      });

      // A fresh service over the same repository proves restart-safe resume
      // instead of relying on process memory from the transition call.
      const restarted = new CrashStageStateService(
        fixture.database as unknown as DatabaseClient,
        fixture.clock,
        FIXTURE_ENVIRONMENT,
      );
      await expect(restarted.findRound(round.id)).resolves.toEqual(round);
    }
    expect(round.transitions.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
  });

  test('records continue evidence and completes the final stage exactly once', async () => {
    const fixture = harness();
    let round = await fixture.create('round-complete');
    round = await fixture.service.decide(round.id, STATE_RULES, continueDecision(1, 1, 900_000));
    round = await fixture.service.decide(round.id, STATE_RULES, continueDecision(2, 2, 900_000));
    const decision = continueDecision(3, 3, 900_000, settlement('8000000'));

    const completed = await fixture.service.decide(round.id, STATE_RULES, decision);
    const replay = await fixture.service.decide(round.id, STATE_RULES, decision);

    expect(replay).toEqual(completed);
    expect(completed).toMatchObject({
      decisionDeadline: null,
      pot: usdc('8000000'),
      stage: 3,
      status: 'completed',
      terminalReason: 'FINAL_STAGE_COMPLETED',
      version: 4,
    });
    expect(completed.transitions).toHaveLength(4);
    expect(completed.transitions[3]).toMatchObject({
      decision: 'continue',
      kind: 'completed',
      outcome: {
        custody: expect.objectContaining({ schemaVersion: CRASH_CUSTODY_FIXTURE_VERSION }),
        provider: expect.objectContaining({ schemaVersion: CRASH_PROVIDER_FIXTURE_VERSION }),
      },
      payment: expect.objectContaining({ schemaVersion: CRASH_PAYMENT_FIXTURE_VERSION }),
      settlement: expect.objectContaining({ schemaVersion: CRASH_SETTLEMENT_FIXTURE_VERSION }),
      terminalReason: 'FINAL_STAGE_COMPLETED',
      valueChange: expect.objectContaining({
        currentPot: usdc('4000000'),
        nextPot: usdc('8000000'),
        valueChange: usdc('4000000'),
      }),
    });
  });

  test.each([
    {
      expected: {
        kind: 'cashed-out',
        payout: '0',
        reason: 'PLAYER_CASH_OUT',
        status: 'cashed-out',
      },
      input: () => cashOutDecision(1, 1, '0'),
      name: 'cash out',
    },
    {
      expected: {
        kind: 'busted',
        payout: '0',
        reason: 'PROVIDER_BUST_OUTCOME',
        status: 'busted',
      },
      input: () => continueDecision(1, 1, 50_000, settlement('0')),
      name: 'bust',
    },
  ])('persists terminal $name decisions and settlement receipts', async ({ expected, input }) => {
    const fixture = harness();
    const round = await fixture.create(`round-${expected.status}`);
    const terminal = await fixture.service.decide(round.id, STATE_RULES, input());

    expect(terminal).toMatchObject({
      decisionDeadline: null,
      status: expected.status,
      terminalReason: expected.reason,
      version: 2,
    });
    expect(terminal.transitions[1]).toMatchObject({
      kind: expected.kind,
      settlement: { payout: usdc(expected.payout) },
      terminalReason: expected.reason,
    });
    await expect(
      fixture.service.decide(
        round.id,
        STATE_RULES,
        cashOutDecision(1, 2, terminal.pot.amount, 'terminal-retry'),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  test('applies the pre-disclosed deadline forfeit once under concurrent workers and retries', async () => {
    const fixture = harness();
    const round = await fixture.create('round-deadline');
    fixture.clock.advance(TIMEOUT_MS);

    const counts = await Promise.all([
      fixture.service.applyExpiredDefaults(),
      fixture.service.applyExpiredDefaults(),
      fixture.service.applyExpiredDefaults(),
    ]);
    const terminal = await fixture.service.findRound(round.id);

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await fixture.service.applyExpiredDefaults()).toBe(0);
    expect(terminal).toMatchObject({
      decisionDeadline: null,
      stage: 1,
      status: 'defaulted',
      terminalReason: 'DEADLINE_DEFAULT_FORFEIT',
      version: 2,
    });
    expect(terminal.transitions).toHaveLength(2);
    expect(terminal.transitions[1]).toMatchObject({
      decision: 'forfeit',
      kind: 'deadline-defaulted',
      scheduledDeadline: round.decisionDeadline,
      settlement: {
        payout: usdc('0'),
        schemaVersion: CRASH_SETTLEMENT_FIXTURE_VERSION,
      },
      terminalReason: 'DEADLINE_DEFAULT_FORFEIT',
    });
  });

  test('rejects decisions at the deadline and leaves expiry as the only valid transition', async () => {
    const fixture = harness();
    const round = await fixture.create('round-deadline-boundary');
    fixture.clock.advance(TIMEOUT_MS);

    await expect(
      fixture.service.decide(round.id, STATE_RULES, continueDecision(1, 1, 900_000)),
    ).rejects.toMatchObject({ code: 'DEADLINE_EXPIRED' });
    expect(await fixture.service.applyExpiredDefaults()).toBe(1);
  });

  test('allows only one concurrent decision from a durable stage version', async () => {
    const fixture = harness();
    const round = await fixture.create('round-concurrency');

    const results = await Promise.allSettled([
      fixture.service.decide(
        round.id,
        STATE_RULES,
        continueDecision(1, 1, 900_000, undefined, 'continue-a'),
      ),
      fixture.service.decide(round.id, STATE_RULES, cashOutDecision(1, 1, '0', 'cash-out-b')),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    const durable = await fixture.service.findRound(round.id);
    expect(durable.transitions).toHaveLength(2);
    expect(durable.version).toBe(2);
  });

  test('rejects transition-key reuse with changed evidence', async () => {
    const fixture = harness();
    const round = await fixture.create('round-idempotency');
    await fixture.service.decide(
      round.id,
      STATE_RULES,
      continueDecision(1, 1, 900_000, undefined, 'stable-key'),
    );

    await expect(
      fixture.service.decide(
        round.id,
        STATE_RULES,
        continueDecision(1, 1, 800_000, undefined, 'stable-key'),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  });

  test('fails closed when durable round and append-only ledger versions disagree', async () => {
    const fixture = harness();
    const round = await fixture.create('round-corrupt-ledger');
    fixture.database.corruptRound(round.id, { version: 2 });

    await expect(fixture.service.findRound(round.id)).rejects.toMatchObject({ code: 'DISABLED' });
  });

  test.each([
    {
      change: (decision: ReturnType<typeof continueDecision>) => ({
        ...decision,
        expectedStage: 2,
        providerOutcome: { ...decision.providerOutcome, stage: 2 },
      }),
      code: 'INVALID_TRANSITION',
      name: 'wrong stage',
    },
    {
      change: (decision: ReturnType<typeof continueDecision>) => ({
        ...decision,
        expectedVersion: 2,
      }),
      code: 'INVALID_TRANSITION',
      name: 'wrong version',
    },
    {
      change: (decision: ReturnType<typeof continueDecision>) => ({
        ...decision,
        providerOutcome: { ...decision.providerOutcome, schemaVersion: 'live-provider' },
      }),
      code: 'INVALID_EVIDENCE',
      name: 'non-fixture provider',
    },
    {
      change: (decision: ReturnType<typeof continueDecision>) => ({
        ...decision,
        providerOutcome: { ...decision.providerOutcome, stage: 2 },
      }),
      code: 'INVALID_EVIDENCE',
      name: 'provider stage mismatch',
    },
    {
      change: (decision: ReturnType<typeof continueDecision>) => ({
        ...decision,
        payment: { ...decision.payment, status: 'broadcast' },
      }),
      code: 'INVALID_EVIDENCE',
      name: 'unconfirmed payment',
    },
  ])('rejects $name without mutating durable state', async ({ change, code }) => {
    const fixture = harness();
    const round = await fixture.create(`round-invalid-${code}-${crypto.randomUUID()}`);

    await expect(
      fixture.service.decide(
        round.id,
        STATE_RULES,
        change(continueDecision(1, 1, 900_000)) as never,
      ),
    ).rejects.toMatchObject({ code });
    expect(await fixture.service.findRound(round.id)).toMatchObject({
      stage: 1,
      transitions: [expect.objectContaining({ kind: 'round-started' })],
      version: 1,
    });
  });
});

describe('Crash fail-closed contract', () => {
  test('never marks production playable and distinguishes validated fixtures', () => {
    expect(crashStateMachineCapability(undefined, FIXTURE_ENVIRONMENT)).toEqual({
      fixtureReady: false,
      playable: false,
      reason: 'Crash remains disabled until approved architecture and economic rules are present.',
    });
    expect(crashStateMachineCapability(STATE_RULES, FIXTURE_ENVIRONMENT)).toEqual({
      fixtureReady: true,
      playable: false,
      reason:
        'Crash stage fixtures are ready; production Crash remains disabled pending HITL promotion.',
    });
    expect(
      crashStateMachineCapability(STATE_RULES, {
        DAILYDRAFT_CRASH_FIXTURE_MODE: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      }),
    ).toMatchObject({ fixtureReady: false, playable: false });
  });

  test('blocks fixture mutation in production even when synthetic rules are valid', async () => {
    const service = new CrashStageStateService(
      new MemoryCrashDatabase() as unknown as DatabaseClient,
      new MutableClock(START),
      {
        DAILYDRAFT_CRASH_FIXTURE_MODE: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      },
    );

    await expect(
      service.createFixtureRound({
        initialPot: usdc('0'),
        playerWalletReference: 'fixture-wallet:production-blocked',
        roundId: 'production-blocked',
        rules: STATE_RULES,
      }),
    ).rejects.toMatchObject({ code: 'DISABLED' });
  });

  test.each([
    undefined,
    { ...STATE_RULES, activation: 'production' },
    { ...STATE_RULES, architectureVersion: '' },
    { ...STATE_RULES, stateMachineRulesHash: '0'.repeat(64) },
    {
      ...STATE_RULES,
      calculatorRules: { ...CALCULATOR_RULES, rulesHash: '0'.repeat(64) },
    },
  ])('refuses missing, live, or uncommitted architecture/economic rules', async (rules) => {
    const fixture = harness();
    await expect(
      fixture.service.createFixtureRound({
        initialPot: usdc('0'),
        playerWalletReference: 'fixture-wallet:player',
        roundId: `disabled-${crypto.randomUUID()}`,
        rules: rules as CrashStateRules,
      }),
    ).rejects.toBeInstanceOf(CrashStateMachineError);
  });

  test('migration pins fixture-only rows, immutable references, and append-only transitions', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/prisma/migrations/20260728153000_crash_stage_state_machine/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('"CrashRound_fixture_only_check"');
    expect(migration).toContain('"CrashRound_terminal_state_check"');
    expect(migration).toContain('"CrashRound_contract_immutable"');
    expect(migration).toContain('NEW."version" <> OLD."version" + 1');
    expect(migration).toContain('"CrashTransition_append_only"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "CrashTransition"');
  });
});

const UNSIGNED_CALCULATOR_RULES = {
  activation: 'fixture-only',
  calculatorVersion: CRASH_CALCULATOR_VERSION,
  constraints: {
    bustThresholdPpm: 'nondecreasing',
    maxPotAmount: 'nondecreasing',
    potContributionBps: 'nondecreasing',
  },
  currency: 'USDC',
  decimals: 6,
  rounding: 'floor',
  rulesVersion: 'synthetic-state-machine-ci-v1',
  schemaVersion: CRASH_RULES_SCHEMA_VERSION,
  stages: [
    {
      bustThresholdPpm: 100_000,
      maxPotAmount: '100000000',
      potContributionBps: 10_000,
      stage: 1,
    },
    {
      bustThresholdPpm: 250_000,
      maxPotAmount: '250000000',
      potContributionBps: 15_000,
      stage: 2,
    },
    {
      bustThresholdPpm: 500_000,
      maxPotAmount: '500000000',
      potContributionBps: 20_000,
      stage: 3,
    },
  ],
} as const satisfies UnsignedCrashCalculatorRuleSet;

const CALCULATOR_RULES: CrashCalculatorRuleSet = {
  ...UNSIGNED_CALCULATOR_RULES,
  rulesHash: hashCrashCalculatorRuleSet(UNSIGNED_CALCULATOR_RULES),
};

const UNSIGNED_STATE_RULES = {
  activation: 'fixture-only',
  architectureVersion: 'synthetic-crash-architecture-v1',
  calculatorRules: CALCULATOR_RULES,
  decisionTimeoutMs: TIMEOUT_MS,
  defaultAction: 'forfeit',
  schemaVersion: CRASH_STATE_RULES_SCHEMA_VERSION,
  stateMachineVersion: CRASH_STATE_MACHINE_VERSION,
} as const satisfies UnsignedCrashStateRules;

const STATE_RULES: CrashStateRules = {
  ...UNSIGNED_STATE_RULES,
  stateMachineRulesHash: hashCrashStateRules(UNSIGNED_STATE_RULES),
};

function continueDecision(
  stage: number,
  version: number,
  rollPpm: number,
  terminalSettlement?: ReturnType<typeof settlement>,
  transitionKey = `continue-${stage}`,
) {
  return {
    custody: {
      assetReference: `fixture-asset:${stage}`,
      reference: `fixture-custody:${stage}`,
      schemaVersion: CRASH_CUSTODY_FIXTURE_VERSION,
    },
    decision: 'continue' as const,
    expectedStage: stage,
    expectedVersion: version,
    payment: {
      amount: usdc('1000000'),
      reference: `fixture-payment:${stage}`,
      schemaVersion: CRASH_PAYMENT_FIXTURE_VERSION,
      status: 'fixture-confirmed' as const,
    },
    providerOutcome: {
      reference: `fixture-provider:${stage}`,
      resultHash: hash(`provider:${stage}:${rollPpm}`),
      rollPpm,
      schemaVersion: CRASH_PROVIDER_FIXTURE_VERSION,
      stage,
      stageValue: usdc(stage === 1 ? '1000000' : stage === 2 ? '2000000' : '2000000'),
    },
    ...(terminalSettlement ? { settlement: terminalSettlement } : {}),
    transitionKey,
  };
}

function cashOutDecision(
  stage: number,
  version: number,
  payout: string,
  transitionKey = `cash-out-${stage}`,
) {
  return {
    decision: 'cash-out' as const,
    expectedStage: stage,
    expectedVersion: version,
    settlement: settlement(payout),
    transitionKey,
  };
}

function settlement(payout: string) {
  return {
    payout: usdc(payout),
    reference: `fixture-settlement:${payout}`,
    resultHash: hash(`settlement:${payout}`),
    schemaVersion: CRASH_SETTLEMENT_FIXTURE_VERSION,
    status: 'fixture-recorded' as const,
  };
}

function usdc(amount: string): Money {
  return { amount, currency: 'USDC', decimals: 6 };
}

function hash(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function harness() {
  const database = new MemoryCrashDatabase();
  const clock = new MutableClock(START);
  const service = new CrashStageStateService(
    database as unknown as DatabaseClient,
    clock,
    FIXTURE_ENVIRONMENT,
  );
  return {
    clock,
    create: (roundId: string) =>
      service.createFixtureRound({
        initialPot: usdc('0'),
        playerWalletReference: 'fixture-wallet:player',
        roundId,
        rules: STATE_RULES,
      }),
    database,
    service,
  };
}

class MutableClock {
  #current: Date;

  constructor(value: Date) {
    this.#current = new Date(value);
  }

  advance(milliseconds: number): void {
    this.#current = new Date(this.#current.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.#current);
  }
}

type MemoryRound = {
  activationMode: string;
  architectureVersion: string;
  calculatorVersion: string;
  createdAt: Date;
  decisionDeadline: Date | null;
  defaultAction: CrashDecision;
  id: string;
  playerWalletReference: string;
  potAmount: string;
  potCurrency: string;
  potDecimals: number;
  rulesHash: string;
  rulesVersion: string;
  stage: number;
  stateMachineRulesHash: string;
  stateMachineVersion: string;
  status: CrashRoundStatus;
  terminalAt: Date | null;
  terminalReason: string | null;
  updatedAt: Date;
  version: number;
};

type MemoryTransition = {
  architectureVersion: string;
  calculatorVersion: string;
  createdAt: Date;
  decision: CrashDecision | null;
  fromStage: number | null;
  fromStatus: CrashRoundStatus | null;
  id: string;
  kind: CrashTransitionKind;
  outcome: unknown;
  payment: unknown;
  requestHash: string;
  roundId: string;
  rulesHash: string;
  rulesVersion: string;
  scheduledDeadline: Date | null;
  sequence: number;
  settlement: unknown;
  stateMachineRulesHash: string;
  stateMachineVersion: string;
  terminalReason: string | null;
  toStage: number;
  toStatus: CrashRoundStatus;
  transitionKey: string;
  valueChange: unknown;
};

class MemoryCrashDatabase {
  readonly #rounds = new Map<string, MemoryRound>();
  readonly #transitions: MemoryTransition[] = [];

  readonly crashRound = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const input = data as unknown as MemoryRoundCreateInput;
      if (this.#rounds.has(input.id)) throw new Error('unique round');
      const now = new Date();
      const round: MemoryRound = {
        activationMode: input.activationMode,
        architectureVersion: input.architectureVersion,
        calculatorVersion: input.calculatorVersion,
        createdAt: now,
        decisionDeadline: input.decisionDeadline,
        defaultAction: input.defaultAction,
        id: input.id,
        playerWalletReference: input.playerWalletReference,
        potAmount: input.potAmount,
        potCurrency: input.potCurrency,
        potDecimals: input.potDecimals,
        rulesHash: input.rulesHash,
        rulesVersion: input.rulesVersion,
        stage: input.stage,
        stateMachineRulesHash: input.stateMachineRulesHash,
        stateMachineVersion: input.stateMachineVersion,
        status: input.status,
        terminalAt: null,
        terminalReason: null,
        updatedAt: now,
        version: 1,
      };
      this.#rounds.set(round.id, round);
      const transition = input.transitions.create;
      this.#transitions.push({
        ...transition,
        createdAt: now,
        decision: transition.decision ?? null,
        fromStage: transition.fromStage ?? null,
        fromStatus: transition.fromStatus ?? null,
        outcome: transition.outcome ?? null,
        payment: transition.payment ?? null,
        roundId: round.id,
        settlement: transition.settlement ?? null,
        terminalReason: transition.terminalReason ?? null,
      });
      return this.withTransitions(round);
    },
    findMany: async ({
      take,
      where,
    }: {
      take: number;
      where: {
        decisionDeadline: { lte: Date };
        status: CrashRoundStatus;
      };
    }) => {
      const deadline = where.decisionDeadline.lte as Date;
      return [...this.#rounds.values()]
        .filter(
          (round) =>
            round.status === where.status &&
            round.decisionDeadline !== null &&
            round.decisionDeadline <= deadline,
        )
        .sort(
          (left, right) =>
            (left.decisionDeadline?.getTime() ?? 0) - (right.decisionDeadline?.getTime() ?? 0) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, take)
        .map(({ decisionDeadline, id, stage, version }) => ({
          decisionDeadline: decisionDeadline ? new Date(decisionDeadline) : null,
          id,
          stage,
          version,
        }));
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const round = this.#rounds.get(where.id);
      return round ? this.withTransitions(round) : null;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const round = this.#rounds.get(where.id);
      if (!round) throw new Error('not found');
      return this.withTransitions(round);
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: {
        decisionDeadline: Date | null;
        potAmount?: string;
        stage?: number;
        status: CrashRoundStatus;
        terminalAt?: Date | null;
        terminalReason?: string | null;
        version: { increment: number };
      };
      where: {
        decisionDeadline?: { lte: Date };
        id: string;
        stage: number;
        status: CrashRoundStatus;
        version: number;
      };
    }) => {
      const round = this.#rounds.get(where.id);
      if (
        !round ||
        round.stage !== where.stage ||
        round.status !== where.status ||
        round.version !== where.version ||
        (where.decisionDeadline?.lte &&
          (!round.decisionDeadline || round.decisionDeadline > where.decisionDeadline.lte))
      ) {
        return { count: 0 };
      }
      round.decisionDeadline = data.decisionDeadline;
      if (data.potAmount !== undefined) round.potAmount = data.potAmount;
      if (data.stage !== undefined) round.stage = data.stage;
      round.status = data.status;
      round.terminalAt = data.terminalAt ?? null;
      round.terminalReason = data.terminalReason ?? null;
      round.version += data.version.increment;
      round.updatedAt = new Date();
      return { count: 1 };
    },
  };

  readonly crashTransition = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const input = data as unknown as MemoryTransitionInput;
      if (
        this.#transitions.some(
          (transition) =>
            transition.roundId === input.roundId &&
            (transition.sequence === input.sequence ||
              transition.transitionKey === input.transitionKey),
        )
      ) {
        throw new Error('unique transition');
      }
      const transition = {
        ...input,
        createdAt: new Date(),
        decision: input.decision ?? null,
        fromStage: input.fromStage ?? null,
        fromStatus: input.fromStatus ?? null,
        outcome: input.outcome ?? null,
        payment: input.payment ?? null,
        scheduledDeadline: input.scheduledDeadline ?? null,
        settlement: input.settlement ?? null,
        terminalReason: input.terminalReason ?? null,
        valueChange: input.valueChange ?? null,
      } as unknown as MemoryTransition;
      this.#transitions.push(transition);
      return structuredClone(transition);
    },
    findUnique: async ({
      where,
    }: {
      where: { roundId_transitionKey: { roundId: string; transitionKey: string } };
    }) => {
      const key = where.roundId_transitionKey;
      const transition = this.#transitions.find(
        (candidate) =>
          candidate.roundId === key.roundId && candidate.transitionKey === key.transitionKey,
      );
      return transition ? structuredClone(transition) : null;
    },
  };

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    return operation(this);
  }

  corruptRound(id: string, patch: Partial<MemoryRound>): void {
    const round = this.#rounds.get(id);
    if (!round) throw new Error('round not found');
    Object.assign(round, patch);
  }

  private withTransitions(round: MemoryRound) {
    return {
      ...structuredClone(round),
      transitions: this.#transitions
        .filter((transition) => transition.roundId === round.id)
        .sort((left, right) => left.sequence - right.sequence)
        .map((transition) => structuredClone(transition)),
    };
  }
}

interface MemoryRoundCreateInput {
  activationMode: string;
  architectureVersion: string;
  calculatorVersion: string;
  decisionDeadline: Date;
  defaultAction: CrashDecision;
  id: string;
  playerWalletReference: string;
  potAmount: string;
  potCurrency: string;
  potDecimals: number;
  rulesHash: string;
  rulesVersion: string;
  stage: number;
  stateMachineRulesHash: string;
  stateMachineVersion: string;
  status: CrashRoundStatus;
  transitions: { create: Omit<MemoryTransitionInput, 'roundId'> };
}

type MemoryTransitionInput = Omit<MemoryTransition, 'createdAt'>;
