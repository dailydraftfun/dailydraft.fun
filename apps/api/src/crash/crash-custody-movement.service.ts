import { createHash } from 'node:crypto';
import {
  type DatabaseClient,
  CrashCustodyIntentStatus as DatabaseCrashCustodyIntentStatus,
  type Prisma,
} from '@dailydraft/db';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  CRASH_ENVIRONMENT,
  CrashStateMachineError,
  type CrashStateRules,
  crashStateFixtureModeEnabled,
  validateCrashStateRules,
} from './crash-stage-state.js';

export const CRASH_CUSTODY_POLICY = Symbol('CRASH_CUSTODY_POLICY');
export const CRASH_CUSTODY_POLICY_SCHEMA_VERSION = 'dailydraft.crash-custody-policy.v1' as const;
export const CRASH_CUSTODY_INTENT_SCHEMA_VERSION = 'dailydraft.crash-custody-intent.v1' as const;
const CRASH_CUSTODY_INTENT_ID_DOMAIN = 'dailydraft.crash-custody-intent-id.v1';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FIXTURE_WALLET_PATTERN = /^fixture-wallet:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const POLICY_KEYS = [
  'activation',
  'approvedSessionCustody',
  'architectureVersion',
  'calculatorVersion',
  'network',
  'policyHash',
  'policyVersion',
  'rulesHash',
  'rulesVersion',
  'schemaVersion',
  'stateMachineRulesHash',
  'stateMachineVersion',
] as const;

export type CrashCustodyRecoveryReason =
  | 'CANONICAL_STAGE_MISMATCH'
  | 'CUSTODY_POLICY_ABSENT'
  | 'CUSTODY_POLICY_AMBIGUOUS'
  | 'CUSTODY_POLICY_INVALID'
  | 'POLICY_BINDING_MISMATCH'
  | 'RECIPIENT_MISMATCH'
  | 'RULE_BINDING_MISMATCH'
  | 'SOURCE_CUSTODY_INVALID'
  | 'WALLET_OWNERSHIP_MISMATCH';

export interface UnsignedCrashCustodyPolicy {
  activation: 'fixture-only';
  approvedSessionCustody: string;
  architectureVersion: string;
  calculatorVersion: string;
  network: 'solana-devnet';
  policyVersion: string;
  rulesHash: string;
  rulesVersion: string;
  schemaVersion: typeof CRASH_CUSTODY_POLICY_SCHEMA_VERSION;
  stateMachineRulesHash: string;
  stateMachineVersion: string;
}

export interface CrashCustodyPolicy extends UnsignedCrashCustodyPolicy {
  policyHash: string;
}

export interface PrepareCrashCustodyMovement {
  assetReference: string;
  expectedStage: number;
  expectedVersion: number;
  idempotencyKey: string;
  playerWalletReference: string;
  requestedRecipient: string | null;
  roundId: string;
  rules: CrashStateRules;
  sourceWalletReference: string;
}

export interface CrashCustodyMovementIntent {
  approvedRecipient: string | null;
  assetReference: string;
  id: string;
  idempotencyKey: string;
  network: 'solana-devnet';
  playerWalletReference: string;
  policyHash: string | null;
  policyVersion: string | null;
  recoveryReason: CrashCustodyRecoveryReason | null;
  requestedRecipient: string;
  roundId: string;
  schemaVersion: typeof CRASH_CUSTODY_INTENT_SCHEMA_VERSION;
  signingStatus: 'not-started';
  sourceWalletReference: string;
  stage: number;
  status: 'prepared' | 'recovery-required';
}

type RoundRecord = NonNullable<Awaited<ReturnType<DatabaseClient['crashRound']['findUnique']>>>;
type IntentRecord = NonNullable<
  Awaited<ReturnType<DatabaseClient['crashCustodyMovementIntent']['findUnique']>>
>;

