import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import type { Money } from '../domain.js';
import { stableStringify } from '../providers/valuation-policy.js';
import { calculateCrashBust, calculateCrashPot } from './crash-calculators.js';
// biome-ignore lint/style/useImportType: Nest uses the custody service class as a runtime injection token.
import { CrashCustodyMovementService } from './crash-custody-movement.service.js';
import type { CrashRiskHealthFixture } from './crash-risk.policy.js';
// biome-ignore lint/style/useImportType: Nest uses the state service class as a runtime injection token.
import {
  assertCrashRoundRuleBinding,
  CRASH_CUSTODY_FIXTURE_VERSION,
  CRASH_PAYMENT_FIXTURE_VERSION,
  CRASH_PROVIDER_FIXTURE_VERSION,
  CRASH_SETTLEMENT_FIXTURE_VERSION,
  type CrashFixtureDecision,
  type CrashRoundSnapshot,
  CrashStageStateService,
  CrashStateMachineError,
  type CrashStateRules,
  validateCrashStateRules,
} from './crash-stage-state.js';

export const CRASH_DECISION_RULES = Symbol('CRASH_DECISION_RULES');
export const CRASH_RISK_HEALTH = Symbol('CRASH_RISK_HEALTH');
export const CRASH_PLAYER_DECISION_SCHEMA_VERSION = 'dailydraft.crash-player-decision.v1' as const;
export const CRASH_PLAYER_FIXTURE_VERSION = 'dailydraft.crash-player-fixture.v1' as const;
const CRASH_CUSTODY_IDEMPOTENCY_DOMAIN = 'dailydraft.crash-custody-idempotency.v1';

export interface CrashPlayerDecisionInput {
  action: 'cash-out' | 'continue';
  expectedStage: number;
  expectedVersion: number;
  idempotencyKey: string;
  playerWallet: string;
  roundId: string;
}

export interface CrashCurrentStage {
  availableActions: readonly ('cash-out' | 'continue')[];
  decisionDeadline: string | null;
  defaultAction: 'forfeit';
  mode: 'fixture-preview';
  network: 'solana-devnet';
  pot: Money;
  roundId: string;
  schemaVersion: typeof CRASH_PLAYER_DECISION_SCHEMA_VERSION;
  stage: number;
  status: CrashRoundSnapshot['status'];
  terminalReason: string | null;
  version: number;
}

@Injectable()
export class CrashDecisionService {
  constructor(
    private readonly state: CrashStageStateService,
    @Inject(CRASH_DECISION_RULES) private readonly configuredRules: unknown,
    private readonly custody: CrashCustodyMovementService,
    @Inject(CRASH_RISK_HEALTH) private readonly configuredRiskHealth: unknown = null,
  ) {}

  async currentStage(roundId: string, playerWallet: string): Promise<CrashCurrentStage> {
    const rules = this.requireRules();
    const found = await this.state.findRound(roundId);
    assertRoundPlayer(found, playerWallet);
    assertCrashRoundRuleBinding(found, rules);
    const current = await this.state.resumeFixtureRound(roundId);
    assertRoundPlayer(current, playerWallet);
    assertCrashRoundRuleBinding(current, rules);
    return toCurrentStage(current);
  }

  async decide(input: CrashPlayerDecisionInput): Promise<CrashCurrentStage> {
    const rules = this.requireRules();
    const found = await this.state.findRound(input.roundId);
    assertRoundPlayer(found, input.playerWallet);
    assertCrashRoundRuleBinding(found, rules);
    let current = await this.state.resumeFixtureRound(input.roundId);
    assertRoundPlayer(current, input.playerWallet);
    assertCrashRoundRuleBinding(current, rules);

    const replay = findPlayerReplay(current, input);
    if (replay) return toCurrentStage(current);
    if (current.status === 'defaulted') return toCurrentStage(current);
    assertCurrentDecision(current, input);

    const custodyReference =
      input.action === 'continue'
        ? await this.prepareCustodyMovement(current, rules, input)
        : undefined;
    const decision = createFixtureDecision(
      current,
      rules,
      this.configuredRiskHealth,
      input,
      custodyReference,
    );
    try {
      current = await this.state.decide(input.roundId, rules, decision);
    } catch (error) {
      if (
        !(error instanceof CrashStateMachineError) ||
        (error.code !== 'CONCURRENT_TRANSITION' && error.code !== 'DEADLINE_EXPIRED')
      ) {
        throw error;
      }
      current = await this.state.resumeFixtureRound(input.roundId);
      assertRoundPlayer(current, input.playerWallet);
      assertCrashRoundRuleBinding(current, rules);
      if (!findPlayerReplay(current, input) && current.status !== 'defaulted') {
        throw new CrashStateMachineError(
          'INVALID_TRANSITION',
          'Crash decision is stale because another transition won the stage',
        );
      }
    }
    return toCurrentStage(current);
  }

