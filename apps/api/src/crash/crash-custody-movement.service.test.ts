import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  CrashCustodyIntentStatus,
  CrashCustodySigningStatus,
  CrashDecision,
  CrashRoundStatus,
  type DatabaseClient,
} from '@dailydraft/db';

import {
  CRASH_CALCULATOR_VERSION,
  CRASH_RULES_SCHEMA_VERSION,
  type CrashCalculatorRuleSet,
  hashCrashCalculatorRuleSet,
  type UnsignedCrashCalculatorRuleSet,
} from './crash-calculators.js';
import {
  CRASH_CUSTODY_INTENT_SCHEMA_VERSION,
  CRASH_CUSTODY_POLICY_SCHEMA_VERSION,
  CrashCustodyMovementService,
  type CrashCustodyPolicy,
  hashCrashCustodyPolicy,
  loadCrashCustodyPolicy,
  type UnsignedCrashCustodyPolicy,
} from './crash-custody-movement.service.js';
import {
  CRASH_RISK_POLICY_VERSION,
  CRASH_RISK_RULES_SCHEMA_VERSION,
  type CrashRiskRules,
  hashCrashRiskRules,
  type UnsignedCrashRiskRules,
} from './crash-risk.policy.js';
import {
  CRASH_STATE_MACHINE_VERSION,
  CRASH_STATE_RULES_SCHEMA_VERSION,
  type CrashStateRules,
  hashCrashStateRules,
  type UnsignedCrashStateRules,
} from './crash-stage-state.js';

