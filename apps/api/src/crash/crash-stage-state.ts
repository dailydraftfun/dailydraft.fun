import { createHash } from 'node:crypto';
import {
  type DatabaseClient,
  CrashDecision as DatabaseCrashDecision,
  CrashRoundStatus as DatabaseCrashRoundStatus,
  CrashTransitionKind as DatabaseCrashTransitionKind,
  type Prisma,
} from '@dailydraft/db';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import type { Money } from '../domain.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  CRASH_CALCULATOR_VERSION,
  type CrashCalculatorRuleSet,
  calculateCrashBust,
  calculateCrashPot,
  validateCrashCalculatorRuleSet,
} from './crash-calculators.js';

export const CRASH_STATE_MACHINE_VERSION = 'dailydraft.crash-stage-state.v1' as const;
export const CRASH_STATE_RULES_SCHEMA_VERSION = 'dailydraft.crash-state-rules.v1' as const;
export const CRASH_PAYMENT_FIXTURE_VERSION = 'dailydraft.crash-payment-fixture.v1' as const;
export const CRASH_PROVIDER_FIXTURE_VERSION = 'dailydraft.crash-provider-fixture.v1' as const;
export const CRASH_CUSTODY_FIXTURE_VERSION = 'dailydraft.crash-custody-fixture.v1' as const;
export const CRASH_SETTLEMENT_FIXTURE_VERSION = 'dailydraft.crash-settlement-fixture.v1' as const;
export const CRASH_CLOCK = Symbol('CRASH_CLOCK');
export const CRASH_ENVIRONMENT = Symbol('CRASH_ENVIRONMENT');

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FIXTURE_WALLET_PATTERN = /^fixture-wallet:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_DECISION_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const MAX_EXPIRED_BATCH = 100;
const MAX_U64 = 18_446_744_073_709_551_615n;
const PAYMENT_FIXTURE_KEYS = ['amount', 'reference', 'schemaVersion', 'status'] as const;
const PROVIDER_OUTCOME_FIXTURE_KEYS = [
  'reference',
  'resultHash',
  'rollPpm',
  'schemaVersion',
  'stage',
  'stageValue',
] as const;
const CUSTODY_FIXTURE_KEYS = ['assetReference', 'reference', 'schemaVersion'] as const;
const SETTLEMENT_FIXTURE_KEYS = [
  'payout',
  'reference',
  'resultHash',
  'schemaVersion',
  'status',
] as const;

export type CrashStateMachineErrorCode =
  | 'CONCURRENT_TRANSITION'
  | 'DEADLINE_EXPIRED'
  | 'DISABLED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'INVALID_EVIDENCE'
  | 'INVALID_TRANSITION'
  | 'NOT_FOUND';

export class CrashStateMachineError extends Error {
  constructor(
    readonly code: CrashStateMachineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CrashStateMachineError';
  }
}

export interface UnsignedCrashStateRules {
  activation: 'fixture-only';
  architectureVersion: string;
  calculatorRules: CrashCalculatorRuleSet;
  decisionTimeoutMs: number;
  defaultAction: 'forfeit';
  schemaVersion: typeof CRASH_STATE_RULES_SCHEMA_VERSION;
  stateMachineVersion: typeof CRASH_STATE_MACHINE_VERSION;
}

export interface CrashStateRules extends UnsignedCrashStateRules {
  stateMachineRulesHash: string;
}

export interface CrashPaymentFixture {
  amount: Money;
  reference: string;
  schemaVersion: typeof CRASH_PAYMENT_FIXTURE_VERSION;
  status: 'fixture-confirmed';
}

export interface CrashProviderOutcomeFixture {
  reference: string;
  resultHash: string;
  rollPpm: number;
  schemaVersion: typeof CRASH_PROVIDER_FIXTURE_VERSION;
  stage: number;
  stageValue: Money;
}

export interface CrashCustodyFixture {
  assetReference: string;
  reference: string;
  schemaVersion: typeof CRASH_CUSTODY_FIXTURE_VERSION;
}

export interface CrashSettlementFixture {
  payout: Money;
  reference: string;
  resultHash: string;
  schemaVersion: typeof CRASH_SETTLEMENT_FIXTURE_VERSION;
  status: 'fixture-recorded';
}

export interface CrashClock {
  now(): Date;
}

export interface CreateCrashFixtureRound {
  initialPot: Money;
  playerWalletReference: string;
  roundId: string;
  rules: CrashStateRules;
}

export interface ContinueCrashFixtureStage {
  custody: CrashCustodyFixture;
  decision: 'continue';
  expectedStage: number;
  expectedVersion: number;
  payment: CrashPaymentFixture;
  providerOutcome: CrashProviderOutcomeFixture;
  settlement?: CrashSettlementFixture;
  transitionKey: string;
}

export interface CashOutCrashFixtureStage {
  decision: 'cash-out';
  expectedStage: number;
  expectedVersion: number;
  settlement: CrashSettlementFixture;
  transitionKey: string;
}

export type CrashFixtureDecision = ContinueCrashFixtureStage | CashOutCrashFixtureStage;

