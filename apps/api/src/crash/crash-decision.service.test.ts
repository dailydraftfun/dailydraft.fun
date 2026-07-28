import { describe, expect, test } from 'bun:test';

import {
  CRASH_CALCULATOR_VERSION,
  CRASH_RULES_SCHEMA_VERSION,
  type CrashCalculatorRuleSet,
  hashCrashCalculatorRuleSet,
  type UnsignedCrashCalculatorRuleSet,
} from './crash-calculators.js';
import type { CrashCustodyMovementService } from './crash-custody-movement.service.js';
import {
  CRASH_PLAYER_DECISION_SCHEMA_VERSION,
  CrashDecisionService,
  loadCrashDecisionRules,
} from './crash-decision.service.js';
import {
  CRASH_STATE_MACHINE_VERSION,
  CRASH_STATE_RULES_SCHEMA_VERSION,
  type CrashFixtureDecision,
  type CrashRoundSnapshot,
  type CrashStageStateService,
  CrashStateMachineError,
  type CrashStateRules,
  hashCrashStateRules,
  type UnsignedCrashStateRules,
} from './crash-stage-state.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const ROUND_ID = 'crashround_decisiontest01';
const DEADLINE = '2026-07-28T16:00:30.000Z';

describe('CrashDecisionService', () => {
  test('restores the canonical stage, deadline, disclosed default, and actions', async () => {
    const state = stateHarness(activeRound());
    const service = decisionService(state.service);

    await expect(service.currentStage(ROUND_ID, WALLET)).resolves.toEqual({
      availableActions: ['continue', 'cash-out'],
      decisionDeadline: DEADLINE,
      defaultAction: 'forfeit',
      mode: 'fixture-preview',
      network: 'solana-devnet',
      pot: usdc('0'),
      roundId: ROUND_ID,
      schemaVersion: CRASH_PLAYER_DECISION_SCHEMA_VERSION,
      stage: 1,
      status: 'active',
      terminalReason: null,
      version: 1,
    });
    expect(state.resumes).toEqual([ROUND_ID]);
  });

  test.each([
    'continue',
    'cash-out',
  ] as const)('collapses duplicate %s requests onto the accepted transition', async (action) => {
    const accepted = terminalRound(action);
    const state = stateHarness(accepted);
    const service = decisionService(state.service);

    const input = decisionInput(action);
    const first = await service.decide(input);
    const retry = await service.decide(input);

    expect(retry).toEqual(first);
    expect(first.availableActions).toEqual(
      action === 'continue' && first.status === 'active' ? ['continue', 'cash-out'] : [],
    );
    expect(state.decisions).toEqual([]);
  });

  test('submits server-owned synthetic evidence and returns the new canonical stage', async () => {
    const initial = activeRound();
    const continued = continuedRound();
    const state = stateHarness(initial, {
      decide: async (_roundId, _rules, decision) => {
        state.decisions.push(decision);
        return continued;
      },
    });
    const service = decisionService(state.service);

    await expect(service.decide(decisionInput('continue'))).resolves.toMatchObject({
      availableActions: ['continue', 'cash-out'],
      decisionDeadline: '2026-07-28T16:01:00.000Z',
      stage: 2,
      status: 'active',
      version: 2,
    });
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0]).toMatchObject({
      decision: 'continue',
      expectedStage: 1,
      expectedVersion: 1,
      transitionKey: `player:${hash('idempotency-key-0001')}`,
    });
    expect(state.decisions[0]).not.toHaveProperty('settlement');
  });

  test('stops the player decision before the state transition when custody enters recovery', async () => {
    const state = stateHarness(activeRound());
    const recoveryCustody = custodyHarness({
      prepareFixtureMovement: async (input) => ({
        ...preparedCustodyIntent(input),
        approvedRecipient: null,
        policyHash: null,
        policyVersion: null,
        recoveryReason: 'CUSTODY_POLICY_ABSENT',
        status: 'recovery-required',
      }),
    });
    const service = decisionService(state.service, RULES, recoveryCustody);

    await expect(service.decide(decisionInput('continue'))).rejects.toMatchObject({
      code: 'INVALID_EVIDENCE',
      message: expect.stringContaining('CUSTODY_POLICY_ABSENT'),
    });
    expect(state.decisions).toEqual([]);
  });

  test.each([
    ['minimum-length punctuation key', `/${'a'.repeat(15)}`],
    ['punctuated key', 'continue/request?!@#$%^&*()-=+'],
    ['maximum-length punctuation key', `/${'z'.repeat(127)}`],
  ])('derives a canonical internal custody key from a %s', async (_name, idempotencyKey) => {
    const observed: string[] = [];
    const custody = custodyHarness({
      prepareFixtureMovement: async (input) => {
        observed.push(input.idempotencyKey);
        return preparedCustodyIntent(input);
      },
    });

    await decisionService(stateHarness(activeRound()).service, RULES, custody).decide({
      ...decisionInput('continue'),
      idempotencyKey,
    });

    expect(idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(idempotencyKey.length).toBeLessThanOrEqual(128);
    expect(observed).toEqual([expect.stringMatching(/^custody:[a-f0-9]{64}$/)]);
    expect(observed[0]).not.toContain(idempotencyKey);
  });

  test('keeps exact public retries stable while different public keys derive distinct custody keys', async () => {
    const observed: string[] = [];
    const custody = custodyHarness({
      prepareFixtureMovement: async (input) => {
        observed.push(input.idempotencyKey);
        return preparedCustodyIntent(input);
      },
    });
    const exact = {
      ...decisionInput('continue'),
      idempotencyKey: 'continue/request?!@#$%^&*()-=+',
    };

    await decisionService(stateHarness(activeRound()).service, RULES, custody).decide(exact);
    await decisionService(stateHarness(activeRound()).service, RULES, custody).decide(exact);
    await decisionService(stateHarness(activeRound()).service, RULES, custody).decide({
      ...exact,
      idempotencyKey: `${exact.idempotencyKey}:different`,
    });

    expect(observed[0]).toBe(observed[1]);
    expect(observed[2]).not.toBe(observed[0]);
    expect(new Set(observed).size).toBe(2);
  });

  test('submits cash out and final-stage Continue with exact synthetic settlement evidence', async () => {
    const cashOutState = stateHarness(activeRound());
    const cashOutService = decisionService(cashOutState.service);
    await cashOutService.decide(decisionInput('cash-out'));
    expect(cashOutState.decisions[0]).toMatchObject({
      decision: 'cash-out',
      settlement: { payout: usdc('0'), status: 'fixture-recorded' },
    });

    const final = continuedRound();
    const finalState = stateHarness(final);
    const finalService = decisionService(finalState.service);
    await finalService.decide({
      ...decisionInput('continue'),
      expectedStage: 2,
      expectedVersion: 2,
      idempotencyKey: 'idempotency-key-final-0002',
    });
    expect(finalState.decisions[0]).toMatchObject({
      decision: 'continue',
      expectedStage: 2,
      expectedVersion: 2,
      settlement: { status: 'fixture-recorded' },
    });
  });

  test('returns the canonical deadline default when the decision loses the race', async () => {
    const initial = activeRound();
    const defaulted = {
      ...initial,
      decisionDeadline: null,
      status: 'defaulted' as const,
      terminalAt: '2026-07-28T16:00:30.000Z',
      terminalReason: 'DEADLINE_DEFAULT_FORFEIT',
      transitions: [
        ...initial.transitions,
        transition({
          decision: 'forfeit',
          fromStage: 1,
          kind: 'deadline-defaulted',
          sequence: 2,
          toStage: 1,
          toStatus: 'defaulted',
          transitionKey: 'deadline:1:2026-07-28T16:00:30.000Z',
        }),
      ],
      version: 2,
    };
    let calls = 0;
    const state = stateHarness(initial, {
      decide: async () => {
        throw new CrashStateMachineError('DEADLINE_EXPIRED', 'deadline expired');
      },
      resume: async () => (calls++ === 0 ? initial : defaulted),
    });
    const service = decisionService(state.service);

    await expect(service.decide(decisionInput('continue'))).resolves.toMatchObject({
      availableActions: [],
      decisionDeadline: null,
      status: 'defaulted',
      terminalReason: 'DEADLINE_DEFAULT_FORFEIT',
      version: 2,
    });
  });

  test('returns an already committed deadline default without submitting another transition', async () => {
    const defaulted = {
      ...activeRound(),
      decisionDeadline: null,
      status: 'defaulted' as const,
      terminalAt: '2026-07-28T16:00:30.000Z',
      terminalReason: 'DEADLINE_DEFAULT_FORFEIT',
      version: 2,
    };
    const state = stateHarness(defaulted);

    await expect(
      decisionService(state.service).decide(decisionInput('continue')),
    ).resolves.toMatchObject({ availableActions: [], status: 'defaulted', version: 2 });
    expect(state.decisions).toEqual([]);
  });

  test('reconciles a same-key concurrent worker retry and rejects a different winning action', async () => {
    const accepted = terminalRound('cash-out');
    let resumes = 0;
    const sameKeyState = stateHarness(activeRound(), {
      decide: async () => {
        throw new CrashStateMachineError('CONCURRENT_TRANSITION', 'worker won');
      },
      resume: async () => (resumes++ === 0 ? activeRound() : accepted),
    });
    await expect(
      decisionService(sameKeyState.service).decide(decisionInput('cash-out')),
    ).resolves.toMatchObject({ status: 'cashed-out', version: 2 });

    const otherWinner = {
      ...accepted,
      transitions: accepted.transitions.map((transition) =>
        transition.sequence === 2
          ? { ...transition, transitionKey: 'player:different-worker-key' }
          : transition,
      ),
    };
    resumes = 0;
    const otherKeyState = stateHarness(activeRound(), {
      decide: async () => {
        throw new CrashStateMachineError('CONCURRENT_TRANSITION', 'worker won');
      },
      resume: async () => (resumes++ === 0 ? activeRound() : otherWinner),
    });
    await expect(
      decisionService(otherKeyState.service).decide(decisionInput('cash-out')),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  test('does not mask an unexpected state-service failure', async () => {
    const state = stateHarness(activeRound(), {
      decide: async () => {
        throw new Error('database offline');
      },
    });
    await expect(decisionService(state.service).decide(decisionInput('continue'))).rejects.toThrow(
      'database offline',
    );
  });

  test('rejects stale decisions and idempotency-key reuse for a different action', async () => {
    const state = stateHarness(continuedRound());
    const service = decisionService(state.service);

    await expect(service.decide(decisionInput('continue'))).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });

    const accepted = terminalRound('cash-out');
    const replayState = stateHarness(accepted);
    const replayService = decisionService(replayState.service);
    await expect(replayService.decide(decisionInput('continue'))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
  });

  test('fails closed for another wallet and absent approved preview rules', async () => {
    const state = stateHarness(activeRound());
    const missingRules = decisionService(state.service, null);

    await expect(missingRules.currentStage(ROUND_ID, WALLET)).rejects.toMatchObject({
      code: 'DISABLED',
    });
    await expect(missingRules.decide(decisionInput('continue'))).rejects.toMatchObject({
      code: 'DISABLED',
    });
    await expect(
      decisionService(state.service).currentStage(
        ROUND_ID,
        'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('rejects reconnect and exact replay under a different valid rule binding', async () => {
    const reconnect = decisionService(stateHarness(activeRound()).service, ALTERNATE_RULES);
    await expect(reconnect.currentStage(ROUND_ID, WALLET)).rejects.toMatchObject({
      code: 'DISABLED',
    });

    const replay = decisionService(
      stateHarness(terminalRound('cash-out')).service,
      ALTERNATE_RULES,
    );
    await expect(replay.decide(decisionInput('cash-out'))).rejects.toMatchObject({
      code: 'DISABLED',
    });
  });

  test('loads only parseable explicitly configured fixture rules', () => {
    expect(loadCrashDecisionRules({})).toBeNull();
    expect(
      loadCrashDecisionRules({ DAILYDRAFT_CRASH_FIXTURE_RULES_JSON: JSON.stringify(RULES) }),
    ).toEqual(RULES);
    expect(loadCrashDecisionRules({ DAILYDRAFT_CRASH_FIXTURE_RULES_JSON: '{not-json' })).toBeNull();
  });
});

function stateHarness(
  snapshot: CrashRoundSnapshot,
  overrides: {
    decide?: (
      roundId: string,
      rules: unknown,
      decision: CrashFixtureDecision,
    ) => Promise<CrashRoundSnapshot>;
    resume?: (roundId: string) => Promise<CrashRoundSnapshot>;
  } = {},
) {
  const decisions: CrashFixtureDecision[] = [];
  const resumes: string[] = [];
  const service = {
    decide:
      overrides.decide ??
      (async (_roundId: string, _rules: unknown, decision: CrashFixtureDecision) => {
        decisions.push(decision);
        return snapshot;
      }),
    findRound: async () => snapshot,
    resumeFixtureRound:
      overrides.resume ??
      (async (roundId: string) => {
        resumes.push(roundId);
        return snapshot;
      }),
  } as unknown as CrashStageStateService;
  return { decisions, resumes, service };
}

function decisionService(
  state: CrashStageStateService,
  rules: unknown = RULES,
  custody: CrashCustodyMovementService = custodyHarness(),
) {
  return new CrashDecisionService(state, rules, custody);
}

function custodyHarness(
  overrides: {
    prepareFixtureMovement?: (
      input: Parameters<CrashCustodyMovementService['prepareFixtureMovement']>[0],
    ) => ReturnType<CrashCustodyMovementService['prepareFixtureMovement']>;
  } = {},
): CrashCustodyMovementService {
  return {
    configuredRecipient: () => 'fixture-wallet:approved-session-custody',
    prepareFixtureMovement:
      overrides.prepareFixtureMovement ?? (async (input) => preparedCustodyIntent(input)),
    requirePreparedFixture: async () => undefined,
  } as unknown as CrashCustodyMovementService;
}

function preparedCustodyIntent(
  input: Parameters<CrashCustodyMovementService['prepareFixtureMovement']>[0],
) {
  return {
    approvedRecipient: 'fixture-wallet:approved-session-custody',
    assetReference: input.assetReference,
    id: 'crashcustody_fixture',
    idempotencyKey: input.idempotencyKey,
    network: 'solana-devnet' as const,
    playerWalletReference: input.playerWalletReference,
    policyHash: 'a'.repeat(64),
    policyVersion: 'fixture-policy-v1',
    recoveryReason: null,
    requestedRecipient: 'fixture-wallet:approved-session-custody',
    roundId: input.roundId,
    schemaVersion: 'dailydraft.crash-custody-intent.v1' as const,
    signingStatus: 'not-started' as const,
    sourceWalletReference: input.sourceWalletReference,
    stage: input.expectedStage,
    status: 'prepared' as const,
  };
}

function decisionInput(action: 'cash-out' | 'continue') {
  return {
    action,
    expectedStage: 1,
    expectedVersion: 1,
    idempotencyKey: 'idempotency-key-0001',
    playerWallet: WALLET,
    roundId: ROUND_ID,
  };
}

function activeRound(): CrashRoundSnapshot {
  return {
    architectureVersion: RULES.architectureVersion,
    calculatorVersion: RULES.calculatorRules.calculatorVersion,
    decisionDeadline: DEADLINE,
    defaultAction: 'forfeit',
    id: ROUND_ID,
    playerWalletReference: `fixture-wallet:${WALLET}`,
    pot: usdc('0'),
    rulesHash: RULES.calculatorRules.rulesHash,
    rulesVersion: RULES.calculatorRules.rulesVersion,
    stage: 1,
    stateMachineRulesHash: RULES.stateMachineRulesHash,
    stateMachineVersion: RULES.stateMachineVersion,
    status: 'active',
    terminalAt: null,
    terminalReason: null,
    transitions: [
      transition({
        decision: null,
        fromStage: null,
        kind: 'round-started',
        sequence: 1,
        toStage: 1,
        toStatus: 'active',
        transitionKey: 'round-started',
      }),
    ],
    version: 1,
  };
}

function continuedRound(): CrashRoundSnapshot {
  const initial = activeRound();
  return {
    ...initial,
    decisionDeadline: '2026-07-28T16:01:00.000Z',
    pot: usdc('1000000'),
    stage: 2,
    transitions: [
      ...initial.transitions,
      transition({
        decision: 'continue',
        fromStage: 1,
        kind: 'stage-continued',
        sequence: 2,
        toStage: 2,
        toStatus: 'active',
        transitionKey: 'different-player-key',
      }),
    ],
    version: 2,
  };
}

function terminalRound(action: 'cash-out' | 'continue'): CrashRoundSnapshot {
  const initial = activeRound();
  const status = action === 'cash-out' ? 'cashed-out' : 'busted';
  return {
    ...initial,
    decisionDeadline: null,
    status,
    terminalAt: '2026-07-28T16:00:01.000Z',
    terminalReason: action === 'cash-out' ? 'PLAYER_CASH_OUT' : 'PROVIDER_BUST_OUTCOME',
    transitions: [
      ...initial.transitions,
      transition({
        decision: action,
        fromStage: 1,
        kind: status,
        sequence: 2,
        toStage: 1,
        toStatus: status,
        transitionKey: `player:${hash('idempotency-key-0001')}`,
      }),
    ],
    version: 2,
  };
}

function transition(input: {
  decision: 'cash-out' | 'continue' | 'forfeit' | null;
  fromStage: number | null;
  kind:
    | 'busted'
    | 'cashed-out'
    | 'completed'
    | 'deadline-defaulted'
    | 'round-started'
    | 'stage-continued';
  sequence: number;
  toStage: number;
  toStatus: CrashRoundSnapshot['status'];
  transitionKey: string;
}) {
  return {
    createdAt: '2026-07-28T16:00:00.000Z',
    decision: input.decision,
    fromStage: input.fromStage,
    fromStatus: input.fromStage === null ? null : ('active' as const),
    kind: input.kind,
    outcome: null,
    payment: null,
    scheduledDeadline: null,
    sequence: input.sequence,
    settlement: null,
    terminalReason: null,
    toStage: input.toStage,
    toStatus: input.toStatus,
    transitionKey: input.transitionKey,
    valueChange: null,
  };
}

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
  rulesVersion: 'synthetic-player-decisions-v1',
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
const UNSIGNED_RULES = {
  activation: 'fixture-only',
  architectureVersion: 'synthetic-player-decisions-architecture-v1',
  calculatorRules: CALCULATOR_RULES,
  decisionTimeoutMs: 30_000,
  defaultAction: 'forfeit',
  schemaVersion: CRASH_STATE_RULES_SCHEMA_VERSION,
  stateMachineVersion: CRASH_STATE_MACHINE_VERSION,
} as const satisfies UnsignedCrashStateRules;
const RULES: CrashStateRules = {
  ...UNSIGNED_RULES,
  stateMachineRulesHash: hashCrashStateRules(UNSIGNED_RULES),
};
const ALTERNATE_UNSIGNED_RULES = {
  ...UNSIGNED_RULES,
  architectureVersion: 'synthetic-player-decisions-architecture-v2',
} as const satisfies UnsignedCrashStateRules;
const ALTERNATE_RULES: CrashStateRules = {
  ...ALTERNATE_UNSIGNED_RULES,
  stateMachineRulesHash: hashCrashStateRules(ALTERNATE_UNSIGNED_RULES),
};

function usdc(amount: string) {
  return { amount, currency: 'USDC' as const, decimals: 6 as const };
}

function hash(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
