import { createHash } from 'node:crypto';
import {
  HouseTreasuryLedgerType,
  HouseTreasuryReservationSource,
  HouseTreasuryReservationStatus,
  type Prisma,
} from '@dailydraft/db';

import { acquireAdvisoryTransactionLock } from '../database/advisory-lock.js';
import type { Money } from '../domain.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  ACTIVE_HOUSE_RESERVATION_STATUSES,
  evaluateHouseExposureLimits,
  HOUSE_TREASURY_EXPOSURE_LOCK_KEY,
  HOUSE_TREASURY_SNAPSHOT_ID,
  houseTreasuryConfigurationErrors,
  houseTreasurySnapshotIsUsable,
  readHouseTreasuryConfig,
} from '../treasury/house-treasury.policy.js';

export const CRASH_RISK_RULES_SCHEMA_VERSION = 'dailydraft.crash-risk-rules.v1' as const;
export const CRASH_RISK_HEALTH_SCHEMA_VERSION = 'dailydraft.crash-risk-health.v1' as const;
export const CRASH_RISK_POLICY_VERSION = 'dailydraft.crash-risk-policy.v1' as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;
const MAX_EVIDENCE_AGE_MS = 5 * 60 * 1_000;
const MAX_STAGES = 64;
const MAX_U64 = 18_446_744_073_709_551_615n;
const HEALTH_KEYS = [
  'observedAt',
  'poolReference',
  'poolStatus',
  'providerReference',
  'providerStatus',
  'riskRulesHash',
  'schemaVersion',
] as const;

export interface UnsignedCrashRiskRules {
  activation: 'fixture-only';
  currency: 'USDC';
  decimals: 6;
  evidenceMaxAgeMs: number;
  maxDurationMs: number;
  maxPotAmount: string;
  maxStage: number;
  maxTreasuryExposureAmount: string;
  maxWalletExposureAmount: string;
  network: 'solana-devnet';
  policyVersion: typeof CRASH_RISK_POLICY_VERSION;
  poolReference: string;
  providerReference: string;
  rulesVersion: string;
  schemaVersion: typeof CRASH_RISK_RULES_SCHEMA_VERSION;
}

export interface CrashRiskRules extends UnsignedCrashRiskRules {
  riskRulesHash: string;
}

export interface CrashRiskHealthFixture {
  observedAt: string;
  poolReference: string;
  poolStatus: 'healthy';
  providerReference: string;
  providerStatus: 'healthy';
  riskRulesHash: string;
  schemaVersion: typeof CRASH_RISK_HEALTH_SCHEMA_VERSION;
}

export interface CrashRiskRoundBinding {
  id: string;
  playerWalletReference: string;
  riskExpiresAt: Date;
  riskRulesHash: string;
  riskRulesVersion: string;
}

export interface CrashRiskTransitionInput {
  acceptsRisk: boolean;
  health: unknown;
  nextPot: Money;
  nextStage: number;
  round: CrashRiskRoundBinding;
  terminal: boolean;
}

export class CrashRiskPolicyError extends Error {
  constructor(
    readonly reason:
      | 'CONFIGURATION'
      | 'DURATION'
      | 'HEALTH'
      | 'IDEMPOTENCY_MISMATCH'
      | 'POT'
      | 'STAGE'
      | 'TREASURY_EXPOSURE'
      | 'WALLET_EXPOSURE',
    message: string,
  ) {
    super(message);
    this.name = 'CrashRiskPolicyError';
  }
}

export abstract class CrashRiskGate {
  abstract reserveRound(
    transaction: Prisma.TransactionClient,
    input: {
      health: unknown;
      initialPot: Money;
      now: Date;
      round: CrashRiskRoundBinding;
      rules: CrashRiskRules;
    },
  ): Promise<void>;

  abstract applyTransition(
    transaction: Prisma.TransactionClient,
    input: CrashRiskTransitionInput & { now: Date; rules: CrashRiskRules },
  ): Promise<void>;

  abstract releaseTerminal(
    transaction: Prisma.TransactionClient,
    input: {
      now: Date;
      round: CrashRiskRoundBinding;
      stage: number;
    },
  ): Promise<void>;
}