@Injectable()
export class CrashCustodyMovementService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    @Inject(CRASH_CUSTODY_POLICY) private readonly configuredPolicy: unknown,
    @Inject(CRASH_ENVIRONMENT) private readonly environment: NodeJS.ProcessEnv,
  ) {}

  configuredRecipient(): string | null {
    if (!crashStateFixtureModeEnabled(this.environment)) return null;
    const resolution = resolvePolicy(this.configuredPolicy);
    return resolution.kind === 'approved' ? resolution.policy.approvedSessionCustody : null;
  }

  async prepareFixtureMovement(
    input: PrepareCrashCustodyMovement,
    transaction?: Prisma.TransactionClient,
  ): Promise<CrashCustodyMovementIntent> {
    if (!crashStateFixtureModeEnabled(this.environment)) {
      throw new CrashStateMachineError(
        'DISABLED',
        'Crash custody movement is available only in explicit non-production fixture mode',
      );
    }
    const normalized = normalizeInput(input);
    const policyResolution = resolvePolicy(this.configuredPolicy);
    const policyFingerprint = sha256(stableStringify(this.configuredPolicy ?? null));
    const requestHash = sha256(
      stableStringify({
        ...normalized,
        policyFingerprint,
        rules: ruleBinding(normalized.rules),
      }),
    );

    const prepare = async (activeTransaction: Prisma.TransactionClient) => {
      const existing = await activeTransaction.crashCustodyMovementIntent.findUnique({
        where: {
          roundId_idempotencyKey: {
            idempotencyKey: normalized.idempotencyKey,
            roundId: normalized.roundId,
          },
        },
      });
      if (existing) {
        assertReplay(existing, requestHash);
        return existing;
      }

      const round = await activeTransaction.crashRound.findUnique({
        where: { id: normalized.roundId },
      });
      if (!round) {
        throw new CrashStateMachineError(
          'NOT_FOUND',
          `Crash round ${normalized.roundId} was not found`,
        );
      }
      const resolution = resolveMovement(round, normalized, policyResolution);
      if (resolution.status === DatabaseCrashCustodyIntentStatus.PREPARED) {
        const duplicate = await activeTransaction.crashCustodyMovementIntent.findFirst({
          where: {
            assetReference: normalized.assetReference,
            roundId: normalized.roundId,
            stage: normalized.expectedStage,
            status: DatabaseCrashCustodyIntentStatus.PREPARED,
          },
        });
        if (duplicate) {
          throw new CrashStateMachineError(
            'CONCURRENT_TRANSITION',
            'Crash custody movement was already prepared under another idempotency boundary',
          );
        }
      }

      return activeTransaction.crashCustodyMovementIntent.create({
        data: {
          activationMode: 'fixture-only',
          approvedRecipient: resolution.approvedRecipient,
          architectureVersion: normalized.rules.architectureVersion,
          assetReference: normalized.assetReference,
          calculatorVersion: normalized.rules.calculatorRules.calculatorVersion,
          expectedVersion: normalized.expectedVersion,
          id: crashCustodyIntentReference(normalized.roundId, normalized.idempotencyKey),
          idempotencyKey: normalized.idempotencyKey,
          network: 'solana-devnet',
          playerWalletReference: normalized.playerWalletReference,
          policyHash: resolution.policy?.policyHash ?? null,
          policyVersion: resolution.policy?.policyVersion ?? null,
          recoveryReason: resolution.recoveryReason,
          requestHash,
          requestedRecipient: normalized.requestedRecipient,
          roundId: normalized.roundId,
          rulesHash: normalized.rules.calculatorRules.rulesHash,
          rulesVersion: normalized.rules.calculatorRules.rulesVersion,
          sourceWalletReference: normalized.sourceWalletReference,
          stage: normalized.expectedStage,
          stateMachineRulesHash: normalized.rules.stateMachineRulesHash,
          stateMachineVersion: normalized.rules.stateMachineVersion,
          status: resolution.status,
        },
      });
    };

    if (transaction) {
      return toIntent(await prepare(transaction));
    }

    const replay = await this.findIdempotentReplay(
      normalized.roundId,
      normalized.idempotencyKey,
      requestHash,
    );
    if (replay) return replay;

    try {
      const created = await this.database.$transaction(prepare, { isolationLevel: 'Serializable' });
      return toIntent(created);
    } catch (error) {
      const concurrentReplay = await this.findIdempotentReplay(
        normalized.roundId,
        normalized.idempotencyKey,
        requestHash,
      );
      if (concurrentReplay) return concurrentReplay;
      const prepared = await this.database.crashCustodyMovementIntent.findFirst({
        where: {
          assetReference: normalized.assetReference,
          roundId: normalized.roundId,
          stage: normalized.expectedStage,
          status: DatabaseCrashCustodyIntentStatus.PREPARED,
        },
      });
      if (prepared) {
        throw new CrashStateMachineError(
          'CONCURRENT_TRANSITION',
          'Crash custody movement was already prepared under another idempotency boundary',
        );
      }
      throw error;
    }
  }

  async requirePreparedFixture(
    roundId: string,
    intentId: string,
    assetReference: string,
  ): Promise<CrashCustodyMovementIntent> {
    if (!crashStateFixtureModeEnabled(this.environment)) {
      throw new CrashStateMachineError(
        'DISABLED',
        'Crash custody movement is available only in explicit non-production fixture mode',
      );
    }
    requireIdentifier(roundId, 'roundId');
    requireIdentifier(intentId, 'intentId');
    requireIdentifier(assetReference, 'assetReference');
    const policyResolution = resolvePolicy(this.configuredPolicy);
    const { intent, round } = await this.database.$transaction(async (transaction) => {
      const [intent, round] = await Promise.all([
        transaction.crashCustodyMovementIntent.findUnique({ where: { id: intentId } }),
        transaction.crashRound.findUnique({ where: { id: roundId } }),
      ]);
      return { intent, round };
    });
    if (
      !intent ||
      !round ||
      intent.roundId !== roundId ||
      intent.assetReference !== assetReference ||
      intent.status !== DatabaseCrashCustodyIntentStatus.PREPARED ||
      intent.signingStatus !== 'NOT_STARTED' ||
      round.activationMode !== 'fixture-only' ||
      round.status !== 'ACTIVE' ||
      round.stage !== intent.stage ||
      round.version !== intent.expectedVersion ||
      round.playerWalletReference !== intent.playerWalletReference ||
      round.architectureVersion !== intent.architectureVersion ||
      round.stateMachineVersion !== intent.stateMachineVersion ||
      round.stateMachineRulesHash !== intent.stateMachineRulesHash ||
      round.calculatorVersion !== intent.calculatorVersion ||
      round.rulesVersion !== intent.rulesVersion ||
      round.rulesHash !== intent.rulesHash ||
      policyResolution.kind !== 'approved' ||
      policyResolution.policy.policyHash !== intent.policyHash ||
      policyResolution.policy.approvedSessionCustody !== intent.approvedRecipient
    ) {
      throw new CrashStateMachineError(
        'INVALID_EVIDENCE',
        'Crash custody evidence is not an approved non-signable movement intent',
      );
    }
    return toIntent(intent);
  }

  private async findIdempotentReplay(
    roundId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CrashCustodyMovementIntent | null> {
    const existing = await this.database.crashCustodyMovementIntent.findUnique({
      where: { roundId_idempotencyKey: { idempotencyKey, roundId } },
    });
    return existing ? assertReplay(existing, requestHash) : null;
  }
}