  private requireRules(): CrashStateRules {
    try {
      return validateCrashStateRules(this.configuredRules);
    } catch {
      throw new CrashStateMachineError(
        'DISABLED',
        'Crash player decisions require approved fixture-preview rules',
      );
    }
  }

  private async prepareCustodyMovement(
    current: CrashRoundSnapshot,
    rules: CrashStateRules,
    input: CrashPlayerDecisionInput,
  ): Promise<string> {
    const assetReference = fixtureReference('asset', input.roundId, input.expectedStage);
    const intent = await this.custody.prepareFixtureMovement({
      assetReference,
      expectedStage: input.expectedStage,
      expectedVersion: input.expectedVersion,
      idempotencyKey: deriveCustodyIdempotencyKey(input),
      playerWalletReference: current.playerWalletReference,
      requestedRecipient: this.custody.configuredRecipient(),
      roundId: input.roundId,
      rules,
      sourceWalletReference: fixtureProviderWallet(input.roundId, input.expectedStage),
    });
    if (intent.status !== 'prepared') {
      throw new CrashStateMachineError(
        'INVALID_EVIDENCE',
        `Crash custody stopped before signing: ${intent.recoveryReason ?? 'RECOVERY_REQUIRED'}`,
      );
    }
    await this.custody.requirePreparedFixture(input.roundId, intent.id, assetReference);
    return intent.id;
  }
}

export function loadCrashDecisionRules(environment: NodeJS.ProcessEnv = process.env): unknown {
  const serialized = environment.DAILYDRAFT_CRASH_FIXTURE_RULES_JSON;
  if (!serialized) return null;
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
}

export function loadCrashRiskHealth(environment: NodeJS.ProcessEnv = process.env): unknown {
  const serialized = environment.DAILYDRAFT_CRASH_FIXTURE_RISK_HEALTH_JSON;
  if (!serialized) return null;
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
}

function createFixtureDecision(
  current: CrashRoundSnapshot,
  rules: CrashStateRules,
  riskHealth: unknown,
  input: CrashPlayerDecisionInput,
  custodyReference?: string,
): CrashFixtureDecision {
  const transitionKey = `player:${sha256(input.idempotencyKey)}`;
  if (input.action === 'cash-out') {
    return {
      decision: 'cash-out',
      expectedStage: input.expectedStage,
      expectedVersion: input.expectedVersion,
      settlement: settlementFixture(input.roundId, input.expectedStage, current.pot),
      transitionKey,
    };
  }

  const stageValue = money('1000000');
  const rollPpm = deterministicRoll(input.roundId, input.expectedStage);
  const bust = calculateCrashBust(rules.calculatorRules, {
    rollPpm,
    stage: input.expectedStage,
  });
  const pot = calculateCrashPot(rules.calculatorRules, {
    currentPot: current.pot,
    stage: input.expectedStage,
    stageValue,
  });
  const terminal = bust.busted || input.expectedStage === rules.calculatorRules.stages.length;
  const resultReference = fixtureReference('provider', input.roundId, input.expectedStage);

  return {
    custody: {
      assetReference: fixtureReference('asset', input.roundId, input.expectedStage),
      reference:
        custodyReference ??
        fixtureReference('custody-unavailable', input.roundId, input.expectedStage),
      schemaVersion: CRASH_CUSTODY_FIXTURE_VERSION,
    },
    decision: 'continue',
    expectedStage: input.expectedStage,
    expectedVersion: input.expectedVersion,
    payment: {
      amount: stageValue,
      reference: fixtureReference('payment', input.roundId, input.expectedStage),
      schemaVersion: CRASH_PAYMENT_FIXTURE_VERSION,
      status: 'fixture-confirmed',
    },
    providerOutcome: {
      reference: resultReference,
      resultHash: sha256(resultReference),
      rollPpm,
      schemaVersion: CRASH_PROVIDER_FIXTURE_VERSION,
      stage: input.expectedStage,
      stageValue,
    },
    riskHealth: riskHealth as CrashRiskHealthFixture,
    ...(terminal
      ? {
          settlement: settlementFixture(
            input.roundId,
            input.expectedStage,
            bust.busted ? money('0') : pot.nextPot,
          ),
        }
      : {}),
    transitionKey,
  };
}