export interface CrashRoundSnapshot {
  architectureVersion: string;
  calculatorVersion: string;
  decisionDeadline: string | null;
  defaultAction: 'forfeit';
  id: string;
  playerWalletReference: string;
  pot: Money;
  rulesHash: string;
  rulesVersion: string;
  stage: number;
  stateMachineRulesHash: string;
  stateMachineVersion: string;
  status: 'active' | 'busted' | 'cashed-out' | 'completed' | 'defaulted';
  terminalAt: string | null;
  terminalReason: string | null;
  transitions: readonly CrashTransitionSnapshot[];
  version: number;
}

export interface CrashTransitionSnapshot {
  createdAt: string;
  decision: 'cash-out' | 'continue' | 'forfeit' | null;
  fromStage: number | null;
  fromStatus: CrashRoundSnapshot['status'] | null;
  kind:
    | 'round-started'
    | 'stage-continued'
    | 'cashed-out'
    | 'busted'
    | 'completed'
    | 'deadline-defaulted';
  outcome: unknown;
  payment: unknown;
  scheduledDeadline: string | null;
  sequence: number;
  settlement: unknown;
  terminalReason: string | null;
  toStage: number;
  toStatus: CrashRoundSnapshot['status'];
  transitionKey: string;
  valueChange: unknown;
}

export function hashCrashStateRules(rules: UnsignedCrashStateRules): string {
  return sha256(stableStringify(rules));
}

export function validateCrashStateRules(value: unknown): CrashStateRules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw stateError('DISABLED', 'Crash state rules are absent');
  }
  const rules = value as Partial<CrashStateRules>;
  if (
    rules.activation !== 'fixture-only' ||
    rules.schemaVersion !== CRASH_STATE_RULES_SCHEMA_VERSION ||
    rules.stateMachineVersion !== CRASH_STATE_MACHINE_VERSION ||
    typeof rules.architectureVersion !== 'string' ||
    !IDENTIFIER_PATTERN.test(rules.architectureVersion)
  ) {
    throw stateError('DISABLED', 'Crash architecture is absent or not fixture-approved');
  }
  if (
    !Number.isInteger(rules.decisionTimeoutMs) ||
    rules.decisionTimeoutMs === undefined ||
    rules.decisionTimeoutMs <= 0 ||
    rules.decisionTimeoutMs > MAX_DECISION_TIMEOUT_MS ||
    rules.defaultAction !== 'forfeit'
  ) {
    throw stateError('DISABLED', 'Crash deadline rules are absent or unsupported');
  }
  let calculatorRules: CrashCalculatorRuleSet;
  try {
    calculatorRules = validateCrashCalculatorRuleSet(rules.calculatorRules);
  } catch {
    throw stateError('DISABLED', 'Crash economic rules are absent or unsupported');
  }
  if (
    calculatorRules.calculatorVersion !== CRASH_CALCULATOR_VERSION ||
    typeof rules.stateMachineRulesHash !== 'string' ||
    !HASH_PATTERN.test(rules.stateMachineRulesHash)
  ) {
    throw stateError('DISABLED', 'Crash rule references are incomplete');
  }
  const unsigned: UnsignedCrashStateRules = {
    activation: 'fixture-only',
    architectureVersion: rules.architectureVersion,
    calculatorRules,
    decisionTimeoutMs: rules.decisionTimeoutMs,
    defaultAction: 'forfeit',
    schemaVersion: CRASH_STATE_RULES_SCHEMA_VERSION,
    stateMachineVersion: CRASH_STATE_MACHINE_VERSION,
  };
  if (hashCrashStateRules(unsigned) !== rules.stateMachineRulesHash) {
    throw stateError('DISABLED', 'Crash state rules do not match their committed hash');
  }
  return Object.freeze({ ...unsigned, stateMachineRulesHash: rules.stateMachineRulesHash });
}

export function crashStateMachineCapability(
  rules: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): {
  fixtureReady: boolean;
  playable: false;
  reason: string;
} {
  try {
    if (!crashStateFixtureModeEnabled(environment)) throw new Error('fixture mode disabled');
    validateCrashStateRules(rules);
    return {
      fixtureReady: true,
      playable: false,
      reason:
        'Crash stage fixtures are ready; production Crash remains disabled pending HITL promotion.',
    };
  } catch {
    return {
      fixtureReady: false,
      playable: false,
      reason: 'Crash remains disabled until approved architecture and economic rules are present.',
    };
  }
}

export function crashStateFixtureModeEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.DAILYDRAFT_CRASH_FIXTURE_MODE !== 'true') return false;
  if (environment.VERCEL_ENV === 'production') return false;
  return (
    environment.NODE_ENV === 'test' ||
    environment.NODE_ENV === 'development' ||
    environment.VERCEL_ENV === 'preview'
  );
}