export class CrashRiskPolicyService extends CrashRiskGate {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {
    super();
  }

  async reserveRound(
    transaction: Prisma.TransactionClient,
    input: {
      health: unknown;
      initialPot: Money;
      now: Date;
      round: CrashRiskRoundBinding;
      rules: CrashRiskRules;
    },
  ): Promise<void> {
    const rules = validateCrashRiskRules(input.rules);
    const health = validateCrashRiskHealth(input.health, rules, input.now);
    assertRoundBinding(input.round, rules);
    assertStageAndDuration(rules, 1, input.round.riskExpiresAt, input.now);
    const requested = requireRiskMoney(input.initialPot, rules, 'initial pot');

    await acquireAdvisoryTransactionLock(transaction, HOUSE_TREASURY_EXPOSURE_LOCK_KEY);
    const existing = await transaction.houseTreasuryReservation.findUnique({
      where: { crashRoundId: input.round.id },
    });
    if (existing) {
      assertReservationReplay(existing, input.round, rules, requested);
      return;
    }
    await this.assertCanonicalAdmission(transaction, {
      amountAfter: requested,
      currentAmount: 0n,
      playerWallet: riskWallet(input.round.playerWalletReference),
      rules,
      now: input.now,
    });

    const reservationId = createId('hres');
    await transaction.houseTreasuryReservation.create({
      data: {
        amount: requested.toString(),
        crashRoundId: input.round.id,
        currency: 'USDC',
        decimals: 6,
        id: reservationId,
        playerWallet: riskWallet(input.round.playerWalletReference),
        riskRulesHash: rules.riskRulesHash,
        source: HouseTreasuryReservationSource.CRASH,
        tier: 1,
      },
    });
    await transaction.houseTreasuryLedgerEntry.create({
      data: {
        amount: requested.toString(),
        crashRoundId: input.round.id,
        currency: 'USDC',
        decimals: 6,
        id: createId('hled'),
        idempotencyKey: `crash-reservation-created:${input.round.id}`,
        metadata: {
          health,
          riskRulesHash: rules.riskRulesHash,
          riskRulesVersion: rules.rulesVersion,
          stage: 1,
        } as unknown as Prisma.InputJsonValue,
        reservationId,
        type: HouseTreasuryLedgerType.RESERVATION_CREATED,
      },
    });
  }

  async applyTransition(
    transaction: Prisma.TransactionClient,
    input: CrashRiskTransitionInput & { now: Date; rules: CrashRiskRules },
  ): Promise<void> {
    const rules = validateCrashRiskRules(input.rules);
    assertRoundBinding(input.round, rules);
    const amountAfter = requireRiskMoney(input.nextPot, rules, 'next pot');
    if (input.acceptsRisk) {
      validateCrashRiskHealth(input.health, rules, input.now);
      assertStageAndDuration(rules, input.nextStage, input.round.riskExpiresAt, input.now);
    } else if (input.nextStage > rules.maxStage || amountAfter > BigInt(rules.maxPotAmount)) {
      throw riskError('POT', 'Crash terminal outcome exceeds the committed risk envelope');
    }

    await acquireAdvisoryTransactionLock(transaction, HOUSE_TREASURY_EXPOSURE_LOCK_KEY);
    const reservation = await transaction.houseTreasuryReservation.findUnique({
      where: { crashRoundId: input.round.id },
    });
    if (!reservation) {
      throw riskError('CONFIGURATION', 'Crash exposure reservation is missing');
    }
    assertReservationBinding(reservation, input.round, rules);
    if (
      reservation.status === HouseTreasuryReservationStatus.RELEASED ||
      reservation.status === HouseTreasuryReservationStatus.SETTLED
    ) {
      if (input.terminal) return;
      throw riskError('CONFIGURATION', 'Crash exposure was already released');
    }
    if (!ACTIVE_HOUSE_RESERVATION_STATUSES.includes(reservation.status)) {
      throw riskError('CONFIGURATION', 'Crash exposure reservation has an unsupported state');
    }

    const currentAmount = parseAmount(reservation.amount, 'stored Crash exposure');
    if (input.acceptsRisk) {
      await this.assertCanonicalAdmission(transaction, {
        amountAfter,
        currentAmount,
        playerWallet: riskWallet(input.round.playerWalletReference),
        rules,
        now: input.now,
      });
    }

    if (input.terminal) {
      await this.releaseTerminal(transaction, {
        now: input.now,
        round: input.round,
        stage: input.nextStage,
      });
      return;
    }

    if (amountAfter === currentAmount) return;
    const changed = await transaction.houseTreasuryReservation.updateMany({
      data: {
        amount: amountAfter.toString(),
        tier: input.nextStage,
        version: { increment: 1 },
      },
      where: {
        id: reservation.id,
        status: { in: [...ACTIVE_HOUSE_RESERVATION_STATUSES] },
        version: reservation.version,
      },
    });
    if (changed.count !== 1) {
      throw riskError('CONFIGURATION', 'Crash exposure changed concurrently');
    }
    await appendRiskLedger(transaction, {
      amount: amountAfter.toString(),
      idempotencyKey: `crash-reservation-adjusted:${input.round.id}:${input.nextStage}`,
      reservationId: reservation.id,
      roundId: input.round.id,
      rules,
      stage: input.nextStage,
      type: HouseTreasuryLedgerType.RESERVATION_ADJUSTED,
    });
  }