export function crashCustodyIntentReference(roundId: string, idempotencyKey: string): string {
  return `crashcustody_${sha256(
    stableStringify({
      domain: CRASH_CUSTODY_INTENT_ID_DOMAIN,
      idempotencyKey,
      roundId,
    }),
  )}`;
}

export function hashCrashCustodyPolicy(policy: UnsignedCrashCustodyPolicy): string {
  return sha256(stableStringify(policy));
}

export function loadCrashCustodyPolicy(environment: NodeJS.ProcessEnv = process.env): unknown {
  const serialized = environment.DAILYDRAFT_CRASH_FIXTURE_CUSTODY_POLICY_JSON;
  if (!serialized) return null;
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
}

function resolveMovement(
  round: RoundRecord,
  input: ReturnType<typeof normalizeInput>,
  policyResolution: PolicyResolution,
): {
  approvedRecipient: string | null;
  policy: CrashCustodyPolicy | null;
  recoveryReason: CrashCustodyRecoveryReason | null;
  status: DatabaseCrashCustodyIntentStatus;
} {
  const recovery = (
    reason: CrashCustodyRecoveryReason,
    policy: CrashCustodyPolicy | null = null,
  ) => ({
    approvedRecipient: policy?.approvedSessionCustody ?? null,
    policy,
    recoveryReason: reason,
    status: DatabaseCrashCustodyIntentStatus.RECOVERY_REQUIRED,
  });

  if (
    round.activationMode !== 'fixture-only' ||
    round.status !== 'ACTIVE' ||
    round.stage !== input.expectedStage ||
    round.version !== input.expectedVersion
  ) {
    return recovery('CANONICAL_STAGE_MISMATCH');
  }
  if (round.playerWalletReference !== input.playerWalletReference) {
    return recovery('WALLET_OWNERSHIP_MISMATCH');
  }
  if (!roundMatchesRules(round, input.rules)) {
    return recovery('RULE_BINDING_MISMATCH');
  }
  if (policyResolution.kind !== 'approved') {
    return recovery(policyResolution.reason);
  }
  const policy = policyResolution.policy;
  if (!roundMatchesPolicy(round, policy)) {
    return recovery('POLICY_BINDING_MISMATCH', policy);
  }
  if (input.requestedRecipient !== policy.approvedSessionCustody) {
    return recovery('RECIPIENT_MISMATCH', policy);
  }
  if (
    !FIXTURE_WALLET_PATTERN.test(input.sourceWalletReference) ||
    input.sourceWalletReference === policy.approvedSessionCustody
  ) {
    return recovery('SOURCE_CUSTODY_INVALID', policy);
  }
  return {
    approvedRecipient: policy.approvedSessionCustody,
    policy,
    recoveryReason: null,
    status: DatabaseCrashCustodyIntentStatus.PREPARED,
  };
}