@Injectable()
export class CrashStageStateService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    @Inject(CRASH_CLOCK) private readonly clock: CrashClock,
    @Inject(CRASH_ENVIRONMENT) private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async createFixtureRound(input: CreateCrashFixtureRound): Promise<CrashRoundSnapshot> {
    this.requireFixtureMode();
    const rules = validateCrashStateRules(input.rules);
    requireIdentifier(input.roundId, 'roundId');
    if (!FIXTURE_WALLET_PATTERN.test(input.playerWalletReference)) {
      throw stateError('INVALID_EVIDENCE', 'Crash requires a synthetic fixture wallet reference');
    }
    const initialPot = requireMoney(input.initialPot, rules.calculatorRules, 'initial pot');
    const requestHash = sha256(
      stableStringify({
        initialPot,
        playerWalletReference: input.playerWalletReference,
        roundId: input.roundId,
        stateMachineRulesHash: rules.stateMachineRulesHash,
      }),
    );
    const existing = await this.database.crashRound.findUnique({
      include: { transitions: { orderBy: { sequence: 'asc' } } },
      where: { id: input.roundId },
    });
    if (existing) {
      const started = existing.transitions[0];
      if (started?.requestHash !== requestHash) {
        throw stateError('IDEMPOTENCY_MISMATCH', 'Crash roundId was reused with different input');
      }
      return toSnapshot(existing);
    }

    const now = this.clock.now();
    const deadline = new Date(now.getTime() + rules.decisionTimeoutMs);
    try {
      const created = await this.database.$transaction(
        (transaction) =>
          transaction.crashRound.create({
            data: {
              architectureVersion: rules.architectureVersion,
              activationMode: 'fixture-only',
              calculatorVersion: rules.calculatorRules.calculatorVersion,
              decisionDeadline: deadline,
              defaultAction: DatabaseCrashDecision.FORFEIT,
              id: input.roundId,
              playerWalletReference: input.playerWalletReference,
              potAmount: initialPot.amount,
              potCurrency: initialPot.currency,
              potDecimals: initialPot.decimals,
              rulesHash: rules.calculatorRules.rulesHash,
              rulesVersion: rules.calculatorRules.rulesVersion,
              stage: 1,
              stateMachineRulesHash: rules.stateMachineRulesHash,
              stateMachineVersion: rules.stateMachineVersion,
              status: DatabaseCrashRoundStatus.ACTIVE,
              transitions: {
                create: {
                  architectureVersion: rules.architectureVersion,
                  calculatorVersion: rules.calculatorRules.calculatorVersion,
                  id: createId('crashtransition'),
                  kind: DatabaseCrashTransitionKind.ROUND_STARTED,
                  requestHash,
                  rulesHash: rules.calculatorRules.rulesHash,
                  rulesVersion: rules.calculatorRules.rulesVersion,
                  scheduledDeadline: deadline,
                  sequence: 1,
                  stateMachineRulesHash: rules.stateMachineRulesHash,
                  stateMachineVersion: rules.stateMachineVersion,
                  toStage: 1,
                  toStatus: DatabaseCrashRoundStatus.ACTIVE,
                  transitionKey: 'round-started',
                  valueChange: moneyJson(initialPot, initialPot, zeroMoney()),
                },
              },
            },
            include: { transitions: { orderBy: { sequence: 'asc' } } },
          }),
        { isolationLevel: 'Serializable' },
      );
      return toSnapshot(created);
    } catch (error) {
      const concurrent = await this.database.crashRound.findUnique({
        include: { transitions: { orderBy: { sequence: 'asc' } } },
        where: { id: input.roundId },
      });
      if (concurrent?.transitions[0]?.requestHash === requestHash) return toSnapshot(concurrent);
      throw error;
    }
  }

  async findRound(roundId: string): Promise<CrashRoundSnapshot> {
    requireIdentifier(roundId, 'roundId');
    const round = await this.database.crashRound.findUnique({
      include: { transitions: { orderBy: { sequence: 'asc' } } },
      where: { id: roundId },
    });
    if (!round) throw stateError('NOT_FOUND', `Crash round ${roundId} was not found`);
    return toSnapshot(round);
  }

  /**
   * Restore the canonical player-visible state after a reconnect.
   *
   * An expired ACTIVE row is not a valid state to hand back to a player: the
   * pre-disclosed default has already become the only legal transition. Resolve
   * that transition through the same optimistic database boundary used by the
   * expiry worker, then reload the append-only ledger. A simultaneous decision
   * or worker can win the compare-and-set; either way the reload is canonical.
   */
  async resumeFixtureRound(roundId: string): Promise<CrashRoundSnapshot> {
    this.requireFixtureMode();
    const current = await this.findRound(roundId);
    if (
      current.status === 'active' &&
      current.decisionDeadline &&
      new Date(current.decisionDeadline) <= this.clock.now()
    ) {
      await this.applyDefault(
        {
          decisionDeadline: new Date(current.decisionDeadline),
          id: current.id,
          stage: current.stage,
          version: current.version,
        },
        this.clock.now(),
      );
      return this.findRound(roundId);
    }
    return current;
  }

  async decide(
    roundId: string,
    rulesInput: unknown,
    input: CrashFixtureDecision,
  ): Promise<CrashRoundSnapshot> {
    this.requireFixtureMode();
    const rules = validateCrashStateRules(rulesInput);
    requireIdentifier(roundId, 'roundId');
    requireIdentifier(input.transitionKey, 'transitionKey');
    const normalized = normalizeDecisionEvidence(rules.calculatorRules, input);
    const requestHash = sha256(
      stableStringify({
        evidence: normalized,
        ruleBinding: {
          architectureVersion: rules.architectureVersion,
          calculatorVersion: rules.calculatorRules.calculatorVersion,
          rulesHash: rules.calculatorRules.rulesHash,
          rulesVersion: rules.calculatorRules.rulesVersion,
          stateMachineRulesHash: rules.stateMachineRulesHash,
          stateMachineVersion: rules.stateMachineVersion,
        },
      }),
    );
    const replay = await this.findReplay(roundId, input.transitionKey, requestHash);
    if (replay) return replay;

    const now = this.clock.now();
    try {
      return await this.database
        .$transaction(
          async (transaction) => {
            const current = await transaction.crashRound.findUnique({ where: { id: roundId } });
            if (!current) throw stateError('NOT_FOUND', `Crash round ${roundId} was not found`);
            assertCrashRoundRuleBinding(current, rules);
            if (current.status !== DatabaseCrashRoundStatus.ACTIVE) {
              throw stateError('INVALID_TRANSITION', 'A terminal Crash round cannot transition');
            }
            if (
              current.stage !== input.expectedStage ||
              current.version !== input.expectedVersion
            ) {
              throw stateError(
                'INVALID_TRANSITION',
                'Crash transition does not match the durable stage and version',
              );
            }
            if (!current.decisionDeadline || current.decisionDeadline <= now) {
              throw stateError('DEADLINE_EXPIRED', 'Crash decision deadline has expired');
            }

            const next = resolveDecision(current, rules, normalized, now);
            const updated = await transaction.crashRound.updateMany({
              data: {
                decisionDeadline: next.decisionDeadline,
                potAmount: next.potAfter.amount,
                stage: next.stage,
                status: next.status,
                terminalAt: next.terminalAt,
                terminalReason: next.terminalReason,
                version: { increment: 1 },
              },
              where: {
                id: roundId,
                stage: current.stage,
                status: DatabaseCrashRoundStatus.ACTIVE,
                version: current.version,
              },
            });
            if (updated.count !== 1) {
              throw stateError('CONCURRENT_TRANSITION', 'Crash stage changed concurrently');
            }
            await transaction.crashTransition.create({
              data: transitionData({
                current,
                input,
                next,
                normalized,
                requestHash,
                rules,
                roundId,
              }),
            });
            return loadRound(transaction, roundId);
          },
          { isolationLevel: 'Serializable' },
        )
        .then(toSnapshot);
    } catch (error) {
      const concurrentReplay = await this.findReplay(roundId, input.transitionKey, requestHash);
      if (concurrentReplay) return concurrentReplay;
      if (error instanceof CrashStateMachineError) throw error;
      const moved = await this.database.crashRound.findUnique({
        select: { stage: true, status: true, version: true },
        where: { id: roundId },
      });
      if (
        moved &&
        (moved.status !== DatabaseCrashRoundStatus.ACTIVE ||
          moved.stage !== input.expectedStage ||
          moved.version !== input.expectedVersion)
      ) {
        throw stateError('CONCURRENT_TRANSITION', 'Crash stage changed concurrently');
      }
      throw error;
    }
  }

  async applyExpiredDefaults(
    now: Date = this.clock.now(),
    limit = MAX_EXPIRED_BATCH,
  ): Promise<number> {
    this.requireFixtureMode();
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_EXPIRED_BATCH) {
      throw stateError('INVALID_TRANSITION', 'Crash expiry batch limit is invalid');
    }
    const expired = await this.database.crashRound.findMany({
      orderBy: [{ decisionDeadline: 'asc' }, { id: 'asc' }],
      select: {
        decisionDeadline: true,
        id: true,
        stage: true,
        version: true,
      },
      take: limit,
      where: {
        decisionDeadline: { lte: now },
        status: DatabaseCrashRoundStatus.ACTIVE,
      },
    });
    let changed = 0;
    for (const candidate of expired) {
      if (!candidate.decisionDeadline) continue;
      if (
        await this.applyDefault(
          {
            ...candidate,
            decisionDeadline: candidate.decisionDeadline,
          },
          now,
        )
      ) {
        changed += 1;
      }
    }
    return changed;
  }

  private async applyDefault(
    candidate: {
      decisionDeadline: Date;
      id: string;
      stage: number;
      version: number;
    },
    now: Date,
  ): Promise<boolean> {
    const transitionKey = `deadline:${candidate.stage}:${candidate.decisionDeadline.toISOString()}`;
    const requestHash = sha256(
      stableStringify({
        deadline: candidate.decisionDeadline.toISOString(),
        decision: 'forfeit',
        expectedStage: candidate.stage,
        expectedVersion: candidate.version,
      }),
    );
    try {
      return await this.database.$transaction(async (transaction) => {
        const current = await transaction.crashRound.findUnique({ where: { id: candidate.id } });
        if (
          !current ||
          current.status !== DatabaseCrashRoundStatus.ACTIVE ||
          current.stage !== candidate.stage ||
          current.version !== candidate.version ||
          !current.decisionDeadline ||
          current.decisionDeadline > now
        ) {
          return false;
        }
        const updated = await transaction.crashRound.updateMany({
          data: {
            decisionDeadline: null,
            status: DatabaseCrashRoundStatus.DEFAULTED,
            terminalAt: now,
            terminalReason: 'DEADLINE_DEFAULT_FORFEIT',
            version: { increment: 1 },
          },
          where: {
            decisionDeadline: { lte: now },
            id: current.id,
            stage: current.stage,
            status: DatabaseCrashRoundStatus.ACTIVE,
            version: current.version,
          },
        });
        if (updated.count !== 1) return false;
        await transaction.crashTransition.create({
          data: {
            architectureVersion: current.architectureVersion,
            calculatorVersion: current.calculatorVersion,
            decision: DatabaseCrashDecision.FORFEIT,
            fromStage: current.stage,
            fromStatus: current.status,
            id: createId('crashtransition'),
            kind: DatabaseCrashTransitionKind.DEADLINE_DEFAULTED,
            requestHash,
            roundId: current.id,
            rulesHash: current.rulesHash,
            rulesVersion: current.rulesVersion,
            scheduledDeadline: current.decisionDeadline,
            sequence: current.version + 1,
            settlement: defaultSettlementJson(current.id, current.stage),
            stateMachineRulesHash: current.stateMachineRulesHash,
            stateMachineVersion: current.stateMachineVersion,
            terminalReason: 'DEADLINE_DEFAULT_FORFEIT',
            toStage: current.stage,
            toStatus: DatabaseCrashRoundStatus.DEFAULTED,
            transitionKey,
            valueChange: moneyJson(money(current.potAmount), money(current.potAmount), zeroMoney()),
          },
        });
        return true;
      });
    } catch (error) {
      const replay = await this.database.crashTransition.findUnique({
        where: { roundId_transitionKey: { roundId: candidate.id, transitionKey } },
      });
      if (replay?.requestHash === requestHash) return false;
      throw error;
    }
  }

  private async findReplay(
    roundId: string,
    transitionKey: string,
    requestHash: string,
  ): Promise<CrashRoundSnapshot | null> {
    const existing = await this.database.crashTransition.findUnique({
      where: { roundId_transitionKey: { roundId, transitionKey } },
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw stateError(
        'IDEMPOTENCY_MISMATCH',
        'Crash transitionKey was reused with different evidence',
      );
    }
    return this.findRound(roundId);
  }

  private requireFixtureMode(): void {
    if (!crashStateFixtureModeEnabled(this.environment)) {
      throw stateError(
        'DISABLED',
        'Crash stage state is disabled outside explicit fixture or preview mode',
      );
    }
  }
}

