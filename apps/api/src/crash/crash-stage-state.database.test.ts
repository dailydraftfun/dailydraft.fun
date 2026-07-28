import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDatabaseClient, type DatabaseClient } from '@dailydraft/db';

import type { Money } from '../domain.js';
import {
  CRASH_CALCULATOR_VERSION,
  CRASH_RULES_SCHEMA_VERSION,
  type CrashCalculatorRuleSet,
  hashCrashCalculatorRuleSet,
  type UnsignedCrashCalculatorRuleSet,
} from './crash-calculators.js';
import {
  CRASH_CUSTODY_POLICY_SCHEMA_VERSION,
  CrashCustodyMovementService,
  hashCrashCustodyPolicy,
  type UnsignedCrashCustodyPolicy,
} from './crash-custody-movement.service.js';
import { CrashDecisionService } from './crash-decision.service.js';
import {
  CRASH_RISK_HEALTH_SCHEMA_VERSION,
  CRASH_RISK_POLICY_VERSION,
  CRASH_RISK_RULES_SCHEMA_VERSION,
  type CrashRiskGate,
  type CrashRiskRules,
  hashCrashRiskRules,
  type UnsignedCrashRiskRules,
} from './crash-risk.policy.js';
import {
  CRASH_CUSTODY_FIXTURE_VERSION,
  CRASH_PAYMENT_FIXTURE_VERSION,
  CRASH_PROVIDER_FIXTURE_VERSION,
  CRASH_SETTLEMENT_FIXTURE_VERSION,
  CRASH_STATE_MACHINE_VERSION,
  CRASH_STATE_RULES_SCHEMA_VERSION,
  CrashStageStateService,
  type CrashStateRules,
  hashCrashStateRules,
  type UnsignedCrashStateRules,
} from './crash-stage-state.js';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.REQUIRE_DB_INTEGRATION === '1' && !databaseUrl) {
  throw new Error('REQUIRE_DB_INTEGRATION=1 but DATABASE_URL is unset');
}
const describeDatabase =
  process.env.REQUIRE_DB_INTEGRATION === '1' && databaseUrl ? describe : describe.skip;