  async releaseTerminal(
    transaction: Prisma.TransactionClient,
    input: { now: Date; round: CrashRiskRoundBinding; stage: number },
  ): Promise<void> {
    await acquireAdvisoryTransactionLock(transaction, HOUSE_TREASURY_EXPOSURE_LOCK_KEY);
    const reservation = await transaction.houseTreasuryReservation.findUnique({
      where: { crashRoundId: input.round.id },
    });
    if (!reservation) {
      throw riskError('CONFIGURATION', 'Crash exposure reservation is missing');
    }
    if (
      reservation.source !== HouseTreasuryReservationSource.CRASH ||
      reservation.playerWallet !== riskWallet(input.round.playerWalletReference) ||
      reservation.riskRulesHash !== input.round.riskRulesHash
    ) {
      throw riskError('IDEMPOTENCY_MISMATCH', 'Crash terminal reservation binding does not match');
    }
    if (
      reservation.status === HouseTreasuryReservationStatus.RELEASED ||
      reservation.status === HouseTreasuryReservationStatus.SETTLED
    ) {
      return;
    }
    if (!ACTIVE_HOUSE_RESERVATION_STATUSES.includes(reservation.status)) {
      throw riskError('CONFIGURATION', 'Crash exposure reservation has an unsupported state');
    }
    const changed = await transaction.houseTreasuryReservation.updateMany({
      data: {
        releasedAt: input.now,
        status: HouseTreasuryReservationStatus.RELEASED,
        version: { increment: 1 },
      },
      where: {
        id: reservation.id,
        status: { in: [...ACTIVE_HOUSE_RESERVATION_STATUSES] },
        version: reservation.version,
      },
    });
    if (changed.count !== 1) {
      throw riskError('CONFIGURATION', 'Crash exposure changed concurrently');
    }
    await transaction.houseTreasuryLedgerEntry.create({
      data: {
        amount: reservation.amount,
        crashRoundId: input.round.id,
        currency: 'USDC',
        decimals: 6,
        id: createId('hled'),
        idempotencyKey: `crash-reservation-released:${input.round.id}`,
        metadata: {
          riskRulesHash: input.round.riskRulesHash,
          riskRulesVersion: input.round.riskRulesVersion,
          stage: input.stage,
        },
        reservationId: reservation.id,
        type: HouseTreasuryLedgerType.RESERVATION_RELEASED,
      },
    });
  }