type NormalizedDecision =
  | {
      custody: CrashCustodyFixture;
      decision: 'continue';
      expectedStage: number;
      expectedVersion: number;
      payment: CrashPaymentFixture;
      providerOutcome: CrashProviderOutcomeFixture;
      settlement: CrashSettlementFixture | null;
      transitionKey: string;
    }
  | {
      decision: 'cash-out';
      expectedStage: number;
      expectedVersion: number;
      settlement: CrashSettlementFixture;
      transitionKey: string;
    };

function normalizeDecisionEvidence(
  calculatorRules: CrashCalculatorRuleSet,
  input: CrashFixtureDecision,
): NormalizedDecision {
  if (
    !Number.isInteger(input.expectedStage) ||
    input.expectedStage <= 0 ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion <= 0
  ) {
    throw stateError('INVALID_TRANSITION', 'Crash expected stage and version are invalid');
  }
  if (input.decision === 'cash-out') {
    return {
      decision: 'cash-out',
      expectedStage: input.expectedStage,
      expectedVersion: input.expectedVersion,
      settlement: requireSettlement(input.settlement, calculatorRules),
      transitionKey: input.transitionKey,
    };
  }
  const providerOutcome = requireProviderOutcome(
    input.providerOutcome,
    calculatorRules,
    input.expectedStage,
  );
  return {
    custody: requireCustody(input.custody),
    decision: 'continue',
    expectedStage: input.expectedStage,
    expectedVersion: input.expectedVersion,
    payment: requirePayment(input.payment, calculatorRules),
    providerOutcome,
    settlement: input.settlement ? requireSettlement(input.settlement, calculatorRules) : null,
    transitionKey: input.transitionKey,
  };
}