describe('CrashCustodyMovementService', () => {
  test.each([
    1, 2, 3,
  ])('prepares only the approved non-signable session-custody intent at stage %i', async (stage) => {
    const fixture = harness({ stage, version: stage });
    const input = movement(stage);

    const prepared = await fixture.service.prepareFixtureMovement(input);
    const lostResponseReplay = await fixture.service.prepareFixtureMovement(input);

    expect(lostResponseReplay).toEqual(prepared);
    expect(fixture.database.intents).toHaveLength(1);
    expect(prepared).toEqual({
      approvedRecipient: POLICY.approvedSessionCustody,
      assetReference: input.assetReference,
      id: expect.stringMatching(/^crashcustody_/),
      idempotencyKey: input.idempotencyKey,
      network: 'solana-devnet',
      playerWalletReference: PLAYER,
      policyHash: POLICY.policyHash,
      policyVersion: POLICY.policyVersion,
      recoveryReason: null,
      requestedRecipient: POLICY.approvedSessionCustody,
      roundId: ROUND_ID,
      schemaVersion: CRASH_CUSTODY_INTENT_SCHEMA_VERSION,
      signingStatus: 'not-started',
      sourceWalletReference: input.sourceWalletReference,
      stage,
      status: 'prepared',
    });
    expect(prepared).not.toHaveProperty('serializedTransaction');
    expect(prepared).not.toHaveProperty('signature');
    await expect(
      fixture.service.requirePreparedFixture(ROUND_ID, prepared.id, input.assetReference),
    ).resolves.toEqual(prepared);
    fixture.database.round.version += 1;
    await expect(
      fixture.service.requirePreparedFixture(ROUND_ID, prepared.id, input.assetReference),
    ).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
  });

  test.each([
    1, 2, 3,
  ])('rejects an alternate recipient before signing and records deterministic recovery at stage %i', async (stage) => {
    const fixture = harness({ stage, version: stage });
    const input = {
      ...movement(stage),
      requestedRecipient: 'fixture-wallet:alternate-custody',
    };

    const recovery = await fixture.service.prepareFixtureMovement(input);
    const replay = await fixture.service.prepareFixtureMovement(input);

    expect(replay).toEqual(recovery);
    expect(recovery).toMatchObject({
      approvedRecipient: POLICY.approvedSessionCustody,
      recoveryReason: 'RECIPIENT_MISMATCH',
      signingStatus: 'not-started',
      stage,
      status: 'recovery-required',
    });
    await expect(
      fixture.service.requirePreparedFixture(ROUND_ID, recovery.id, input.assetReference),
    ).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
  });

  test.each([
    {
      expected: 'CUSTODY_POLICY_ABSENT',
      name: 'absent policy',
      policy: null,
    },
    {
      expected: 'CUSTODY_POLICY_AMBIGUOUS',
      name: 'ambiguous policies',
      policy: [POLICY, { ...POLICY, policyVersion: 'other' }],
    },
    {
      expected: 'CUSTODY_POLICY_INVALID',
      name: 'invalid policy hash',
      policy: { ...POLICY, policyHash: '0'.repeat(64) },
    },
    {
      expected: 'POLICY_BINDING_MISMATCH',
      name: 'mismatched durable rules',
      policy: alternatePolicy(),
    },
  ])('records $name as recovery without signing', async ({ expected, policy }) => {
    const fixture = harness({ policy });
    const recovery = await fixture.service.prepareFixtureMovement({
      ...movement(1),
      requestedRecipient:
        policy && !Array.isArray(policy) && 'approvedSessionCustody' in policy
          ? policy.approvedSessionCustody
          : null,
    });

    expect(recovery).toMatchObject({
      recoveryReason: expected,
      signingStatus: 'not-started',
      status: 'recovery-required',
    });
    expect(fixture.database.intents[0]?.signingStatus).toBe(CrashCustodySigningStatus.NOT_STARTED);
  });

  test.each([
    {
      change: { expectedStage: 2, expectedVersion: 2 },
      expected: 'CANONICAL_STAGE_MISMATCH',
      name: 'non-canonical stage',
    },
    {
      change: { playerWalletReference: 'fixture-wallet:another-player' },
      expected: 'WALLET_OWNERSHIP_MISMATCH',
      name: 'wrong round owner',
    },
    {
      change: { rules: alternateRules() },
      expected: 'RULE_BINDING_MISMATCH',
      name: 'wrong rule binding',
    },
    {
      change: { sourceWalletReference: POLICY.approvedSessionCustody },
      expected: 'SOURCE_CUSTODY_INVALID',
      name: 'custody used as its own source',
    },
  ])('stops $name before signing', async ({ change, expected }) => {
    const fixture = harness();
    const recovery = await fixture.service.prepareFixtureMovement({
      ...movement(1),
      ...change,
    });
    expect(recovery).toMatchObject({
      recoveryReason: expected,
      signingStatus: 'not-started',
      status: 'recovery-required',
    });
  });

  test('collapses concurrent and lost-response retries onto one durable intent', async () => {
    const fixture = harness();
    const input = movement(1);

    const [first, second, third] = await Promise.all([
      fixture.service.prepareFixtureMovement(input),
      fixture.service.prepareFixtureMovement(input),
      fixture.service.prepareFixtureMovement(input),
    ]);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(fixture.database.intents).toHaveLength(1);
  });

  test('never duplicates one acquired asset under a second idempotency boundary', async () => {
    const fixture = harness();
    const input = movement(1);
    await fixture.service.prepareFixtureMovement(input);

    await expect(
      fixture.service.prepareFixtureMovement({
        ...input,
        idempotencyKey: 'custody-idempotency-stage-1-other',
      }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_TRANSITION' });
    expect(fixture.database.intents).toHaveLength(1);
  });

  test('rejects idempotency-key reuse with changed movement constraints', async () => {
    const fixture = harness();
    const input = movement(1);
    await fixture.service.prepareFixtureMovement(input);

    await expect(
      fixture.service.prepareFixtureMovement({
        ...input,
        assetReference: 'fixture-asset:changed',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  });

  test('loads only explicit JSON policy configuration and derives its approved recipient', () => {
    expect(loadCrashCustodyPolicy({})).toBeNull();
    expect(
      loadCrashCustodyPolicy({
        DAILYDRAFT_CRASH_FIXTURE_CUSTODY_POLICY_JSON: JSON.stringify(POLICY),
      }),
    ).toEqual(POLICY);
    expect(
      loadCrashCustodyPolicy({
        DAILYDRAFT_CRASH_FIXTURE_CUSTODY_POLICY_JSON: '{broken',
      }),
    ).toBeNull();
    expect(harness().service.configuredRecipient()).toBe(POLICY.approvedSessionCustody);
    expect(harness({ policy: [POLICY, POLICY] }).service.configuredRecipient()).toBeNull();
  });

  test('cannot prepare or resolve custody in production even with a synthetic policy', async () => {
    const database = new FixtureDatabase({ stage: 1, version: 1 });
    const service = new CrashCustodyMovementService(database as unknown as DatabaseClient, POLICY, {
      DAILYDRAFT_CRASH_FIXTURE_MODE: 'true',
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
    });

    expect(service.configuredRecipient()).toBeNull();
    await expect(service.prepareFixtureMovement(movement(1))).rejects.toMatchObject({
      code: 'DISABLED',
    });
    expect(database.intents).toEqual([]);
  });
});

describe('Crash custody migration contract', () => {
  test('enforces fixture-only, non-signable, append-only, one-movement semantics', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/prisma/migrations/20260728184500_crash_custody_movement_intents/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('"CrashCustodyMovementIntent_fixture_boundary_check"');
    expect(migration).toContain('"signingStatus" = \'NOT_STARTED\'');
    expect(migration).toContain('"requestedRecipient" = "approvedRecipient"');
    expect(migration).toContain('"CrashCustodyMovementIntent_prepared_asset_key"');
    expect(migration).toContain('WHERE "status" = \'PREPARED\'');
    expect(migration).toContain('Crash custody movement intents are append-only');
  });
});

function movement(stage: number) {
  return {
    assetReference: `fixture-asset:stage-${stage}`,
    expectedStage: stage,
    expectedVersion: stage,
    idempotencyKey: `custody-idempotency-stage-${stage}`,
    playerWalletReference: PLAYER,
    requestedRecipient: POLICY.approvedSessionCustody,
    roundId: ROUND_ID,
    rules: RULES,
    sourceWalletReference: `fixture-wallet:provider-stage-${stage}`,
  };
}

function harness(options: { policy?: unknown; stage?: number; version?: number } = {}) {
  const database = new FixtureDatabase({
    stage: options.stage ?? 1,
    version: options.version ?? 1,
  });
  const policy = 'policy' in options ? options.policy : POLICY;
  return {
    database,
    service: new CrashCustodyMovementService(
      database as unknown as DatabaseClient,
      policy,
      FIXTURE_ENVIRONMENT,
    ),
  };
}

type IntentRow = {
  activationMode: string;
  approvedRecipient: string | null;
  architectureVersion: string;
  assetReference: string;
  calculatorVersion: string;
  createdAt: Date;
  expectedVersion: number;
  id: string;
  idempotencyKey: string;
  network: string;
  playerWalletReference: string;
  policyHash: string | null;
  policyVersion: string | null;
  recoveryReason: string | null;
  requestHash: string;
  requestedRecipient: string;
  roundId: string;
  rulesHash: string;
  rulesVersion: string;
  signingStatus: CrashCustodySigningStatus;
  sourceWalletReference: string;
  stage: number;
  stateMachineRulesHash: string;
  stateMachineVersion: string;
  status: CrashCustodyIntentStatus;
};

class FixtureDatabase {
  readonly intents: IntentRow[] = [];
  readonly round: {
    activationMode: string;
    architectureVersion: string;
    calculatorVersion: string;
    createdAt: Date;
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
    terminalAt: null;
    terminalReason: null;
    updatedAt: Date;
    version: number;
  };

  constructor(options: { stage: number; version: number }) {
    const now = new Date('2026-07-28T18:00:00.000Z');
    this.round = {
      activationMode: 'fixture-only',
      architectureVersion: RULES.architectureVersion,
      calculatorVersion: RULES.calculatorRules.calculatorVersion,
      createdAt: now,
      decisionDeadline: new Date('2026-07-28T18:01:00.000Z'),
      defaultAction: CrashDecision.FORFEIT,
      id: ROUND_ID,
      playerWalletReference: PLAYER,
      potAmount: '0',
      potCurrency: 'USDC',
      potDecimals: 6,
      rulesHash: RULES.calculatorRules.rulesHash,
      rulesVersion: RULES.calculatorRules.rulesVersion,
      stage: options.stage,
      stateMachineRulesHash: RULES.stateMachineRulesHash,
      stateMachineVersion: RULES.stateMachineVersion,
      status: CrashRoundStatus.ACTIVE,
      terminalAt: null,
      terminalReason: null,
      updatedAt: now,
      version: options.version,
    };
  }

  readonly crashRound = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === this.round.id ? this.round : null,
  };

  readonly crashCustodyMovementIntent = {
    create: async ({ data }: { data: Omit<IntentRow, 'createdAt' | 'signingStatus'> }) => {
      if (
        this.intents.some(
          (row) =>
            (row.roundId === data.roundId && row.idempotencyKey === data.idempotencyKey) ||
            (row.roundId === data.roundId &&
              row.stage === data.stage &&
              row.assetReference === data.assetReference &&
              row.status === CrashCustodyIntentStatus.PREPARED &&
              data.status === CrashCustodyIntentStatus.PREPARED),
        )
      ) {
        throw new Error('fixture unique constraint');
      }
      const row: IntentRow = {
        ...data,
        createdAt: new Date('2026-07-28T18:00:01.000Z'),
        signingStatus: CrashCustodySigningStatus.NOT_STARTED,
      };
      this.intents.push(row);
      return row;
    },
    findFirst: async ({
      where,
    }: {
      where: {
        assetReference: string;
        roundId: string;
        stage: number;
        status: CrashCustodyIntentStatus;
      };
    }) =>
      this.intents.find(
        (row) =>
          row.assetReference === where.assetReference &&
          row.roundId === where.roundId &&
          row.stage === where.stage &&
          row.status === where.status,
      ) ?? null,
    findUnique: async ({
      where,
    }: {
      where:
        | { id: string }
        | { roundId_idempotencyKey: { idempotencyKey: string; roundId: string } };
    }) => {
      if ('id' in where) return this.intents.find((row) => row.id === where.id) ?? null;
      return (
        this.intents.find(
          (row) =>
            row.roundId === where.roundId_idempotencyKey.roundId &&
            row.idempotencyKey === where.roundId_idempotencyKey.idempotencyKey,
        ) ?? null
      );
    },
  };

  readonly $transaction = async <Result>(
    callback: (transaction: FixtureDatabase) => Promise<Result>,
  ): Promise<Result> => callback(this);
}

const ROUND_ID = 'crashround_custody_fixture';
const PLAYER = 'fixture-wallet:player-custody-fixture';
const FIXTURE_ENVIRONMENT = {
  DAILYDRAFT_CRASH_FIXTURE_MODE: 'true',
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;
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
  rulesVersion: 'synthetic-custody-rules-v1',
  schemaVersion: CRASH_RULES_SCHEMA_VERSION,
  stages: [1, 2, 3].map((stage) => ({
    bustThresholdPpm: stage * 100_000,
    maxPotAmount: String(stage * 100_000_000),
    potContributionBps: stage * 1_000,
    stage,
  })),
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
  maxPotAmount: '300000000',
  maxStage: 3,
  maxTreasuryExposureAmount: '1000000000',
  maxWalletExposureAmount: '500000000',
  network: 'solana-devnet',
  policyVersion: CRASH_RISK_POLICY_VERSION,
  poolReference: 'fixture-pool:custody-tests',
  providerReference: 'fixture-provider:custody-tests',
  rulesVersion: 'synthetic-custody-risk-v1',
  schemaVersion: CRASH_RISK_RULES_SCHEMA_VERSION,
} as const satisfies UnsignedCrashRiskRules;
const RISK_RULES: CrashRiskRules = {
  ...UNSIGNED_RISK_RULES,
  riskRulesHash: hashCrashRiskRules(UNSIGNED_RISK_RULES),
};
const UNSIGNED_RULES = {
  activation: 'fixture-only',
  architectureVersion: 'synthetic-custody-architecture-v1',
  calculatorRules: CALCULATOR_RULES,
  decisionTimeoutMs: 30_000,
  defaultAction: 'forfeit',
  riskRules: RISK_RULES,
  schemaVersion: CRASH_STATE_RULES_SCHEMA_VERSION,
  stateMachineVersion: CRASH_STATE_MACHINE_VERSION,
} as const satisfies UnsignedCrashStateRules;
const RULES: CrashStateRules = {
  ...UNSIGNED_RULES,
  stateMachineRulesHash: hashCrashStateRules(UNSIGNED_RULES),
};
const UNSIGNED_POLICY = {
  activation: 'fixture-only',
  approvedSessionCustody: 'fixture-wallet:approved-session-custody',
  architectureVersion: RULES.architectureVersion,
  calculatorVersion: RULES.calculatorRules.calculatorVersion,
  network: 'solana-devnet',
  policyVersion: 'synthetic-custody-policy-v1',
  rulesHash: RULES.calculatorRules.rulesHash,
  rulesVersion: RULES.calculatorRules.rulesVersion,
  schemaVersion: CRASH_CUSTODY_POLICY_SCHEMA_VERSION,
  stateMachineRulesHash: RULES.stateMachineRulesHash,
  stateMachineVersion: RULES.stateMachineVersion,
} as const satisfies UnsignedCrashCustodyPolicy;
const POLICY: CrashCustodyPolicy = {
  ...UNSIGNED_POLICY,
  policyHash: hashCrashCustodyPolicy(UNSIGNED_POLICY),
};

function alternateRules(): CrashStateRules {
  const unsigned = {
    ...UNSIGNED_RULES,
    architectureVersion: 'synthetic-custody-architecture-v2',
  } as const satisfies UnsignedCrashStateRules;
  return { ...unsigned, stateMachineRulesHash: hashCrashStateRules(unsigned) };
}

function alternatePolicy(): CrashCustodyPolicy {
  const unsigned = {
    ...UNSIGNED_POLICY,
    architectureVersion: 'synthetic-custody-architecture-v2',
  } as const satisfies UnsignedCrashCustodyPolicy;
  return { ...unsigned, policyHash: hashCrashCustodyPolicy(unsigned) };
}
