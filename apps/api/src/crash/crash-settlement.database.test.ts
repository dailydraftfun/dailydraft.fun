import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  createDatabaseClient,
  type DatabaseClient,
  HouseTreasuryReservationSource,
  HouseTreasuryReservationStatus,
} from '@dailydraft/db';

import {
  CRASH_SETTLEMENT_POLICY_SCHEMA_VERSION,
  type CrashSettlementPolicy,
  hashCrashSettlementPolicy,
  type UnsignedCrashSettlementPolicy,
} from './crash-settlement.policy.js';
import {
  CRASH_SETTLEMENT_PROVIDER_FIXTURE_VERSION,
  CrashSettlementAmbiguousError,
  type CrashSettlementProvider,
  type CrashSettlementProviderRequest,
  type CrashSettlementProviderResult,
} from './crash-settlement.provider.js';
import { CrashSettlementService } from './crash-settlement.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.REQUIRE_DB_INTEGRATION === '1' && !databaseUrl) {
  throw new Error('REQUIRE_DB_INTEGRATION=1 but DATABASE_URL is unset');
}
const describeDatabase =
  process.env.REQUIRE_DB_INTEGRATION === '1' && databaseUrl ? describe : describe.skip;
const PREFIX = `crash-settlement-db-${crypto.randomUUID().replaceAll('-', '')}`;
const FIXTURE_ENVIRONMENT = {
  DAILYDRAFT_CRASH_FIXTURE_MODE: 'true',
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;
const SESSION_CUSTODY = 'fixture-wallet:postgres-settlement-session';
const INVENTORY_CUSTODY = 'fixture-wallet:postgres-settlement-inventory';
const PLAYER = 'fixture-wallet:postgres-settlement-player';
const STATE_HASH = hash('postgres-state-rules');
const RULES_HASH = hash('postgres-calculator-rules');
const RISK_HASH = hash('postgres-risk-rules');
const CUSTODY_HASH = hash('postgres-custody-policy');
const INVENTORY_HASH = hash('postgres-inventory-policy');

describeDatabase('Crash settlement recovery against a real Postgres', () => {
  let database: DatabaseClient;

  beforeAll(() => {
    database = createDatabaseClient(databaseUrl ?? '');
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  test('serializes concurrent settlement and records one receipt, inventory asset, and ledger movement', async () => {
    const roundId = `${PREFIX}-concurrent`;
    const policy = settlementPolicy('hold');
    await seedBustedRound(database, roundId, policy);
    const provider = new DurableProvider();
    const firstService = new CrashSettlementService(
      database,
      policy,
      provider,
      FIXTURE_ENVIRONMENT,
    );
    const restartedService = new CrashSettlementService(
      database,
      policy,
      provider,
      FIXTURE_ENVIRONMENT,
    );

    const results = await Promise.all([
      firstService.resumeFixtureSettlement(roundId),
      restartedService.resumeFixtureSettlement(roundId),
      firstService.resumeFixtureSettlement(roundId),
    ]);
    const canonical = await firstService.resumeFixtureSettlement(roundId);

    expect(canonical).toMatchObject({
      expectedOperationCount: 3,
      finalizedOperationCount: 3,
      status: 'settled',
    });
    expect(results.some((result) => result.status === 'settled')).toBe(true);
    expect(await database.crashSettlement.count({ where: { roundId } })).toBe(1);
    expect(
      await database.crashSettlementOperation.count({
        where: { settlement: { roundId }, status: 'FINALIZED' },
      }),
    ).toBe(3);
    expect(await database.houseInventoryAsset.count({ where: { crashRoundId: roundId } })).toBe(1);
    expect(
      await database.houseTreasuryLedgerEntry.count({
        where: { crashRoundId: roundId, type: 'CRASH_FORFEIT_INVENTORY' },
      }),
    ).toBe(1);
    expect(provider.effects.size).toBe(3);
  });

  test('reconciles a lost response after service restart without a second provider execution', async () => {
    const roundId = `${PREFIX}-lost-response`;
    const policy = settlementPolicy('hold');
    await seedCashedOutRound(database, roundId);
    const provider = new DurableProvider('transfer');
    const service = new CrashSettlementService(database, policy, provider, FIXTURE_ENVIRONMENT);

    const recovery = await service.resumeFixtureSettlement(roundId);
    expect(recovery.status).toBe('recovery-required');
    expect(provider.executions).toBe(1);

    const restarted = new CrashSettlementService(database, policy, provider, FIXTURE_ENVIRONMENT);
    const settled = await restarted.resumeFixtureSettlement(roundId);
    expect(settled.status).toBe('settled');
    expect(provider.executions).toBe(1);
    expect(provider.reconciliations).toBeGreaterThanOrEqual(2);
  });

  test('database rejects tampering with a prepared operation and terminal receipt', async () => {
    const roundId = `${PREFIX}-immutable`;
    const policy = settlementPolicy('hold');
    await seedCashedOutRound(database, roundId);
    const provider = new DurableProvider();
    const service = new CrashSettlementService(database, policy, provider, FIXTURE_ENVIRONMENT);
    const settled = await service.resumeFixtureSettlement(roundId);
    expect(settled.status).toBe('settled');
    const operation = await database.crashSettlementOperation.findFirstOrThrow({
      where: { settlement: { roundId } },
    });

    await expect(
      Promise.resolve(
        database.crashSettlementOperation.update({
          data: { destinationReference: INVENTORY_CUSTODY },
          where: { id: operation.id },
        }),
      ),
    ).rejects.toThrow('Crash settlement operation request or finality is immutable');
    await expect(
      Promise.resolve(
        database.crashSettlement.update({
          data: { recoveryReason: 'TAMPERED' },
          where: { roundId },
        }),
      ),
    ).rejects.toThrow('Crash settlement plan is immutable or terminal');
  });
});

async function seedBustedRound(
  database: DatabaseClient,
  roundId: string,
  policy: CrashSettlementPolicy,
): Promise<void> {
  const transitionId = `${roundId}-transition`;
  const custodyId = `${roundId}-custody`;
  const assetReference = `${roundId}-asset`;
  await database.$transaction(async (transaction) => {
    await transaction.crashRound.create({
      data: {
        activationMode: 'fixture-only',
        architectureVersion: 'postgres-crash-architecture-v1',
        calculatorVersion: 'dailydraft.crash-calculators.v1',
        defaultAction: 'FORFEIT',
        id: roundId,
        playerWalletReference: PLAYER,
        potAmount: '1000000',
        potCurrency: 'USDC',
        potDecimals: 6,
        riskExpiresAt: new Date('2026-07-29T00:00:00.000Z'),
        riskRulesHash: RISK_HASH,
        riskRulesVersion: 'postgres-risk-rules-v1',
        riskStartedAt: new Date('2026-07-28T23:00:00.000Z'),
        rulesHash: RULES_HASH,
        rulesVersion: 'postgres-calculator-rules-v1',
        settlementStatus: 'PENDING',
        stage: 1,
        stateMachineRulesHash: STATE_HASH,
        stateMachineVersion: 'dailydraft.crash-stage-state.v1',
        status: 'BUSTED',
        terminalAt: new Date('2026-07-28T23:01:00.000Z'),
        terminalReason: 'PROVIDER_BUST_OUTCOME',
        transitions: {
          create: {
            architectureVersion: 'postgres-crash-architecture-v1',
            calculatorVersion: 'dailydraft.crash-calculators.v1',
            decision: 'CONTINUE',
            fromStage: 1,
            fromStatus: 'ACTIVE',
            id: transitionId,
            kind: 'BUSTED',
            outcome: {
              custody: {
                assetReference,
                reference: custodyId,
                schemaVersion: 'dailydraft.crash-custody-fixture.v1',
              },
              provider: {
                reference: `${roundId}-provider`,
                resultHash: hash(`${roundId}-provider`),
                rollPpm: 1,
                schemaVersion: 'dailydraft.crash-provider-fixture.v1',
                stage: 1,
                stageValue: money('1000000'),
              },
            },
            requestHash: hash(`${roundId}-transition`),
            rulesHash: RULES_HASH,
            rulesVersion: 'postgres-calculator-rules-v1',
            sequence: 1,
            settlement: {
              payout: money('0'),
              reference: `${roundId}-settlement-promise`,
              resultHash: hash(`${roundId}-settlement-promise`),
              schemaVersion: 'dailydraft.crash-settlement-fixture.v1',
              status: 'fixture-recorded',
            },
            stateMachineRulesHash: STATE_HASH,
            stateMachineVersion: 'dailydraft.crash-stage-state.v1',
            terminalReason: 'PROVIDER_BUST_OUTCOME',
            toStage: 1,
            toStatus: 'BUSTED',
            transitionKey: 'terminal',
            valueChange: {
              after: money('1000000'),
              before: money('0'),
              change: money('1000000'),
            },
          },
        },
      },
    });
    await transaction.crashCustodyMovementIntent.create({
      data: {
        activationMode: 'fixture-only',
        approvedRecipient: SESSION_CUSTODY,
        architectureVersion: 'postgres-crash-architecture-v1',
        assetReference,
        calculatorVersion: 'dailydraft.crash-calculators.v1',
        expectedVersion: 1,
        id: custodyId,
        idempotencyKey: 'settlement-custody',
        network: 'solana-devnet',
        playerWalletReference: PLAYER,
        policyHash: policy.custodyPolicyHash,
        policyVersion: policy.custodyPolicyVersion,
        requestHash: hash(`${roundId}-custody`),
        requestedRecipient: SESSION_CUSTODY,
        roundId,
        rulesHash: RULES_HASH,
        rulesVersion: 'postgres-calculator-rules-v1',
        sourceWalletReference: 'fixture-wallet:postgres-provider',
        stage: 1,
        stateMachineRulesHash: STATE_HASH,
        stateMachineVersion: 'dailydraft.crash-stage-state.v1',
        status: 'PREPARED',
      },
    });
    await createReleasedReservation(transaction, roundId, '1000000');
  });
}

async function seedCashedOutRound(database: DatabaseClient, roundId: string): Promise<void> {
  await database.$transaction(async (transaction) => {
    await transaction.crashRound.create({
      data: {
        activationMode: 'fixture-only',
        architectureVersion: 'postgres-crash-architecture-v1',
        calculatorVersion: 'dailydraft.crash-calculators.v1',
        defaultAction: 'FORFEIT',
        id: roundId,
        playerWalletReference: PLAYER,
        potAmount: '2000000',
        potCurrency: 'USDC',
        potDecimals: 6,
        riskExpiresAt: new Date('2026-07-29T00:00:00.000Z'),
        riskRulesHash: RISK_HASH,
        riskRulesVersion: 'postgres-risk-rules-v1',
        riskStartedAt: new Date('2026-07-28T23:00:00.000Z'),
        rulesHash: RULES_HASH,
        rulesVersion: 'postgres-calculator-rules-v1',
        settlementStatus: 'PENDING',
        stage: 1,
        stateMachineRulesHash: STATE_HASH,
        stateMachineVersion: 'dailydraft.crash-stage-state.v1',
        status: 'CASHED_OUT',
        terminalAt: new Date('2026-07-28T23:01:00.000Z'),
        terminalReason: 'PLAYER_CASH_OUT',
        transitions: {
          create: {
            architectureVersion: 'postgres-crash-architecture-v1',
            calculatorVersion: 'dailydraft.crash-calculators.v1',
            decision: 'CASH_OUT',
            fromStage: 1,
            fromStatus: 'ACTIVE',
            id: `${roundId}-transition`,
            kind: 'CASHED_OUT',
            requestHash: hash(`${roundId}-transition`),
            rulesHash: RULES_HASH,
            rulesVersion: 'postgres-calculator-rules-v1',
            sequence: 1,
            settlement: {
              payout: money('2000000'),
              reference: `${roundId}-settlement-promise`,
              resultHash: hash(`${roundId}-settlement-promise`),
              schemaVersion: 'dailydraft.crash-settlement-fixture.v1',
              status: 'fixture-recorded',
            },
            stateMachineRulesHash: STATE_HASH,
            stateMachineVersion: 'dailydraft.crash-stage-state.v1',
            terminalReason: 'PLAYER_CASH_OUT',
            toStage: 1,
            toStatus: 'CASHED_OUT',
            transitionKey: 'terminal',
            valueChange: {
              after: money('2000000'),
              before: money('2000000'),
              change: money('0'),
            },
          },
        },
      },
    });
    await createReleasedReservation(transaction, roundId, '2000000');
  });
}

async function createReleasedReservation(
  transaction: Parameters<Parameters<DatabaseClient['$transaction']>[0]>[0],
  roundId: string,
  amount: string,
) {
  return transaction.houseTreasuryReservation.create({
    data: {
      amount,
      crashRoundId: roundId,
      currency: 'USDC',
      decimals: 6,
      id: `${roundId}-reservation`,
      playerWallet: 'postgres-settlement-player',
      releasedAt: new Date('2026-07-28T23:01:00.000Z'),
      riskRulesHash: RISK_HASH,
      source: HouseTreasuryReservationSource.CRASH,
      status: HouseTreasuryReservationStatus.RELEASED,
      tier: 1,
    },
  });
}

function settlementPolicy(bustDisposition: 'hold' | 'liquidate'): CrashSettlementPolicy {
  const unsigned = {
    activation: 'fixture-only',
    approvedInventoryCustody: INVENTORY_CUSTODY,
    approvedSessionCustody: SESSION_CUSTODY,
    architectureVersion: 'postgres-crash-architecture-v1',
    bustDisposition,
    calculatorVersion: 'dailydraft.crash-calculators.v1',
    cashOutMode: 'assets-and-proceeds',
    custodyPolicyHash: CUSTODY_HASH,
    custodyPolicyVersion: 'postgres-custody-policy-v1',
    inventoryPolicyHash: INVENTORY_HASH,
    inventoryPolicyVersion: 'postgres-inventory-policy-v1',
    network: 'solana-devnet',
    policyVersion: 'postgres-settlement-policy-v1',
    riskRulesHash: RISK_HASH,
    riskRulesVersion: 'postgres-risk-rules-v1',
    rulesHash: RULES_HASH,
    rulesVersion: 'postgres-calculator-rules-v1',
    schemaVersion: CRASH_SETTLEMENT_POLICY_SCHEMA_VERSION,
    stateMachineRulesHash: STATE_HASH,
    stateMachineVersion: 'dailydraft.crash-stage-state.v1',
  } as const satisfies UnsignedCrashSettlementPolicy;
  return { ...unsigned, policyHash: hashCrashSettlementPolicy(unsigned) };
}

class DurableProvider implements CrashSettlementProvider {
  readonly effects = new Map<string, CrashSettlementProviderResult>();
  executions = 0;
  reconciliations = 0;
  #loseResponseFor: string | null;

  constructor(loseResponseFor: string | null = null) {
    this.#loseResponseFor = loseResponseFor;
  }

  async execute(request: CrashSettlementProviderRequest) {
    this.executions += 1;
    const existing = this.effects.get(request.providerRequestKey);
    if (existing) return existing;
    await Promise.resolve();
    const result = providerResult(request);
    this.effects.set(request.providerRequestKey, result);
    if (this.#loseResponseFor === request.kind) {
      this.#loseResponseFor = null;
      throw new CrashSettlementAmbiguousError('POSTGRES_LOST_RESPONSE', result.signature);
    }
    return result;
  }

  async reconcile(request: CrashSettlementProviderRequest) {
    this.reconciliations += 1;
    return this.effects.get(request.providerRequestKey) ?? null;
  }
}

function providerResult(request: CrashSettlementProviderRequest): CrashSettlementProviderResult {
  const signature = `fixture-signature:${hash(request.providerRequestKey).slice(0, 40)}`;
  return {
    evidence: {
      providerRequestKey: request.providerRequestKey,
      schemaVersion: CRASH_SETTLEMENT_PROVIDER_FIXTURE_VERSION,
    },
    finalized: true,
    resultHash: hash(`${request.requestHash}:${signature}`),
    signature,
  };
}

function money(amount: string) {
  return { amount, currency: 'USDC' as const, decimals: 6 as const };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