  private async assertCanonicalAdmission(
    transaction: Prisma.TransactionClient,
    input: {
      amountAfter: bigint;
      currentAmount: bigint;
      now: Date;
      playerWallet: string;
      rules: CrashRiskRules;
    },
  ): Promise<void> {
    if (input.amountAfter > BigInt(input.rules.maxPotAmount)) {
      throw riskError('POT', 'Crash pot limit would be exceeded');
    }
    const config = readHouseTreasuryConfig(this.environment);
    const errors = houseTreasuryConfigurationErrors(config);
    if (
      errors.length > 0 ||
      BigInt(input.rules.maxTreasuryExposureAmount) > config.maxTotalExposure
    ) {
      throw riskError('CONFIGURATION', 'Crash treasury policy is absent or incompatible');
    }
    const pause = await transaction.runtimeControl.findUnique({
      where: { key: 'global_exposure' },
    });
    if (!pause || pause.paused) {
      throw riskError('CONFIGURATION', 'Crash exposure admission is paused or uninitialized');
    }
    const snapshot = await transaction.houseTreasurySnapshot.findUnique({
      where: { id: HOUSE_TREASURY_SNAPSHOT_ID },
    });
    if (!snapshot || !houseTreasurySnapshotIsUsable(snapshot, config, input.now, 6)) {
      throw riskError('CONFIGURATION', 'Crash treasury snapshot is missing, stale, or mismatched');
    }

    const activeStatuses = [...ACTIVE_HOUSE_RESERVATION_STATUSES];
    const [active, walletActive, dailyLossEntries] = await Promise.all([
      transaction.houseTreasuryReservation.findMany({
        select: { amount: true },
        where: { status: { in: activeStatuses } },
      }),
      transaction.houseTreasuryReservation.findMany({
        select: { amount: true },
        where: { playerWallet: input.playerWallet, status: { in: activeStatuses } },
      }),
      transaction.houseTreasuryLedgerEntry.findMany({
        select: { amount: true },
        where: {
          createdAt: { gte: startOfUtcDay(input.now), lt: startOfNextUtcDay(input.now) },
          type: HouseTreasuryLedgerType.PLAYER_WIN_LOSS,
        },
      }),
    ]);
    const totalBefore = sumAmounts(active);
    const walletBefore = sumAmounts(walletActive);
    if (totalBefore < input.currentAmount || walletBefore < input.currentAmount) {
      throw riskError('CONFIGURATION', 'Canonical Crash exposure ledger is inconsistent');
    }
    const totalAfter = totalBefore - input.currentAmount + input.amountAfter;
    const walletAfter = walletBefore - input.currentAmount + input.amountAfter;
    if (walletAfter > BigInt(input.rules.maxWalletExposureAmount)) {
      throw riskError('WALLET_EXPOSURE', 'Crash per-wallet exposure limit would be exceeded');
    }
    if (totalAfter > BigInt(input.rules.maxTreasuryExposureAmount)) {
      throw riskError(
        'TREASURY_EXPOSURE',
        'Crash aggregate treasury exposure limit would be exceeded',
      );
    }

    const houseDecision = evaluateHouseExposureLimits(config, {
      activePerTier: 0,
      activePerWallet: 0,
      dailyLoss: sumAmounts(dailyLossEntries),
      delegatedAmount: parseAmount(snapshot.delegatedAmount, 'delegated treasury amount'),
      requested: input.amountAfter - input.currentAmount,
      totalExposure: totalBefore,
      verifiedBalance: parseAmount(snapshot.balanceAmount, 'treasury balance'),
    });
    if (!houseDecision.allowed) {
      throw riskError(
        'TREASURY_EXPOSURE',
        `Crash canonical house limit rejected exposure: ${houseDecision.reason}`,
      );
    }
  }
}

export function hashCrashRiskRules(rules: UnsignedCrashRiskRules): string {
  return sha256(stableStringify(rules));
}