type PolicyResolution =
  | { kind: 'approved'; policy: CrashCustodyPolicy }
  | {
      kind: 'recovery';
      reason: 'CUSTODY_POLICY_ABSENT' | 'CUSTODY_POLICY_AMBIGUOUS' | 'CUSTODY_POLICY_INVALID';
    };

function resolvePolicy(value: unknown): PolicyResolution {
  if (value === null || value === undefined) {
    return { kind: 'recovery', reason: 'CUSTODY_POLICY_ABSENT' };
  }
  const candidates = Array.isArray(value) ? value : [value];
  if (candidates.length !== 1) {
    return { kind: 'recovery', reason: 'CUSTODY_POLICY_AMBIGUOUS' };
  }
  try {
    return { kind: 'approved', policy: validatePolicy(candidates[0]) };
  } catch {
    return { kind: 'recovery', reason: 'CUSTODY_POLICY_INVALID' };
  }
}

function validatePolicy(value: unknown): CrashCustodyPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid policy');
  }
  const keys = Object.keys(value).sort();
  if (stableStringify(keys) !== stableStringify([...POLICY_KEYS].sort())) {
    throw new Error('invalid policy shape');
  }
  const policy = value as Partial<CrashCustodyPolicy>;
  if (
    policy.activation !== 'fixture-only' ||
    policy.network !== 'solana-devnet' ||
    policy.schemaVersion !== CRASH_CUSTODY_POLICY_SCHEMA_VERSION ||
    !validIdentifier(policy.policyVersion) ||
    !validIdentifier(policy.architectureVersion) ||
    !validIdentifier(policy.stateMachineVersion) ||
    !validIdentifier(policy.calculatorVersion) ||
    !validIdentifier(policy.rulesVersion) ||
    !validHash(policy.stateMachineRulesHash) ||
    !validHash(policy.rulesHash) ||
    !validHash(policy.policyHash) ||
    typeof policy.approvedSessionCustody !== 'string' ||
    !FIXTURE_WALLET_PATTERN.test(policy.approvedSessionCustody)
  ) {
    throw new Error('invalid policy values');
  }
  const unsigned: UnsignedCrashCustodyPolicy = {
    activation: 'fixture-only',
    approvedSessionCustody: policy.approvedSessionCustody,
    architectureVersion: policy.architectureVersion,
    calculatorVersion: policy.calculatorVersion,
    network: 'solana-devnet',
    policyVersion: policy.policyVersion,
    rulesHash: policy.rulesHash,
    rulesVersion: policy.rulesVersion,
    schemaVersion: CRASH_CUSTODY_POLICY_SCHEMA_VERSION,
    stateMachineRulesHash: policy.stateMachineRulesHash,
    stateMachineVersion: policy.stateMachineVersion,
  };
  if (hashCrashCustodyPolicy(unsigned) !== policy.policyHash) {
    throw new Error('policy hash mismatch');
  }
  return Object.freeze({ ...unsigned, policyHash: policy.policyHash });
}