function resolveDecision(
  current: CrashRoundRow,
  rules: CrashStateRules,
  input: NormalizedDecision,
  now: Date,
): ResolvedTransition {
  const potBefore = money(current.potAmount);
  if (input.decision === 'cash-out') {
    if (input.settlement.payout.amount !== current.potAmount) {
      throw stateError('INVALID_EVIDENCE', 'Crash cash-out settlement must equal the durable pot');
    }
    return {
      bust: null,
      decisionDeadline: null,
      kind: DatabaseCrashTransitionKind.CASHED_OUT,
      potAfter: potBefore,
      potCalculation: null,
      stage: current.stage,
      status: DatabaseCrashRoundStatus.CASHED_OUT,
      terminalAt: now,
      terminalReason: 'PLAYER_CASH_OUT',
    };
  }
  const potCalculation = calculateCrashPot(rules.calculatorRules, {
    currentPot: potBefore,
    stage: current.stage,
    stageValue: input.providerOutcome.stageValue,
  });
  const bust = calculateCrashBust(rules.calculatorRules, {
    rollPpm: input.providerOutcome.rollPpm,
    stage: current.stage,
  });
  const lastStage = current.stage === rules.calculatorRules.stages.length;
  if (bust.busted) {
    requireTerminalSettlement(input.settlement, zeroMoney(), 'busted');
    return {
      bust,
      decisionDeadline: null,
      kind: DatabaseCrashTransitionKind.BUSTED,
      potAfter: potCalculation.nextPot,
      potCalculation,
      stage: current.stage,
      status: DatabaseCrashRoundStatus.BUSTED,
      terminalAt: now,
      terminalReason: 'PROVIDER_BUST_OUTCOME',
    };
  }
  if (lastStage) {
    requireTerminalSettlement(input.settlement, potCalculation.nextPot, 'completed');
    return {
      bust,
      decisionDeadline: null,
      kind: DatabaseCrashTransitionKind.COMPLETED,
      potAfter: potCalculation.nextPot,
      potCalculation,
      stage: current.stage,
      status: DatabaseCrashRoundStatus.COMPLETED,
      terminalAt: now,
      terminalReason: 'FINAL_STAGE_COMPLETED',
    };
  }
  if (input.settlement) {
    throw stateError('INVALID_EVIDENCE', 'A non-terminal Crash continue cannot settle');
  }
  return {
    bust,
    decisionDeadline: new Date(now.getTime() + rules.decisionTimeoutMs),
    kind: DatabaseCrashTransitionKind.STAGE_CONTINUED,
    potAfter: potCalculation.nextPot,
    potCalculation,
    stage: current.stage + 1,
    status: DatabaseCrashRoundStatus.ACTIVE,
    terminalAt: null,
    terminalReason: null,
  };
}