export function validateCrashRiskRules(value: unknown): CrashRiskRules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw riskError('CONFIGURATION', 'Crash risk rules are absent');
  }
  const rules = value as Partial<CrashRiskRules>;
  const evidenceMaxAgeMs = rules.evidenceMaxAgeMs;
  const maxDurationMs = rules.maxDurationMs;
  const maxStage = rules.maxStage;
  const poolReference = rules.poolReference;
  const providerReference = rules.providerReference;
  const rulesVersion = rules.rulesVersion;
  if (
    rules.activation !== 'fixture-only' ||
    rules.schemaVersion !== CRASH_RISK_RULES_SCHEMA_VERSION ||
    rules.policyVersion !== CRASH_RISK_POLICY_VERSION ||
    rules.network !== 'solana-devnet' ||
    rules.currency !== 'USDC' ||
    rules.decimals !== 6 ||
    !validIdentifier(rulesVersion) ||
    !validIdentifier(providerReference) ||
    !validIdentifier(poolReference) ||
    typeof maxStage !== 'number' ||
    !Number.isInteger(maxStage) ||
    maxStage <= 0 ||
    maxStage > MAX_STAGES ||
    typeof maxDurationMs !== 'number' ||
    !Number.isInteger(maxDurationMs) ||
    maxDurationMs <= 0 ||
    maxDurationMs > MAX_DURATION_MS ||
    typeof evidenceMaxAgeMs !== 'number' ||
    !Number.isInteger(evidenceMaxAgeMs) ||
    evidenceMaxAgeMs <= 0 ||
    evidenceMaxAgeMs > MAX_EVIDENCE_AGE_MS
  ) {
    throw riskError('CONFIGURATION', 'Crash risk rules are invalid or unsupported');
  }
  const maxPot = parseAmount(rules.maxPotAmount, 'maximum Crash pot');
  const maxWallet = parseAmount(rules.maxWalletExposureAmount, 'maximum wallet exposure');
  const maxTreasury = parseAmount(rules.maxTreasuryExposureAmount, 'maximum treasury exposure');
  if (
    maxPot <= 0n ||
    maxPot > maxWallet ||
    maxWallet > maxTreasury ||
    typeof rules.riskRulesHash !== 'string' ||
    !HASH_PATTERN.test(rules.riskRulesHash)
  ) {
    throw riskError('CONFIGURATION', 'Crash risk amount bounds or hash are invalid');
  }
  const unsigned: UnsignedCrashRiskRules = {
    activation: 'fixture-only',
    currency: 'USDC',
    decimals: 6,
    evidenceMaxAgeMs,
    maxDurationMs,
    maxPotAmount: maxPot.toString(),
    maxStage,
    maxTreasuryExposureAmount: maxTreasury.toString(),
    maxWalletExposureAmount: maxWallet.toString(),
    network: 'solana-devnet',
    policyVersion: CRASH_RISK_POLICY_VERSION,
    poolReference,
    providerReference,
    rulesVersion,
    schemaVersion: CRASH_RISK_RULES_SCHEMA_VERSION,
  };
  if (hashCrashRiskRules(unsigned) !== rules.riskRulesHash) {
    throw riskError('CONFIGURATION', 'Crash risk rules do not match their committed hash');
  }
  return Object.freeze({ ...unsigned, riskRulesHash: rules.riskRulesHash });
}

export function validateCrashRiskHealth(
  value: unknown,
  rulesInput: unknown,
  now: Date,
): CrashRiskHealthFixture {
  const rules = validateCrashRiskRules(rulesInput);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw riskError('HEALTH', 'Crash provider and pool health evidence is absent');
  }
  const health = value as Partial<CrashRiskHealthFixture>;
  const keys = Object.keys(value);
  const expected = new Set<string>(HEALTH_KEYS);
  const observedAt = typeof health.observedAt === 'string' ? new Date(health.observedAt) : null;
  if (
    keys.length !== HEALTH_KEYS.length ||
    keys.some((key) => !expected.has(key)) ||
    health.schemaVersion !== CRASH_RISK_HEALTH_SCHEMA_VERSION ||
    health.providerStatus !== 'healthy' ||
    health.poolStatus !== 'healthy' ||
    health.providerReference !== rules.providerReference ||
    health.poolReference !== rules.poolReference ||
    health.riskRulesHash !== rules.riskRulesHash ||
    !observedAt ||
    Number.isNaN(observedAt.getTime()) ||
    observedAt.toISOString() !== health.observedAt ||
    observedAt.getTime() > now.getTime() + 60_000 ||
    now.getTime() - observedAt.getTime() > rules.evidenceMaxAgeMs
  ) {
    throw riskError('HEALTH', 'Crash provider or pool health evidence is stale or mismatched');
  }
  return Object.freeze({
    observedAt: health.observedAt,
    poolReference: rules.poolReference,
    poolStatus: 'healthy',
    providerReference: rules.providerReference,
    providerStatus: 'healthy',
    riskRulesHash: rules.riskRulesHash,
    schemaVersion: CRASH_RISK_HEALTH_SCHEMA_VERSION,
  });
}