function normalizeInput(input: PrepareCrashCustodyMovement) {
  requireIdentifier(input.roundId, 'roundId');
  requireIdentifier(input.idempotencyKey, 'idempotencyKey');
  requireIdentifier(input.assetReference, 'assetReference');
  requireIdentifier(input.sourceWalletReference, 'sourceWalletReference');
  if (
    !Number.isInteger(input.expectedStage) ||
    input.expectedStage < 1 ||
    input.expectedStage > 64 ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    throw new CrashStateMachineError(
      'INVALID_EVIDENCE',
      'Crash custody stage or version is invalid',
    );
  }
  if (!FIXTURE_WALLET_PATTERN.test(input.playerWalletReference)) {
    throw new CrashStateMachineError(
      'INVALID_EVIDENCE',
      'Crash custody player must be a synthetic fixture wallet',
    );
  }
  const requestedRecipient =
    typeof input.requestedRecipient === 'string' &&
    FIXTURE_WALLET_PATTERN.test(input.requestedRecipient)
      ? input.requestedRecipient
      : 'fixture-wallet:unresolved-custody';
  return {
    assetReference: input.assetReference,
    expectedStage: input.expectedStage,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    playerWalletReference: input.playerWalletReference,
    requestedRecipient,
    roundId: input.roundId,
    rules: validateCrashStateRules(input.rules),
    sourceWalletReference: input.sourceWalletReference,
  };
}

function assertReplay(row: IntentRecord, requestHash: string): CrashCustodyMovementIntent {
  if (row.requestHash !== requestHash) {
    throw new CrashStateMachineError(
      'IDEMPOTENCY_MISMATCH',
      'Crash custody idempotency key was reused with different movement constraints',
    );
  }
  return toIntent(row);
}

function toIntent(row: IntentRecord): CrashCustodyMovementIntent {
  return {
    approvedRecipient: row.approvedRecipient,
    assetReference: row.assetReference,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    network: 'solana-devnet',
    playerWalletReference: row.playerWalletReference,
    policyHash: row.policyHash,
    policyVersion: row.policyVersion,
    recoveryReason: row.recoveryReason as CrashCustodyRecoveryReason | null,
    requestedRecipient: row.requestedRecipient,
    roundId: row.roundId,
    schemaVersion: CRASH_CUSTODY_INTENT_SCHEMA_VERSION,
    signingStatus: 'not-started',
    sourceWalletReference: row.sourceWalletReference,
    stage: row.stage,
    status:
      row.status === DatabaseCrashCustodyIntentStatus.PREPARED ? 'prepared' : 'recovery-required',
  };
}

function roundMatchesRules(round: RoundRecord, rules: CrashStateRules): boolean {
  return (
    round.architectureVersion === rules.architectureVersion &&
    round.stateMachineVersion === rules.stateMachineVersion &&
    round.stateMachineRulesHash === rules.stateMachineRulesHash &&
    round.calculatorVersion === rules.calculatorRules.calculatorVersion &&
    round.rulesVersion === rules.calculatorRules.rulesVersion &&
    round.rulesHash === rules.calculatorRules.rulesHash
  );
}

function roundMatchesPolicy(round: RoundRecord, policy: CrashCustodyPolicy): boolean {
  return (
    round.architectureVersion === policy.architectureVersion &&
    round.stateMachineVersion === policy.stateMachineVersion &&
    round.stateMachineRulesHash === policy.stateMachineRulesHash &&
    round.calculatorVersion === policy.calculatorVersion &&
    round.rulesVersion === policy.rulesVersion &&
    round.rulesHash === policy.rulesHash
  );
}

function ruleBinding(rules: CrashStateRules) {
  return {
    architectureVersion: rules.architectureVersion,
    calculatorVersion: rules.calculatorRules.calculatorVersion,
    rulesHash: rules.calculatorRules.rulesHash,
    rulesVersion: rules.calculatorRules.rulesVersion,
    stateMachineRulesHash: rules.stateMachineRulesHash,
    stateMachineVersion: rules.stateMachineVersion,
  };
}

function requireIdentifier(value: string, label: string): void {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new CrashStateMachineError('INVALID_EVIDENCE', `Crash custody ${label} is invalid`);
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