function transitionData(input: {
  current: CrashRoundRow;
  input: CrashFixtureDecision;
  next: ResolvedTransition;
  normalized: NormalizedDecision;
  requestHash: string;
  roundId: string;
  rules: CrashStateRules;
}): Prisma.CrashTransitionUncheckedCreateInput {
  const { current, next, normalized, requestHash, roundId, rules } = input;
  const outcome =
    normalized.decision === 'continue'
      ? {
          bust: next.bust,
          custody: normalized.custody,
          provider: normalized.providerOutcome,
        }
      : undefined;
  return {
    architectureVersion: rules.architectureVersion,
    calculatorVersion: rules.calculatorRules.calculatorVersion,
    decision:
      normalized.decision === 'continue'
        ? DatabaseCrashDecision.CONTINUE
        : DatabaseCrashDecision.CASH_OUT,
    fromStage: current.stage,
    fromStatus: current.status,
    id: createId('crashtransition'),
    kind: next.kind,
    ...(outcome ? { outcome: outcome as unknown as Prisma.InputJsonValue } : {}),
    ...(normalized.decision === 'continue'
      ? { payment: normalized.payment as unknown as Prisma.InputJsonValue }
      : {}),
    requestHash,
    roundId,
    rulesHash: rules.calculatorRules.rulesHash,
    rulesVersion: rules.calculatorRules.rulesVersion,
    scheduledDeadline: next.decisionDeadline,
    sequence: current.version + 1,
    ...(normalized.settlement === null
      ? {}
      : { settlement: normalized.settlement as unknown as Prisma.InputJsonValue }),
    stateMachineRulesHash: rules.stateMachineRulesHash,
    stateMachineVersion: rules.stateMachineVersion,
    terminalReason: next.terminalReason,
    toStage: next.stage,
    toStatus: next.status,
    transitionKey: input.input.transitionKey,
    valueChange: next.potCalculation
      ? ({
          calculationHash: next.potCalculation.calculationHash,
          currentPot: next.potCalculation.currentPot,
          nextPot: next.potCalculation.nextPot,
          valueChange: next.potCalculation.valueChange,
        } as unknown as Prisma.InputJsonValue)
      : moneyJson(money(current.potAmount), next.potAfter, zeroMoney()),
  };
}

type CrashRoundRow = Prisma.CrashRoundGetPayload<Record<string, never>>;
type CrashRoundWithTransitions = Prisma.CrashRoundGetPayload<{
  include: { transitions: true };
}>;

interface ResolvedTransition {
  bust: ReturnType<typeof calculateCrashBust> | null;
  decisionDeadline: Date | null;
  kind: DatabaseCrashTransitionKind;
  potAfter: Money;
  potCalculation: ReturnType<typeof calculateCrashPot> | null;
  stage: number;
  status: DatabaseCrashRoundStatus;
  terminalAt: Date | null;
  terminalReason: string | null;
}

type CrashRoundRuleBinding = Pick<
  CrashRoundSnapshot,
  | 'architectureVersion'
  | 'calculatorVersion'
  | 'rulesHash'
  | 'rulesVersion'
  | 'stateMachineRulesHash'
  | 'stateMachineVersion'
>;

export function assertCrashRoundRuleBinding(
  current: CrashRoundRuleBinding,
  rules: CrashStateRules,
): void {
  if (
    current.architectureVersion !== rules.architectureVersion ||
    current.stateMachineVersion !== rules.stateMachineVersion ||
    current.stateMachineRulesHash !== rules.stateMachineRulesHash ||
    current.calculatorVersion !== rules.calculatorRules.calculatorVersion ||
    current.rulesVersion !== rules.calculatorRules.rulesVersion ||
    current.rulesHash !== rules.calculatorRules.rulesHash
  ) {
    throw stateError('DISABLED', 'Crash round rule references do not match');
  }
}

async function loadRound(
  transaction: Prisma.TransactionClient,
  roundId: string,
): Promise<CrashRoundWithTransitions> {
  return transaction.crashRound.findUniqueOrThrow({
    include: { transitions: { orderBy: { sequence: 'asc' } } },
    where: { id: roundId },
  });
}

