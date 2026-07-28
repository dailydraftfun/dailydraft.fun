import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@dailydraft/db';

import {
  CRASH_SETTLEMENT_POLICY_SCHEMA_VERSION,
  type CrashSettlementPolicy,
  hashCrashSettlementPolicy,
  loadCrashSettlementPolicy,
  type UnsignedCrashSettlementPolicy,
  validateCrashSettlementPolicy,
} from './crash-settlement.policy.js';
import {
  CRASH_SETTLEMENT_PROVIDER_FIXTURE_VERSION,
  CrashSettlementAmbiguousError,
  CrashSettlementDefinitelyNotAppliedError,
  type CrashSettlementProvider,
  type CrashSettlementProviderRequest,
  type CrashSettlementProviderResult,
  DeterministicCrashSettlementFixtureProvider,
} from './crash-settlement.provider.js';
import {
  CRASH_SETTLEMENT_RECEIPT_SCHEMA_VERSION,
  CrashSettlementService as SettlementService,
} from './crash-settlement.service.js';

const FIXTURE_ENVIRONMENT = {
  DAILYDRAFT_CRASH_FIXTURE_MODE: 'true',
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;
const ROUND_ID = 'crashround_settlement_unit_01';
const PLAYER = 'fixture-wallet:settlement-player';
const SESSION_CUSTODY = 'fixture-wallet:settlement-session-custody';
const INVENTORY_CUSTODY = 'fixture-wallet:settlement-inventory-custody';
const ARCHITECTURE_VERSION = 'fixture-crash-architecture-v1';
const STATE_MACHINE_VERSION = 'dailydraft.crash-stage-state.v1';
const CALCULATOR_VERSION = 'dailydraft.crash-calculators.v1';
const RULES_VERSION = 'fixture-crash-rules-v1';
const RISK_RULES_VERSION = 'fixture-crash-risk-v1';
const STATE_HASH = 'a'.repeat(64);
const RULES_HASH = 'b'.repeat(64);
const RISK_HASH = 'c'.repeat(64);
const CUSTODY_HASH = 'd'.repeat(64);
const INVENTORY_HASH = 'e'.repeat(64);

describe('Crash settlement recovery', () => {
  test('cash out finalizes every promised transfer before writing one bound receipt', async () => {
    const fixture = settlementFixture({ outcome: 'cash-out' });

    const settled = await fixture.service.resumeFixtureSettlement(ROUND_ID);

    expect(settled).toMatchObject({
      expectedOperationCount: 1,
      finalizedOperationCount: 1,
      kind: 'cash-out',
      status: 'settled',
    });
    expect(settled.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.provider.executeKinds).toEqual(['transfer']);
    expect(fixture.database.round.settlementStatus).toBe('SETTLED');
    expect(fixture.database.round.settlementReceiptHash).toBe(settled.receiptHash);
    expect(fixture.database.settlement?.receipt).toMatchObject({
      kind: 'cash_out',
      roundId: ROUND_ID,
      schemaVersion: CRASH_SETTLEMENT_RECEIPT_SCHEMA_VERSION,
    });

    const replay = await fixture.service.resumeFixtureSettlement(ROUND_ID);
    expect(replay).toEqual(settled);
    expect(fixture.provider.executeKinds).toEqual(['transfer']);
  });

  test('bust purchases, opens, and routes every forfeited asset through the committed inventory policy', async () => {
    const fixture = settlementFixture({ outcome: 'bust', promisedAsset: true });

    const settled = await fixture.service.resumeFixtureSettlement(ROUND_ID);

    expect(settled.status).toBe('settled');
    expect(settled.operations.map(({ kind }) => kind)).toEqual(['purchase', 'open', 'transfer']);
    expect(fixture.database.inventory).toEqual([
      expect.objectContaining({
        assetReference: 'fixture-asset:settlement-stage-1',
        crashRoundId: ROUND_ID,
        custodyWallet: INVENTORY_CUSTODY,
        status: 'HELD',
      }),
    ]);
    expect(fixture.database.ledger).toEqual([
      expect.objectContaining({
        crashRoundId: ROUND_ID,
        type: 'CRASH_FORFEIT_INVENTORY',
      }),
    ]);
  });

  test('committed liquidation finalizes before marking forfeited inventory disposed', async () => {
    const fixture = settlementFixture({
      bustDisposition: 'liquidate',
      outcome: 'bust',
      promisedAsset: true,
    });

    const settled = await fixture.service.resumeFixtureSettlement(ROUND_ID);

    expect(settled.operations.map(({ kind }) => kind)).toEqual([
      'purchase',
      'open',
      'transfer',
      'liquidate',
    ]);
    expect(fixture.database.inventory[0]).toMatchObject({
      listingState: 'SOLD',
      realizedAmount: '1000000',
      status: 'DISPOSED',
    });
  });

  test.each([
    'purchase',
    'open',
    'transfer',
    'liquidate',
  ] as const)('persists a retryable %s failure and resumes without duplicating finalized effects', async (kind) => {
    const fixture = settlementFixture({
      bustDisposition: 'liquidate',
      outcome: 'bust',
      promisedAsset: true,
    });
    fixture.provider.failDefinitelyOnce(kind);

    const recovery = await fixture.service.resumeFixtureSettlement(ROUND_ID);
    expect(recovery.status).toBe('recovery-required');
    expect(recovery.operations.find((operation) => operation.kind === kind)).toMatchObject({
      failureCode: `FIXTURE_${kind.toUpperCase()}_NOT_APPLIED`,
      recoveryMode: 'retryable',
      status: 'recovery-required',
    });
    expect(fixture.database.round.settlementStatus).toBe('RECOVERY_REQUIRED');

    const settled = await fixture.service.resumeFixtureSettlement(ROUND_ID);
    expect(settled.status).toBe('settled');
    expect(fixture.provider.effectCount(kind)).toBe(1);
  });

  test('lost provider response reconciles the original request without a second signing', async () => {
    const fixture = settlementFixture({ outcome: 'cash-out' });
    fixture.provider.loseResponseAfterEffect('transfer');

    const recovery = await fixture.service.resumeFixtureSettlement(ROUND_ID);
    expect(recovery.status).toBe('recovery-required');
    expect(recovery.operations[0]).toMatchObject({
      recoveryMode: 'reconcile-only',
      status: 'recovery-required',
    });
    expect(fixture.provider.executeCount('transfer')).toBe(1);

    const restarted = new SettlementService(
      fixture.database.client,
      fixture.policy,
      fixture.provider,
      FIXTURE_ENVIRONMENT,
    );
    const settled = await restarted.resumeFixtureSettlement(ROUND_ID);
    expect(settled.status).toBe('settled');
    expect(fixture.provider.executeCount('transfer')).toBe(1);
    expect(fixture.provider.reconcileCount('transfer')).toBeGreaterThanOrEqual(2);
  });

  test('an unresolved ambiguous signature stays reconcile-only across retries', async () => {
    const fixture = settlementFixture({ outcome: 'cash-out' });
    fixture.provider.stayAmbiguous('transfer');

    const first = await fixture.service.resumeFixtureSettlement(ROUND_ID);
    const retry = await fixture.service.resumeFixtureSettlement(ROUND_ID);

    expect(first.status).toBe('recovery-required');
    expect(retry.status).toBe('recovery-required');
    expect(fixture.provider.executeCount('transfer')).toBe(1);
    expect(retry.operations[0]?.recoveryMode).toBe('reconcile-only');
  });

  test('bounded reconciliation recovers pending work and never reopens a settled plan', async () => {
    const fixture = settlementFixture({ outcome: 'cash-out' });
    fixture.provider.failDefinitelyOnce('transfer');
    await fixture.service.resumeFixtureSettlement(ROUND_ID);

    await expect(fixture.service.reconcilePendingFixtureSettlements(101)).rejects.toMatchObject({
      code: 'INVALID_EVIDENCE',
    });
    await expect(fixture.service.reconcilePendingFixtureSettlements(10)).resolves.toEqual({
      checked: 1,
      recovered: 1,
      settled: 1,
    });
    await expect(fixture.service.reconcilePendingFixtureSettlements(10)).resolves.toEqual({
      checked: 0,
      recovered: 0,
      settled: 0,
    });
  });

  test('fails closed for absent policy, active rounds, mismatched bindings, and disabled mode', async () => {
    const fixture = settlementFixture({ outcome: 'cash-out' });
    const absent = new SettlementService(
      fixture.database.client,
      null,
      fixture.provider,
      FIXTURE_ENVIRONMENT,
    );
    await expect(absent.resumeFixtureSettlement(ROUND_ID)).rejects.toMatchObject({
      code: 'DISABLED',
    });

    fixture.database.round.status = 'ACTIVE';
    await expect(fixture.service.resumeFixtureSettlement(ROUND_ID)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    fixture.database.round.status = 'CASHED_OUT';
    fixture.database.round.rulesHash = 'f'.repeat(64);
    await expect(fixture.service.resumeFixtureSettlement(ROUND_ID)).rejects.toMatchObject({
      code: 'DISABLED',
    });

    const disabled = new SettlementService(
      fixture.database.client,
      fixture.policy,
      fixture.provider,
      {
        NODE_ENV: 'production',
      },
    );
    await expect(disabled.resumeFixtureSettlement(ROUND_ID)).rejects.toMatchObject({
      code: 'DISABLED',
    });
  });

  test('detects a changed terminal plan under the same durable round', async () => {
    const fixture = settlementFixture({ outcome: 'cash-out' });
    fixture.provider.failDefinitelyOnce('transfer');
    await fixture.service.resumeFixtureSettlement(ROUND_ID);
    const settlement = fixture.database.settlement;
    expect(settlement).not.toBeNull();
    if (!settlement) {
      throw new Error('Expected the durable settlement fixture to exist');
    }
    settlement.requestHash = 'f'.repeat(64);

    await expect(fixture.service.resumeFixtureSettlement(ROUND_ID)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
  });
});

describe('Crash settlement policy and fixture provider', () => {
  test('hashes and validates one exact custody, inventory, risk, and economics binding', () => {
    const policy = settlementPolicy('hold');
    expect(validatePolicy(policy)).toEqual(policy);
    expect(() => validatePolicy({ ...policy, inventoryPolicyHash: 'bad' })).toThrow();
    expect(() => validatePolicy([{ ...policy }])).toThrow();
    expect(
      loadCrashSettlementPolicy({
        DAILYDRAFT_CRASH_FIXTURE_SETTLEMENT_POLICY_JSON: JSON.stringify(policy),
      }),
    ).toEqual(policy);
    expect(
      loadCrashSettlementPolicy({
        DAILYDRAFT_CRASH_FIXTURE_SETTLEMENT_POLICY_JSON: '{bad',
      }),
    ).toBeNull();
    expect(loadCrashSettlementPolicy({})).toBeNull();
  });

  test('fixture provider executes one keyed effect and reconciles it', async () => {
    const provider = new DeterministicCrashSettlementFixtureProvider();
    const request = providerRequest('transfer');
    const first = await provider.execute(request);
    const replay = await provider.execute(request);
    expect(replay).toEqual(first);
    expect(await provider.reconcile(request)).toEqual(first);
    expect(await provider.reconcile(providerRequest('open'))).toBeNull();
  });

  test('migration enforces terminal receipts, immutable requests, and exact inventory sources', async () => {
    const migration = await Bun.file(
      new URL(
        '../../../../packages/db/prisma/migrations/20260728220000_crash_settlement_recovery/migration.sql',
        import.meta.url,
      ),
    ).text();

    expect(migration).toContain('CrashRound_settlement_contract_check');
    expect(migration).toContain('CrashSettlement_contract_check');
    expect(migration).toContain('CrashSettlementOperation_contract_check');
    expect(migration).toContain('HouseInventoryAsset_source_contract_check');
    expect(migration).toContain('Crash settlement operation request or finality is immutable');
    expect(migration).toContain('Crash settlement plan is immutable or terminal');
    expect(migration).toContain(`"recoveryMode" IN ('RETRYABLE', 'RECONCILE_ONLY')`);
  });
});

function settlementFixture(input: {
  bustDisposition?: 'hold' | 'liquidate';
  outcome: 'bust' | 'cash-out';
  promisedAsset?: boolean;
}) {
  const policy = settlementPolicy(input.bustDisposition ?? 'hold');
  const database = new SettlementDatabase({
    outcome: input.outcome,
    policy,
    promisedAsset: input.promisedAsset ?? false,
  });
  const provider = new ScriptedSettlementProvider();
  return {
    database,
    policy,
    provider,
    service: new SettlementService(database.client, policy, provider, FIXTURE_ENVIRONMENT),
  };
}

function settlementPolicy(bustDisposition: 'hold' | 'liquidate'): CrashSettlementPolicy {
  const unsigned = {
    activation: 'fixture-only',
    approvedInventoryCustody: INVENTORY_CUSTODY,
    approvedSessionCustody: SESSION_CUSTODY,
    architectureVersion: ARCHITECTURE_VERSION,
    bustDisposition,
    calculatorVersion: CALCULATOR_VERSION,
    cashOutMode: 'assets-and-proceeds',
    custodyPolicyHash: CUSTODY_HASH,
    custodyPolicyVersion: 'fixture-custody-policy-v1',
    inventoryPolicyHash: INVENTORY_HASH,
    inventoryPolicyVersion: 'fixture-house-inventory-policy-v1',
    network: 'solana-devnet',
    policyVersion: 'fixture-crash-settlement-policy-v1',
    riskRulesHash: RISK_HASH,
    riskRulesVersion: RISK_RULES_VERSION,
    rulesHash: RULES_HASH,
    rulesVersion: RULES_VERSION,
    schemaVersion: CRASH_SETTLEMENT_POLICY_SCHEMA_VERSION,
    stateMachineRulesHash: STATE_HASH,
    stateMachineVersion: STATE_MACHINE_VERSION,
  } as const satisfies UnsignedCrashSettlementPolicy;
  return { ...unsigned, policyHash: hashCrashSettlementPolicy(unsigned) };
}

function validatePolicy(value: unknown) {
  return validateCrashSettlementPolicy(value);
}

class ScriptedSettlementProvider implements CrashSettlementProvider {
  readonly #effects = new Map<string, CrashSettlementProviderResult>();
  readonly #executeCounts = new Map<string, number>();
  readonly #reconcileCounts = new Map<string, number>();
  readonly #definiteFailures = new Set<string>();
  readonly #lostResponses = new Set<string>();
  readonly #permanentAmbiguity = new Set<string>();
  readonly executeKinds: string[] = [];

  failDefinitelyOnce(kind: string): void {
    this.#definiteFailures.add(kind);
  }

  loseResponseAfterEffect(kind: string): void {
    this.#lostResponses.add(kind);
  }

  stayAmbiguous(kind: string): void {
    this.#permanentAmbiguity.add(kind);
  }

  executeCount(kind: string): number {
    return this.#executeCounts.get(kind) ?? 0;
  }

  reconcileCount(kind: string): number {
    return this.#reconcileCounts.get(kind) ?? 0;
  }

  effectCount(kind: string): number {
    return [...this.#effects.values()].filter((result) => result.signature.includes(`:${kind}:`))
      .length;
  }

  async execute(request: CrashSettlementProviderRequest): Promise<CrashSettlementProviderResult> {
    this.executeKinds.push(request.kind);
    this.#executeCounts.set(request.kind, this.executeCount(request.kind) + 1);
    const existing = this.#effects.get(request.providerRequestKey);
    if (existing) return existing;
    if (this.#definiteFailures.delete(request.kind)) {
      throw new CrashSettlementDefinitelyNotAppliedError(
        `FIXTURE_${request.kind.toUpperCase()}_NOT_APPLIED`,
      );
    }
    if (this.#permanentAmbiguity.has(request.kind)) {
      throw new CrashSettlementAmbiguousError(`FIXTURE_${request.kind.toUpperCase()}_AMBIGUOUS`);
    }
    const result = providerResult(request);
    this.#effects.set(request.providerRequestKey, result);
    if (this.#lostResponses.delete(request.kind)) {
      throw new CrashSettlementAmbiguousError(
        `FIXTURE_${request.kind.toUpperCase()}_LOST_RESPONSE`,
        result.signature,
      );
    }
    return result;
  }

  async reconcile(
    request: CrashSettlementProviderRequest,
  ): Promise<CrashSettlementProviderResult | null> {
    this.#reconcileCounts.set(request.kind, this.reconcileCount(request.kind) + 1);
    return this.#effects.get(request.providerRequestKey) ?? null;
  }
}

class SettlementDatabase {
  readonly operations: Record<string, unknown>[] = [];
  readonly inventory: Record<string, unknown>[] = [];
  readonly ledger: Record<string, unknown>[] = [];
  settlement: Record<string, unknown> | null = null;
  readonly round: Record<string, unknown>;
  readonly reservation: Record<string, unknown>;
  readonly client: DatabaseClient;

  constructor(input: {
    outcome: 'bust' | 'cash-out';
    policy: CrashSettlementPolicy;
    promisedAsset: boolean;
  }) {
    const terminalKind = input.outcome === 'cash-out' ? 'CASHED_OUT' : 'BUSTED';
    const custodyIntent = {
      activationMode: 'fixture-only',
      approvedRecipient: SESSION_CUSTODY,
      architectureVersion: ARCHITECTURE_VERSION,
      assetReference: 'fixture-asset:settlement-stage-1',
      calculatorVersion: CALCULATOR_VERSION,
      expectedVersion: 1,
      id: 'crashcustody_settlement_stage_1',
      idempotencyKey: 'custody:settlement-stage-1',
      network: 'solana-devnet',
      playerWalletReference: PLAYER,
      policyHash: input.policy.custodyPolicyHash,
      policyVersion: input.policy.custodyPolicyVersion,
      recoveryReason: null,
      requestHash: hash('custody-request'),
      requestedRecipient: SESSION_CUSTODY,
      roundId: ROUND_ID,
      rulesHash: RULES_HASH,
      rulesVersion: RULES_VERSION,
      signingStatus: 'NOT_STARTED',
      sourceWalletReference: 'fixture-wallet:settlement-provider',
      stage: 1,
      stateMachineRulesHash: STATE_HASH,
      stateMachineVersion: STATE_MACHINE_VERSION,
      status: 'PREPARED',
    };
    const terminal = {
      calculatorVersion: CALCULATOR_VERSION,
      createdAt: new Date('2026-07-28T20:00:00.000Z'),
      decision: input.outcome === 'cash-out' ? 'CASH_OUT' : 'CONTINUE',
      fromStage: 1,
      fromStatus: 'ACTIVE',
      id: 'crashtransition_terminal_settlement_01',
      kind: terminalKind,
      outcome: input.promisedAsset
        ? {
            bust: input.outcome === 'bust',
            custody: {
              assetReference: custodyIntent.assetReference,
              reference: custodyIntent.id,
              schemaVersion: 'dailydraft.crash-custody-fixture.v1',
            },
            provider: {
              reference: 'fixture-provider:settlement-stage-1',
              resultHash: hash('provider-result'),
              rollPpm: 10,
              schemaVersion: 'dailydraft.crash-provider-fixture.v1',
              stage: 1,
              stageValue: money('1000000'),
            },
          }
        : null,
      payment: null,
      requestHash: hash('terminal-transition'),
      riskEvidence: null,
      roundId: ROUND_ID,
      rulesHash: RULES_HASH,
      rulesVersion: RULES_VERSION,
      scheduledDeadline: null,
      sequence: 1,
      settlement: {
        payout: money(input.outcome === 'cash-out' ? '3000000' : '0'),
        reference: 'fixture-settlement:terminal',
        resultHash: hash('promised-settlement'),
        schemaVersion: 'dailydraft.crash-settlement-fixture.v1',
        status: 'fixture-recorded',
      },
      stateMachineRulesHash: STATE_HASH,
      stateMachineVersion: STATE_MACHINE_VERSION,
      terminalReason: input.outcome === 'cash-out' ? 'PLAYER_CASH_OUT' : 'PROVIDER_BUST_OUTCOME',
      toStage: 1,
      toStatus: terminalKind,
      transitionKey: 'terminal-settlement',
      valueChange: {
        after: money('3000000'),
        before: money('2000000'),
        change: money('1000000'),
      },
    };
    this.round = {
      activationMode: 'fixture-only',
      architectureVersion: ARCHITECTURE_VERSION,
      calculatorVersion: CALCULATOR_VERSION,
      createdAt: new Date('2026-07-28T19:59:00.000Z'),
      custodyIntents: input.promisedAsset ? [custodyIntent] : [],
      decisionDeadline: null,
      defaultAction: 'FORFEIT',
      houseReservation: null,
      id: ROUND_ID,
      playerWalletReference: PLAYER,
      potAmount: input.outcome === 'cash-out' ? '3000000' : '0',
      potCurrency: 'USDC',
      potDecimals: 6,
      riskExpiresAt: new Date('2026-07-28T20:10:00.000Z'),
      riskRulesHash: RISK_HASH,
      riskRulesVersion: RISK_RULES_VERSION,
      riskStartedAt: new Date('2026-07-28T19:59:00.000Z'),
      rulesHash: RULES_HASH,
      rulesVersion: RULES_VERSION,
      settledAt: null,
      settlement: null,
      settlementReceiptHash: null,
      settlementStatus: 'PENDING',
      stage: 1,
      stateMachineRulesHash: STATE_HASH,
      stateMachineVersion: STATE_MACHINE_VERSION,
      status: terminalKind,
      terminalAt: new Date('2026-07-28T20:00:00.000Z'),
      terminalReason: terminal.terminalReason,
      transitions: [terminal],
      updatedAt: new Date('2026-07-28T20:00:00.000Z'),
      version: 1,
    };
    this.reservation = {
      amount: '3000000',
      crashRoundId: ROUND_ID,
      currency: 'USDC',
      decimals: 6,
      id: 'hres_crash_settlement_01',
      playerWallet: 'settlement-player',
      releasedAt: new Date('2026-07-28T20:00:00.000Z'),
      riskRulesHash: RISK_HASH,
      source: 'CRASH',
      status: 'RELEASED',
      tier: 1,
      version: 2,
    };
    this.round.houseReservation = this.reservation;
    this.client = this.createClient();
  }

  private createClient(): DatabaseClient {
    const api = {
      $transaction: async <T>(operation: (transaction: unknown) => Promise<T>): Promise<T> =>
        operation(api),
      crashRound: {
        findUnique: async () => this.hydratedRound(),
        updateMany: async ({ data, where }: Mutation) => {
          if (
            where.id &&
            where.id !== this.round.id &&
            !(
              where.settlement !== null &&
              typeof where.settlement === 'object' &&
              nestedId(where.settlement) === this.settlement?.id
            )
          ) {
            return { count: 0 };
          }
          applyData(this.round, data);
          return { count: 1 };
        },
      },
      crashSettlement: {
        create: async ({ data }: Mutation) => {
          const nested = data.operations as { create: Record<string, unknown>[] };
          this.settlement = {
            ...data,
            createdAt: new Date(),
            finalizedOperationCount: 0,
            leaseExpiresAt: null,
            leaseOwner: null,
            operations: undefined,
            receipt: null,
            receiptHash: null,
            recoveryReason: null,
            settledAt: null,
            updatedAt: new Date(),
            version: 1,
          };
          this.operations.push(
            ...nested.create.map((operation) => ({
              ...operation,
              createdAt: new Date(),
              failureCode: null,
              finalizedAt: null,
              lastAttemptedAt: null,
              providerEvidence: null,
              providerResultHash: null,
              providerSignature: null,
              recoveryMode: 'NONE',
              settlementId: this.settlement?.id,
              status: 'PREPARED',
              submissionCount: 0,
              updatedAt: new Date(),
            })),
          );
          return this.hydratedSettlement();
        },
        findMany: async () =>
          this.settlement &&
          ['PENDING', 'RECOVERY_REQUIRED'].includes(String(this.settlement.status))
            ? [
                {
                  roundId: this.settlement.roundId,
                  status: this.settlement.status,
                },
              ]
            : [],
        findUnique: async () => this.hydratedSettlement(),
        findUniqueOrThrow: async () => {
          const found = this.hydratedSettlement();
          if (!found) throw new Error('missing settlement');
          return found;
        },
        updateMany: async ({ data, where }: Mutation) => {
          if (!this.settlement || (where.id && where.id !== this.settlement.id)) {
            return { count: 0 };
          }
          if (where.leaseOwner && where.leaseOwner !== this.settlement.leaseOwner) {
            return { count: 0 };
          }
          if (typeof where.version === 'number' && where.version !== this.settlement.version) {
            return { count: 0 };
          }
          if (
            where.OR &&
            this.settlement.leaseOwner &&
            this.settlement.leaseExpiresAt instanceof Date &&
            this.settlement.leaseExpiresAt > new Date()
          ) {
            return { count: 0 };
          }
          applyData(this.settlement, data);
          return { count: 1 };
        },
      },
      crashSettlementOperation: {
        count: async ({ where }: Mutation) =>
          this.operations.filter(
            (operation) =>
              operation.settlementId === where.settlementId && operation.status === where.status,
          ).length,
        findUnique: async ({ where }: Mutation) =>
          this.operations.find((operation) => operation.id === where.id) ?? null,
        updateMany: async ({ data, where }: Mutation) => {
          const operation = this.operations.find(
            (candidate) =>
              candidate.id === where.id &&
              (!where.settlementId || candidate.settlementId === where.settlementId),
          );
          if (!operation || operation.status === 'FINALIZED') return { count: 0 };
          applyData(operation, data);
          return { count: 1 };
        },
      },
      houseInventoryAsset: {
        create: async ({ data }: Mutation) => {
          this.inventory.push({ ...data, createdAt: new Date(), updatedAt: new Date() });
          return this.inventory.at(-1);
        },
        findUnique: async ({ where }: Mutation) =>
          this.inventory.find(
            (row) => row.crashSettlementOperationId === where.crashSettlementOperationId,
          ) ?? null,
      },
      houseTreasuryLedgerEntry: {
        create: async ({ data }: Mutation) => {
          this.ledger.push({ ...data, createdAt: new Date() });
          return this.ledger.at(-1);
        },
      },
      houseTreasuryReservation: {
        findUnique: async () => this.reservation,
      },
    };
    return api as unknown as DatabaseClient;
  }

  private hydratedRound() {
    return {
      ...this.round,
      houseReservation: this.reservation,
      settlement: this.hydratedSettlement(),
    };
  }

  private hydratedSettlement() {
    return this.settlement
      ? {
          ...this.settlement,
          operations: this.operations
            .filter((operation) => operation.settlementId === this.settlement?.id)
            .sort((left, right) => Number(left.sequence) - Number(right.sequence)),
        }
      : null;
  }
}

interface Mutation {
  data: Record<string, unknown>;
  where: Record<string, unknown> & { OR?: unknown };
}

function applyData(target: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'increment' in value) {
      target[key] = Number(target[key] ?? 0) + Number(value.increment);
    } else {
      target[key] = value;
    }
  }
  target.updatedAt = new Date();
}

function nestedId(value: object): unknown {
  const relation = value as { is?: { id?: unknown } };
  return relation.is?.id;
}

function providerRequest(kind: CrashSettlementProviderRequest['kind']) {
  return {
    amount: '1000000',
    assetReference: 'fixture-asset:provider-test',
    currency: 'USDC' as const,
    decimals: 6 as const,
    destinationReference: PLAYER,
    kind,
    operationKey: `provider-test:${kind}`,
    providerRequestKey: `provider-request:${kind}`,
    requestHash: hash(`provider-request:${kind}`),
    roundId: ROUND_ID,
    sequence: 1,
    sourceReference: SESSION_CUSTODY,
    stage: 1,
  };
}

function providerResult(request: CrashSettlementProviderRequest): CrashSettlementProviderResult {
  const signature = `fixture-signature:${request.kind}:${hash(request.providerRequestKey).slice(0, 24)}`;
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