function assertStageAndDuration(
  rules: CrashRiskRules,
  stage: number,
  expiresAt: Date,
  now: Date,
): void {
  if (!Number.isInteger(stage) || stage <= 0 || stage > rules.maxStage) {
    throw riskError('STAGE', 'Crash maximum stage would be exceeded');
  }
  if (expiresAt <= now) {
    throw riskError('DURATION', 'Crash maximum session duration has expired');
  }
}

function assertRoundBinding(round: CrashRiskRoundBinding, rules: CrashRiskRules): void {
  if (
    round.riskRulesHash !== rules.riskRulesHash ||
    round.riskRulesVersion !== rules.rulesVersion
  ) {
    throw riskError('CONFIGURATION', 'Crash round risk rule references do not match');
  }
}

function assertReservationReplay(
  reservation: {
    amount: string;
    playerWallet: string;
    riskRulesHash: string | null;
    source: HouseTreasuryReservationSource;
  },
  round: CrashRiskRoundBinding,
  rules: CrashRiskRules,
  amount: bigint,
): void {
  assertReservationBinding(reservation, round, rules);
  if (reservation.amount !== amount.toString()) {
    throw riskError('IDEMPOTENCY_MISMATCH', 'Crash reservation replay changes exposure');
  }
}

function assertReservationBinding(
  reservation: {
    playerWallet: string;
    riskRulesHash: string | null;
    source: HouseTreasuryReservationSource;
  },
  round: CrashRiskRoundBinding,
  rules: CrashRiskRules,
): void {
  if (
    reservation.source !== HouseTreasuryReservationSource.CRASH ||
    reservation.playerWallet !== riskWallet(round.playerWalletReference) ||
    reservation.riskRulesHash !== rules.riskRulesHash
  ) {
    throw riskError('IDEMPOTENCY_MISMATCH', 'Crash reservation binding does not match');
  }
}

async function appendRiskLedger(
  transaction: Prisma.TransactionClient,
  input: {
    amount: string;
    idempotencyKey: string;
    reservationId: string;
    roundId: string;
    rules: CrashRiskRules;
    stage: number;
    type: HouseTreasuryLedgerType;
  },
): Promise<void> {
  await transaction.houseTreasuryLedgerEntry.create({
    data: {
      amount: input.amount,
      crashRoundId: input.roundId,
      currency: 'USDC',
      decimals: 6,
      id: createId('hled'),
      idempotencyKey: input.idempotencyKey,
      metadata: {
        riskRulesHash: input.rules.riskRulesHash,
        riskRulesVersion: input.rules.rulesVersion,
        stage: input.stage,
      },
      reservationId: input.reservationId,
      type: input.type,
    },
  });
}

function requireRiskMoney(value: Money, rules: CrashRiskRules, label: string): bigint {
  if (value.currency !== rules.currency || value.decimals !== rules.decimals) {
    throw riskError('CONFIGURATION', `Crash ${label} denomination is incompatible`);
  }
  return parseAmount(value.amount, label);
}

function parseAmount(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw riskError('CONFIGURATION', `Crash ${label} is invalid`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_U64) throw riskError('CONFIGURATION', `Crash ${label} exceeds u64`);
  return parsed;
}

function sumAmounts(rows: Array<{ amount: string }>): bigint {
  return rows.reduce((sum, row) => sum + parseAmount(row.amount, 'ledger amount'), 0n);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function riskWallet(playerWalletReference: string): string {
  const prefix = 'fixture-wallet:';
  if (!playerWalletReference.startsWith(prefix)) {
    throw riskError('CONFIGURATION', 'Crash fixture wallet reference is invalid');
  }
  const wallet = playerWalletReference.slice(prefix.length);
  if (!validIdentifier(wallet)) {
    throw riskError('CONFIGURATION', 'Crash fixture wallet identity is invalid');
  }
  return wallet;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfNextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function riskError(reason: CrashRiskPolicyError['reason'], message: string): CrashRiskPolicyError {
  return new CrashRiskPolicyError(reason, message);
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