function toSnapshot(round: CrashRoundWithTransitions): CrashRoundSnapshot {
  assertRoundLedger(round);
  return {
    architectureVersion: round.architectureVersion,
    calculatorVersion: round.calculatorVersion,
    decisionDeadline: round.decisionDeadline?.toISOString() ?? null,
    defaultAction: 'forfeit',
    id: round.id,
    playerWalletReference: round.playerWalletReference,
    pot: storedMoney(round.potAmount, round.potCurrency, round.potDecimals),
    rulesHash: round.rulesHash,
    rulesVersion: round.rulesVersion,
    stage: round.stage,
    stateMachineRulesHash: round.stateMachineRulesHash,
    stateMachineVersion: round.stateMachineVersion,
    status: toStatus(round.status),
    terminalAt: round.terminalAt?.toISOString() ?? null,
    terminalReason: round.terminalReason,
    transitions: round.transitions.map((transition) => ({
      createdAt: transition.createdAt.toISOString(),
      decision: transition.decision ? toDecision(transition.decision) : null,
      fromStage: transition.fromStage,
      fromStatus: transition.fromStatus ? toStatus(transition.fromStatus) : null,
      kind: toKind(transition.kind),
      outcome: transition.outcome,
      payment: transition.payment,
      scheduledDeadline: transition.scheduledDeadline?.toISOString() ?? null,
      sequence: transition.sequence,
      settlement: transition.settlement,
      terminalReason: transition.terminalReason,
      toStage: transition.toStage,
      toStatus: toStatus(transition.toStatus),
      transitionKey: transition.transitionKey,
      valueChange: transition.valueChange,
    })),
    version: round.version,
  };
}

function assertRoundLedger(round: CrashRoundWithTransitions): void {
  const terminal = round.status !== DatabaseCrashRoundStatus.ACTIVE;
  const transitionsValid =
    round.activationMode === 'fixture-only' &&
    round.defaultAction === DatabaseCrashDecision.FORFEIT &&
    round.transitions.length === round.version &&
    round.transitions.every(
      (transition, index) =>
        transition.sequence === index + 1 &&
        transition.architectureVersion === round.architectureVersion &&
        transition.stateMachineVersion === round.stateMachineVersion &&
        transition.stateMachineRulesHash === round.stateMachineRulesHash &&
        transition.calculatorVersion === round.calculatorVersion &&
        transition.rulesVersion === round.rulesVersion &&
        transition.rulesHash === round.rulesHash,
    );
  const first = round.transitions[0];
  const last = round.transitions.at(-1);
  if (
    !transitionsValid ||
    first?.kind !== DatabaseCrashTransitionKind.ROUND_STARTED ||
    first.fromStatus !== null ||
    first.fromStage !== null ||
    last?.toStatus !== round.status ||
    last.toStage !== round.stage ||
    (terminal
      ? round.decisionDeadline !== null ||
        round.terminalAt === null ||
        round.terminalReason === null
      : round.decisionDeadline === null ||
        round.terminalAt !== null ||
        round.terminalReason !== null)
  ) {
    throw stateError('DISABLED', 'Crash durable transition ledger is inconsistent');
  }
}

function toStatus(status: DatabaseCrashRoundStatus): CrashRoundSnapshot['status'] {
  switch (status) {
    case DatabaseCrashRoundStatus.ACTIVE:
      return 'active';
    case DatabaseCrashRoundStatus.BUSTED:
      return 'busted';
    case DatabaseCrashRoundStatus.CASHED_OUT:
      return 'cashed-out';
    case DatabaseCrashRoundStatus.COMPLETED:
      return 'completed';
    case DatabaseCrashRoundStatus.DEFAULTED:
      return 'defaulted';
  }
}

function toDecision(
  decision: DatabaseCrashDecision,
): NonNullable<CrashTransitionSnapshot['decision']> {
  switch (decision) {
    case DatabaseCrashDecision.CASH_OUT:
      return 'cash-out';
    case DatabaseCrashDecision.CONTINUE:
      return 'continue';
    case DatabaseCrashDecision.FORFEIT:
      return 'forfeit';
  }
}

function toKind(kind: DatabaseCrashTransitionKind): CrashTransitionSnapshot['kind'] {
  switch (kind) {
    case DatabaseCrashTransitionKind.BUSTED:
      return 'busted';
    case DatabaseCrashTransitionKind.CASHED_OUT:
      return 'cashed-out';
    case DatabaseCrashTransitionKind.COMPLETED:
      return 'completed';
    case DatabaseCrashTransitionKind.DEADLINE_DEFAULTED:
      return 'deadline-defaulted';
    case DatabaseCrashTransitionKind.ROUND_STARTED:
      return 'round-started';
    case DatabaseCrashTransitionKind.STAGE_CONTINUED:
      return 'stage-continued';
  }
}

function requirePayment(
  value: CrashPaymentFixture,
  rules: CrashCalculatorRuleSet,
): CrashPaymentFixture {
  if (
    value?.schemaVersion !== CRASH_PAYMENT_FIXTURE_VERSION ||
    value.status !== 'fixture-confirmed'
  ) {
    throw stateError('INVALID_EVIDENCE', 'Crash payment fixture is invalid');
  }
  requireExactEvidenceKeys(value, PAYMENT_FIXTURE_KEYS, 'payment');
  requireIdentifier(value.reference, 'payment reference');
  return Object.freeze({
    amount: requireMoney(value.amount, rules, 'payment amount'),
    reference: value.reference,
    schemaVersion: CRASH_PAYMENT_FIXTURE_VERSION,
    status: 'fixture-confirmed',
  });
}