function findPlayerReplay(round: CrashRoundSnapshot, input: CrashPlayerDecisionInput): boolean {
  const transitionKey = `player:${sha256(input.idempotencyKey)}`;
  const transition = round.transitions.find(
    (candidate) => candidate.transitionKey === transitionKey,
  );
  if (!transition) return false;
  if (
    transition.decision !== input.action ||
    transition.fromStage !== input.expectedStage ||
    transition.sequence !== input.expectedVersion + 1
  ) {
    throw new CrashStateMachineError(
      'IDEMPOTENCY_MISMATCH',
      'Crash Idempotency-Key was reused for a different player decision',
    );
  }
  return true;
}

function assertCurrentDecision(current: CrashRoundSnapshot, input: CrashPlayerDecisionInput): void {
  if (
    current.status !== 'active' ||
    current.stage !== input.expectedStage ||
    current.version !== input.expectedVersion
  ) {
    throw new CrashStateMachineError(
      'INVALID_TRANSITION',
      'Crash decision does not match the canonical stage and version',
    );
  }
}

function assertRoundPlayer(round: CrashRoundSnapshot, playerWallet: string): void {
  if (round.playerWalletReference !== `fixture-wallet:${playerWallet}`) {
    throw new CrashStateMachineError('NOT_FOUND', `Crash round ${round.id} was not found`);
  }
}

function toCurrentStage(round: CrashRoundSnapshot): CrashCurrentStage {
  return {
    availableActions: round.status === 'active' ? ['continue', 'cash-out'] : [],
    decisionDeadline: round.decisionDeadline,
    defaultAction: round.defaultAction,
    mode: 'fixture-preview',
    network: 'solana-devnet',
    pot: round.pot,
    roundId: round.id,
    schemaVersion: CRASH_PLAYER_DECISION_SCHEMA_VERSION,
    stage: round.stage,
    status: round.status,
    terminalReason: round.terminalReason,
    version: round.version,
  };
}

function deterministicRoll(roundId: string, stage: number): number {
  const digest = sha256(`${CRASH_PLAYER_FIXTURE_VERSION}:${roundId}:${stage}`);
  return Number(BigInt(`0x${digest.slice(0, 12)}`) % 1_000_000n);
}

function fixtureReference(kind: string, roundId: string, stage: number): string {
  return `fixture-${kind}:${sha256(`${roundId}:${stage}`).slice(0, 32)}`;
}

function fixtureProviderWallet(roundId: string, stage: number): string {
  return `fixture-wallet:provider-${sha256(`${roundId}:${stage}`).slice(0, 24)}`;
}

function deriveCustodyIdempotencyKey(input: CrashPlayerDecisionInput): string {
  return `custody:${sha256(
    stableStringify({
      domain: CRASH_CUSTODY_IDEMPOTENCY_DOMAIN,
      expectedStage: input.expectedStage,
      expectedVersion: input.expectedVersion,
      publicIdempotencyKey: input.idempotencyKey,
      roundId: input.roundId,
    }),
  )}`;
}

function settlementFixture(roundId: string, stage: number, payout: Money) {
  const reference = fixtureReference('settlement', roundId, stage);
  return {
    payout,
    reference,
    resultHash: sha256(`${reference}:${payout.amount}`),
    schemaVersion: CRASH_SETTLEMENT_FIXTURE_VERSION,
    status: 'fixture-recorded' as const,
  };
}

function money(amount: string): Money {
  return { amount, currency: 'USDC', decimals: 6 };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