const ROUND_PREFIX = `crash-dbtest-${crypto.randomUUID().replaceAll('-', '')}`;
const FIXTURE_ENVIRONMENT = {
  DAILYDRAFT_CRASH_FIXTURE_MODE: 'true',
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;
const PLAYER_WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';

describeDatabase('Crash stage state machine against a real Postgres', () => {
  let database: DatabaseClient;

  beforeAll(() => {
    database = createDatabaseClient(databaseUrl ?? '');
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  test('survives service restart and collapses an idempotent concurrent transition', async () => {
    const clock = new DatabaseTestClock();
    const service = new CrashStageStateService(database, clock, FIXTURE_ENVIRONMENT, NOOP_RISK);
    const round = await service.createFixtureRound({
      initialPot: usdc('0'),
      playerWalletReference: 'fixture-wallet:postgres-player',
      riskHealth: RISK_HEALTH,
      roundId: `${ROUND_PREFIX}-resume`,
      rules: RULES,
    });
    const decision = continueDecision(round.version);

    const concurrent = await Promise.all([
      service.decide(round.id, RULES, decision),
      service.decide(round.id, RULES, decision),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0]).toMatchObject({ stage: 2, status: 'active', version: 2 });

    const restarted = new CrashStageStateService(database, clock, FIXTURE_ENVIRONMENT, NOOP_RISK);
    const resumed = await restarted.findRound(round.id);
    expect(resumed.transitions).toHaveLength(2);
    expect(resumed.transitions.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(resumed.transitions[1]).toMatchObject({
      payment: { schemaVersion: CRASH_PAYMENT_FIXTURE_VERSION },
      outcome: {
        custody: { schemaVersion: CRASH_CUSTODY_FIXTURE_VERSION },
        provider: { schemaVersion: CRASH_PROVIDER_FIXTURE_VERSION, stage: 1 },
      },
    });
    await restarted.decide(round.id, RULES, {
      decision: 'cash-out',
      expectedStage: 2,
      expectedVersion: 2,
      settlement: {
        payout: usdc('1000000'),
        reference: 'fixture-settlement:postgres-cleanup',
        resultHash: hash('settlement:postgres-cleanup'),
        schemaVersion: CRASH_SETTLEMENT_FIXTURE_VERSION,
        status: 'fixture-recorded',
      },
      transitionKey: 'cash-out-postgres-cleanup',
    });
    await expect(
      Promise.resolve(
        database.crashTransition.updateMany({
          data: { terminalReason: 'TAMPERED' },
          where: { roundId: round.id },
        }),
      ),
    ).rejects.toThrow('Crash transitions are append-only');
  });

  test('lets only one worker append the deadline default transition', async () => {
    const clock = new DatabaseTestClock();
    const service = new CrashStageStateService(database, clock, FIXTURE_ENVIRONMENT, NOOP_RISK);
    const round = await service.createFixtureRound({
      initialPot: usdc('0'),
      playerWalletReference: 'fixture-wallet:postgres-deadline',
      riskHealth: RISK_HEALTH,
      roundId: `${ROUND_PREFIX}-deadline`,
      rules: RULES,
    });
    clock.advance(10_000);

    const counts = await Promise.all([
      service.applyExpiredDefaults(),
      service.applyExpiredDefaults(),
      service.applyExpiredDefaults(),
    ]);
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(1);

    const stored = await service.findRound(round.id);
    expect(stored).toMatchObject({
      status: 'defaulted',
      terminalReason: 'DEADLINE_DEFAULT_FORFEIT',
      version: 2,
    });
    expect(stored.transitions).toHaveLength(2);
  });

  test('persists duplicate player decisions once and restores canonical reconnect state', async () => {
    const clock = new DatabaseTestClock();
    const state = new CrashStageStateService(database, clock, FIXTURE_ENVIRONMENT, NOOP_RISK);
    const decisions = new CrashDecisionService(
      state,
      RULES,
      new CrashCustodyMovementService(database, CUSTODY_POLICY, FIXTURE_ENVIRONMENT),
      RISK_HEALTH,
    );
    const round = await state.createFixtureRound({
      initialPot: usdc('1000000'),
      playerWalletReference: `fixture-wallet:${PLAYER_WALLET}`,
      riskHealth: RISK_HEALTH,
      roundId: `${ROUND_PREFIX}-player`,
      rules: RULES,
    });
    const request = {
      action: 'cash-out' as const,
      expectedStage: round.stage,
      expectedVersion: round.version,
      idempotencyKey: 'postgres-player-idempotency-0001',
      playerWallet: PLAYER_WALLET,
      roundId: round.id,
    };

    const [first, retry] = await Promise.all([
      decisions.decide(request),
      decisions.decide(request),
    ]);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      availableActions: [],
      status: 'cashed-out',
      terminalReason: 'PLAYER_CASH_OUT',
      version: 2,
    });
    await expect(decisions.currentStage(round.id, PLAYER_WALLET)).resolves.toEqual(first);
    await expect(
      decisions.decide({
        ...request,
        action: 'continue',
        idempotencyKey: 'postgres-stale-decision-0002',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const stored = await state.findRound(round.id);
    expect(stored.transitions).toHaveLength(2);
    expect(stored.transitions[1]).toMatchObject({
      decision: 'cash-out',
      fromStage: 1,
      sequence: 2,
    });
  });

  test('persists one approved custody intent when Continue responses are lost or concurrent', async () => {
    const clock = new DatabaseTestClock();
    const state = new CrashStageStateService(database, clock, FIXTURE_ENVIRONMENT, NOOP_RISK);
    const custody = new CrashCustodyMovementService(database, CUSTODY_POLICY, FIXTURE_ENVIRONMENT);
    const decisions = new CrashDecisionService(state, RULES, custody, RISK_HEALTH);
    const round = await state.createFixtureRound({
      initialPot: usdc('0'),
      playerWalletReference: `fixture-wallet:${PLAYER_WALLET}`,
      riskHealth: RISK_HEALTH,
      roundId: `${ROUND_PREFIX}-custody`,
      rules: RULES,
    });
    const request = {
      action: 'continue' as const,
      expectedStage: round.stage,
      expectedVersion: round.version,
      idempotencyKey: 'postgres-custody-idempotency-0001',
      playerWallet: PLAYER_WALLET,
      roundId: round.id,
    };

    const [first, lostResponseRetry] = await Promise.all([
      decisions.decide(request),
      decisions.decide(request),
    ]);
    expect(lostResponseRetry).toEqual(first);
    const intents = await database.crashCustodyMovementIntent.findMany({
      where: { roundId: round.id },
    });
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      approvedRecipient: CUSTODY_POLICY.approvedSessionCustody,
      requestedRecipient: CUSTODY_POLICY.approvedSessionCustody,
      signingStatus: 'NOT_STARTED',
      status: 'PREPARED',
    });
    await expect(
      Promise.resolve(
        database.crashCustodyMovementIntent.updateMany({
          data: { recoveryReason: 'TAMPERED' },
          where: { roundId: round.id },
        }),
      ),
    ).rejects.toThrow('Crash custody movement intents are append-only');
  });

  test('commits exactly one transition when reconnect and expiry workers race', async () => {
    const clock = new DatabaseTestClock();
    const state = new CrashStageStateService(database, clock, FIXTURE_ENVIRONMENT, NOOP_RISK);
    const decisions = new CrashDecisionService(
      state,
      RULES,
      new CrashCustodyMovementService(database, CUSTODY_POLICY, FIXTURE_ENVIRONMENT),
      RISK_HEALTH,
    );
    const round = await state.createFixtureRound({
      initialPot: usdc('0'),
      playerWalletReference: `fixture-wallet:${PLAYER_WALLET}`,
      riskHealth: RISK_HEALTH,
      roundId: `${ROUND_PREFIX}-deadline-race`,
      rules: RULES,
    });
    clock.advance(10_000);

    await Promise.all([
      decisions.currentStage(round.id, PLAYER_WALLET),
      state.applyExpiredDefaults(),
      state.applyExpiredDefaults(),
    ]);

    const stored = await state.findRound(round.id);
    expect(stored).toMatchObject({
      status: 'defaulted',
      terminalReason: 'DEADLINE_DEFAULT_FORFEIT',
      version: 2,
    });
    expect(stored.transitions).toHaveLength(2);
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
  rulesVersion: 'synthetic-postgres-v1',
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
  ],
} as const satisfies UnsignedCrashCalculatorRuleSet;

const CALCULATOR_RULES: CrashCalculatorRuleSet = {
  ...UNSIGNED_CALCULATOR_RULES,
  rulesHash: hashCrashCalculatorRuleSet(UNSIGNED_CALCULATOR_RULES),
};
const UNSIGNED_RISK_RULES = {
  activation: 'fixture-only',
  currency: 'USDC',
  decimals: 6,
  evidenceMaxAgeMs: 60_000,
  maxDurationMs: 300_000,
  maxPotAmount: '250000000',
  maxStage: 2,
  maxTreasuryExposureAmount: '1000000000',
  maxWalletExposureAmount: '500000000',
  network: 'solana-devnet',
  policyVersion: CRASH_RISK_POLICY_VERSION,
  poolReference: 'fixture-pool:postgres',
  providerReference: 'fixture-provider:postgres',
  rulesVersion: 'synthetic-postgres-risk-v1',
  schemaVersion: CRASH_RISK_RULES_SCHEMA_VERSION,
} as const satisfies UnsignedCrashRiskRules;
const RISK_RULES: CrashRiskRules = {
  ...UNSIGNED_RISK_RULES,
  riskRulesHash: hashCrashRiskRules(UNSIGNED_RISK_RULES),
};
const RISK_HEALTH = {
  observedAt: new Date('2026-07-28T12:00:00.000Z').toISOString(),
  poolReference: RISK_RULES.poolReference,
  poolStatus: 'healthy',
  providerReference: RISK_RULES.providerReference,
  providerStatus: 'healthy',
  riskRulesHash: RISK_RULES.riskRulesHash,
  schemaVersion: CRASH_RISK_HEALTH_SCHEMA_VERSION,
} as const;
const NOOP_RISK = {
  applyTransition: async () => {},
  releaseTerminal: async () => {},
  reserveRound: async () => {},
} as unknown as CrashRiskGate;
const UNSIGNED_RULES = {
  activation: 'fixture-only',
  architectureVersion: 'synthetic-postgres-architecture-v1',
  calculatorRules: CALCULATOR_RULES,
  decisionTimeoutMs: 10_000,
  defaultAction: 'forfeit',
  riskRules: RISK_RULES,
  schemaVersion: CRASH_STATE_RULES_SCHEMA_VERSION,
  stateMachineVersion: CRASH_STATE_MACHINE_VERSION,
} as const satisfies UnsignedCrashStateRules;
const RULES: CrashStateRules = {
  ...UNSIGNED_RULES,
  stateMachineRulesHash: hashCrashStateRules(UNSIGNED_RULES),
};
const UNSIGNED_CUSTODY_POLICY = {
  activation: 'fixture-only',
  approvedSessionCustody: 'fixture-wallet:postgres-session-custody',
  architectureVersion: RULES.architectureVersion,
  calculatorVersion: RULES.calculatorRules.calculatorVersion,
  network: 'solana-devnet',
  policyVersion: 'synthetic-postgres-custody-v1',
  rulesHash: RULES.calculatorRules.rulesHash,
  rulesVersion: RULES.calculatorRules.rulesVersion,
  schemaVersion: CRASH_CUSTODY_POLICY_SCHEMA_VERSION,
  stateMachineRulesHash: RULES.stateMachineRulesHash,
  stateMachineVersion: RULES.stateMachineVersion,
} as const satisfies UnsignedCrashCustodyPolicy;
const CUSTODY_POLICY = {
  ...UNSIGNED_CUSTODY_POLICY,
  policyHash: hashCrashCustodyPolicy(UNSIGNED_CUSTODY_POLICY),
};

function continueDecision(version: number) {
  return {
    custody: {
      assetReference: 'fixture-asset:postgres-1',
      reference: 'fixture-custody:postgres-1',
      schemaVersion: CRASH_CUSTODY_FIXTURE_VERSION,
    },
    decision: 'continue' as const,
    expectedStage: 1,
    expectedVersion: version,
    payment: {
      amount: usdc('1000000'),
      reference: 'fixture-payment:postgres-1',
      schemaVersion: CRASH_PAYMENT_FIXTURE_VERSION,
      status: 'fixture-confirmed' as const,
    },
    providerOutcome: {
      reference: 'fixture-provider:postgres-1',
      resultHash: hash('provider:postgres-1'),
      rollPpm: 900_000,
      schemaVersion: CRASH_PROVIDER_FIXTURE_VERSION,
      stage: 1,
      stageValue: usdc('1000000'),
    },
    riskHealth: RISK_HEALTH,
    transitionKey: 'continue-postgres-1',
  };
}

function usdc(amount: string): Money {
  return { amount, currency: 'USDC', decimals: 6 };
}

function hash(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

class DatabaseTestClock {
  #current = new Date('2026-07-28T13:00:00.000Z');

  advance(milliseconds: number): void {
    this.#current = new Date(this.#current.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.#current);
  }
}