function requireProviderOutcome(
  value: CrashProviderOutcomeFixture,
  rules: CrashCalculatorRuleSet,
  expectedStage: number,
): CrashProviderOutcomeFixture {
  if (
    value?.schemaVersion !== CRASH_PROVIDER_FIXTURE_VERSION ||
    !HASH_PATTERN.test(value.resultHash) ||
    value.stage !== expectedStage ||
    !Number.isInteger(value.rollPpm) ||
    value.rollPpm < 0 ||
    value.rollPpm >= 1_000_000
  ) {
    throw stateError('INVALID_EVIDENCE', 'Crash provider outcome fixture is invalid');
  }
  requireExactEvidenceKeys(value, PROVIDER_OUTCOME_FIXTURE_KEYS, 'provider outcome');
  requireIdentifier(value.reference, 'provider reference');
  return Object.freeze({
    reference: value.reference,
    resultHash: value.resultHash,
    rollPpm: value.rollPpm,
    schemaVersion: CRASH_PROVIDER_FIXTURE_VERSION,
    stage: value.stage,
    stageValue: requireMoney(value.stageValue, rules, 'provider stage value'),
  });
}

function requireCustody(value: CrashCustodyFixture): CrashCustodyFixture {
  if (value?.schemaVersion !== CRASH_CUSTODY_FIXTURE_VERSION) {
    throw stateError('INVALID_EVIDENCE', 'Crash custody fixture is invalid');
  }
  requireExactEvidenceKeys(value, CUSTODY_FIXTURE_KEYS, 'custody');
  requireIdentifier(value.reference, 'custody reference');
  requireIdentifier(value.assetReference, 'asset reference');
  return Object.freeze({
    assetReference: value.assetReference,
    reference: value.reference,
    schemaVersion: CRASH_CUSTODY_FIXTURE_VERSION,
  });
}

function requireSettlement(
  value: CrashSettlementFixture,
  rules: CrashCalculatorRuleSet,
): CrashSettlementFixture {
  if (
    value?.schemaVersion !== CRASH_SETTLEMENT_FIXTURE_VERSION ||
    value.status !== 'fixture-recorded' ||
    !HASH_PATTERN.test(value.resultHash)
  ) {
    throw stateError('INVALID_EVIDENCE', 'Crash settlement fixture is invalid');
  }
  requireExactEvidenceKeys(value, SETTLEMENT_FIXTURE_KEYS, 'settlement');
  requireIdentifier(value.reference, 'settlement reference');
  return Object.freeze({
    payout: requireMoney(value.payout, rules, 'settlement payout'),
    reference: value.reference,
    resultHash: value.resultHash,
    schemaVersion: CRASH_SETTLEMENT_FIXTURE_VERSION,
    status: 'fixture-recorded',
  });
}

function requireExactEvidenceKeys(
  value: object,
  expectedKeys: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  const expected = new Set(expectedKeys);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expected.has(key))) {
    throw stateError('INVALID_EVIDENCE', `Crash ${label} fixture has unsupported fields`);
  }
}

function requireTerminalSettlement(
  value: CrashSettlementFixture | null,
  payout: Money,
  phase: string,
): asserts value is CrashSettlementFixture {
  if (!value || value.payout.amount !== payout.amount) {
    throw stateError(
      'INVALID_EVIDENCE',
      `Crash ${phase} settlement must record the exact terminal payout`,
    );
  }
}

function requireMoney(value: unknown, rules: CrashCalculatorRuleSet, label: string): Money {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as Partial<Money>).currency !== rules.currency ||
    (value as Partial<Money>).decimals !== rules.decimals ||
    typeof (value as Partial<Money>).amount !== 'string' ||
    !/^(0|[1-9]\d*)$/.test((value as Money).amount) ||
    BigInt((value as Money).amount) > MAX_U64
  ) {
    throw stateError('INVALID_EVIDENCE', `Crash ${label} is invalid`);
  }
  return Object.freeze({
    amount: (value as Money).amount,
    currency: rules.currency,
    decimals: rules.decimals,
  });
}

function money(amount: string): Money {
  return { amount, currency: 'USDC', decimals: 6 };
}

function zeroMoney(): Money {
  return money('0');
}

function moneyJson(before: Money, after: Money, change: Money): Prisma.InputJsonValue {
  return { after, before, change } as unknown as Prisma.InputJsonValue;
}

function defaultSettlementJson(roundId: string, stage: number): Prisma.InputJsonValue {
  const reference = `fixture-default:${roundId}:${stage}`;
  return {
    payout: zeroMoney(),
    reference,
    resultHash: sha256(reference),
    schemaVersion: CRASH_SETTLEMENT_FIXTURE_VERSION,
    status: 'fixture-recorded',
  } as unknown as Prisma.InputJsonValue;
}

function storedMoney(amount: string, currency: string, decimals: number): Money {
  if (
    currency !== 'USDC' ||
    decimals !== 6 ||
    !/^(0|[1-9]\d*)$/.test(amount) ||
    BigInt(amount) > MAX_U64
  ) {
    throw stateError('INVALID_EVIDENCE', 'Stored Crash pot is not canonical USDC');
  }
  return { amount, currency, decimals };
}

function requireIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw stateError('INVALID_EVIDENCE', `Crash ${label} is invalid`);
  }
}

function stateError(code: CrashStateMachineErrorCode, message: string): CrashStateMachineError {
  return new CrashStateMachineError(code, message);
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
