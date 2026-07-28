import {
  type DatabaseClient,
  HouseTreasuryLedgerType,
  HouseTreasuryReservationSource,
  HouseTreasuryReservationStatus,
  type Prisma,
} from '@dailydraft/db';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { acquireAdvisoryTransactionLock } from '../database/advisory-lock.js';

export const HOUSE_TREASURY_EXPOSURE_LOCK_KEY = 770_392_114;

export const HOUSE_TREASURY_SNAPSHOT_ID = 'solana-devnet-usdc';
export const ACTIVE_HOUSE_RESERVATION_STATUSES: HouseTreasuryReservationStatus[] = [
  HouseTreasuryReservationStatus.RESERVED,
  HouseTreasuryReservationStatus.FUNDED,
  HouseTreasuryReservationStatus.SETTLEMENT_PENDING,
  HouseTreasuryReservationStatus.RECOVERY_REQUIRED,
];

export interface HouseTreasuryConfig {
  allowedDispositions: Array<'buyback' | 'hold' | 'list' | 'manual_review' | 'promotion'>;
  dailyLossLimit: bigint;
  enabled: boolean;
  fundingSigner: string | null;
  houseWallet: string | null;
  maxActivePerWallet: number;
  maxConcurrentPerTier: number;
  maxTotalExposure: bigint;
  minimumLiquidity: bigint;
  network: string | null;
  snapshotMaxAgeMs: number;
  tokenAccount: string | null;
  usdcMint: string | null;
  withdrawalAuthority: string | null;
}

export interface HouseTreasurySnapshotEvidence {
  balanceAmount: string;
  balanceDecimals: number;
  delegate: string;
  delegatedAmount: string;
  mint: string;
  network: string;
  tokenAccount: string;
  verifiedAt: Date;
  wallet: string;
}

export const HOUSE_EXPOSURE_LIMIT_MESSAGES = {
  daily_loss: 'House tier is disabled: daily loss limit',
  delegated_allowance: 'House tier is disabled: delegated allowance',
  minimum_liquidity: 'House tier is disabled: minimum liquidity',
  player_exposure: 'House tier is disabled: player exposure limit',
  reconciliation_discrepancy:
    'House tier is disabled: unresolved treasury reconciliation discrepancy',
  tier_concurrency: 'House tier is disabled: tier concurrency limit',
  total_exposure: 'House tier is disabled: total exposure limit',
} as const;

export type HouseExposureLimitReason = keyof typeof HOUSE_EXPOSURE_LIMIT_MESSAGES;

export type HouseTierDisableReason =
  | Exclude<HouseExposureLimitReason, 'player_exposure'>
  | 'treasury_configuration'
  | 'treasury_snapshot_stale';

export type HouseTierReenableBoundary =
  | 'configuration_change'
  | 'fresh_treasury_snapshot'
  | 'fresh_treasury_snapshot_or_reservation_release'
  | 'next_utc_day_or_reservation_release'
  | 'reservation_release'
  | 'successful_reconciliation'
  | 'tier_reservation_release';

const HOUSE_TIER_REENABLE_BOUNDARIES: Record<HouseTierDisableReason, HouseTierReenableBoundary> = {
  daily_loss: 'next_utc_day_or_reservation_release',
  delegated_allowance: 'fresh_treasury_snapshot_or_reservation_release',
  minimum_liquidity: 'fresh_treasury_snapshot_or_reservation_release',
  reconciliation_discrepancy: 'successful_reconciliation',
  tier_concurrency: 'tier_reservation_release',
  total_exposure: 'reservation_release',
  treasury_configuration: 'configuration_change',
  treasury_snapshot_stale: 'fresh_treasury_snapshot',
};

export const GLOBAL_EXPOSURE_CONTROL = 'global_exposure';

export class HouseTierAdmissionError extends HttpException {
  constructor(
    message: string,
    status: HttpStatus,
    readonly tier: number,
    readonly reason: HouseTierDisableReason,
    readonly reenableBoundary: HouseTierReenableBoundary,
    readonly evaluatedAt: Date,
  ) {
    super(message, status);
  }
}

export interface HouseExposureLimitSnapshot {
  activePerTier: number;
  activePerWallet: number;
  dailyLoss: bigint;
  delegatedAmount: bigint;
  requested: bigint;
  totalExposure: bigint;
  verifiedBalance: bigint;
}

export type HouseExposureLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: HouseExposureLimitReason };

export function evaluateHouseExposureLimits(
  config: Pick<
    HouseTreasuryConfig,
    | 'dailyLossLimit'
    | 'maxActivePerWallet'
    | 'maxConcurrentPerTier'
    | 'maxTotalExposure'
    | 'minimumLiquidity'
  >,
  snapshot: HouseExposureLimitSnapshot,
): HouseExposureLimitDecision {
  if (snapshot.activePerWallet >= config.maxActivePerWallet) {
    return { allowed: false, reason: 'player_exposure' };
  }
  if (snapshot.activePerTier >= config.maxConcurrentPerTier) {
    return { allowed: false, reason: 'tier_concurrency' };
  }
  const requestedExposure = snapshot.totalExposure + snapshot.requested;
  if (snapshot.dailyLoss + requestedExposure > config.dailyLossLimit) {
    return { allowed: false, reason: 'daily_loss' };
  }
  if (requestedExposure > config.maxTotalExposure) {
    return { allowed: false, reason: 'total_exposure' };
  }
  if (snapshot.verifiedBalance < requestedExposure + config.minimumLiquidity) {
    return { allowed: false, reason: 'minimum_liquidity' };
  }
  if (snapshot.delegatedAmount < requestedExposure) {
    return { allowed: false, reason: 'delegated_allowance' };
  }
  return { allowed: true };
}

export async function reserveHouseExposure(
  transaction: Prisma.TransactionClient,
  input: {
    amount: string;
    currency: string;
    decimals: number;
    duelId: string;
    playerWallet: string;
    tier: number;
  },
  environment: NodeJS.ProcessEnv = process.env,
  now?: Date,
): Promise<void> {
  if (
    input.currency !== 'USDC' ||
    input.decimals !== 6 ||
    !/^\d+$/.test(input.amount) ||
    BigInt(input.amount) <= 0n ||
    !Number.isInteger(input.tier) ||
    input.tier <= 0
  ) {
    throw new ServiceUnavailableException(
      'House exposure requires positive integer six-decimal USDC and a positive integer tier',
    );
  }
  const replay = await transaction.houseTreasuryReservation.findUnique({
    where: { duelId: input.duelId },
  });
  if (assertExactReservationReplay(replay, input)) return;

  const config = readHouseTreasuryConfig(environment);
  const errors = houseTreasuryConfigurationErrors(config);
  if (errors.length > 0) {
    throw disableHouseTier({
      evaluatedAt: now ?? new Date(),
      message: `House treasury is unavailable: ${errors.join(', ')}`,
      reason: 'treasury_configuration',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      tier: input.tier,
    });
  }

  await acquireAdvisoryTransactionLock(transaction, HOUSE_TREASURY_EXPOSURE_LOCK_KEY);
  const serializedReplay = await transaction.houseTreasuryReservation.findUnique({
    where: { duelId: input.duelId },
  });
  if (assertExactReservationReplay(serializedReplay, input)) return;

  const pause = await transaction.$queryRaw<Array<{ paused: boolean }>>`
    SELECT "paused"
    FROM "RuntimeControl"
    WHERE "key" = ${GLOBAL_EXPOSURE_CONTROL}
    FOR SHARE
  `;
  if (pause[0]?.paused) {
    throw new ServiceUnavailableException('New duel exposure is paused by an operator');
  }
  const evaluatedAt = now ?? new Date();

  const unresolvedDiscrepancies = await transaction.houseReconciliationDiscrepancy.count({
    where: { resolvedAt: null },
  });
  if (unresolvedDiscrepancies > 0) {
    throw disableHouseTier({
      evaluatedAt,
      message: HOUSE_EXPOSURE_LIMIT_MESSAGES.reconciliation_discrepancy,
      reason: 'reconciliation_discrepancy',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      tier: input.tier,
    });
  }

  const snapshot = await transaction.houseTreasurySnapshot.findUnique({
    where: { id: HOUSE_TREASURY_SNAPSHOT_ID },
  });
  if (!snapshot || !houseTreasurySnapshotIsUsable(snapshot, config, evaluatedAt, input.decimals)) {
    throw disableHouseTier({
      evaluatedAt,
      message: 'House tier is disabled: treasury snapshot is stale',
      reason: 'treasury_snapshot_stale',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      tier: input.tier,
    });
  }

  const activeStatuses = [...ACTIVE_HOUSE_RESERVATION_STATUSES];
  const [active, walletActive, tierActive, dailyLossEntries] = await Promise.all([
    transaction.houseTreasuryReservation.findMany({
      select: { amount: true },
      where: { status: { in: activeStatuses } },
    }),
    transaction.houseTreasuryReservation.count({
      where: { playerWallet: input.playerWallet, status: { in: activeStatuses } },
    }),
    transaction.houseTreasuryReservation.count({
      where: {
        source: HouseTreasuryReservationSource.DUEL,
        status: { in: activeStatuses },
        tier: input.tier,
      },
    }),
    transaction.houseTreasuryLedgerEntry.findMany({
      select: { amount: true },
      where: {
        createdAt: { gte: startOfUtcDay(evaluatedAt), lt: startOfNextUtcDay(evaluatedAt) },
        type: HouseTreasuryLedgerType.PLAYER_WIN_LOSS,
      },
    }),
  ]);
  const requested = BigInt(input.amount);
  const totalExposure = sumAmounts(active);
  const dailyLoss = sumAmounts(dailyLossEntries);
  const verifiedBalance = parseStoredAmount(snapshot.balanceAmount);
  const delegatedAmount = parseStoredAmount(snapshot.delegatedAmount);

  const decision = evaluateHouseExposureLimits(config, {
    activePerTier: tierActive,
    activePerWallet: walletActive,
    dailyLoss,
    delegatedAmount,
    requested,
    totalExposure,
    verifiedBalance,
  });
  if (!decision.allowed) {
    const status =
      decision.reason === 'player_exposure' || decision.reason === 'tier_concurrency'
        ? HttpStatus.TOO_MANY_REQUESTS
        : HttpStatus.SERVICE_UNAVAILABLE;
    if (decision.reason === 'player_exposure') {
      throw new HttpException(HOUSE_EXPOSURE_LIMIT_MESSAGES[decision.reason], status);
    }
    throw disableHouseTier({
      evaluatedAt,
      message: HOUSE_EXPOSURE_LIMIT_MESSAGES[decision.reason],
      reason: decision.reason,
      status,
      tier: input.tier,
    });
  }

  await recordHouseTierAdmissionState(transaction, {
    disabled: false,
    evaluatedAt,
    reason: null,
    reenableBoundary: null,
    tier: input.tier,
  });

  const reservationId = createId('hres');
  await transaction.houseTreasuryReservation.create({
    data: {
      amount: input.amount,
      currency: input.currency,
      decimals: input.decimals,
      duelId: input.duelId,
      id: reservationId,
      playerWallet: input.playerWallet,
      tier: input.tier,
    },
  });
  await transaction.houseTreasuryLedgerEntry.create({
    data: {
      amount: input.amount,
      currency: input.currency,
      decimals: input.decimals,
      duelId: input.duelId,
      id: createId('hled'),
      idempotencyKey: `reservation-created:${input.duelId}`,
      metadata: { tier: input.tier },
      reservationId,
      type: HouseTreasuryLedgerType.RESERVATION_CREATED,
    },
  });
}

export async function persistHouseTierAdmissionFailure(
  transaction: Prisma.TransactionClient,
  error: unknown,
): Promise<boolean> {
  if (!(error instanceof HouseTierAdmissionError)) return false;
  await recordHouseTierAdmissionState(transaction, {
    disabled: true,
    evaluatedAt: error.evaluatedAt,
    reason: error.reason,
    reenableBoundary: error.reenableBoundary,
    tier: error.tier,
  });
  return true;
}

/**
 * Record a tier-admission failure without ever letting the bookkeeping write
 * affect the caller's reservation error contract. Recording the state is
 * observability-only: if its own transaction throws (transient DB error,
 * unapplied migration, constraint violation), that must not replace the
 * original HouseTierAdmissionError or bypass the caller's replay/retry path.
 */
export async function persistHouseTierAdmissionFailureSafely(
  database: DatabaseClient,
  error: unknown,
): Promise<void> {
  if (!(error instanceof HouseTierAdmissionError)) return;
  try {
    await database.$transaction((transaction) =>
      persistHouseTierAdmissionFailure(transaction, error),
    );
  } catch {
    // Intentionally swallowed — see the contract described above.
  }
}

export function houseTreasurySnapshotIsUsable(
  snapshot: HouseTreasurySnapshotEvidence,
  config: HouseTreasuryConfig,
  now = new Date(),
  decimals = 6,
): boolean {
  try {
    const balance = parseStoredAmount(snapshot.balanceAmount);
    const delegated = parseStoredAmount(snapshot.delegatedAmount);
    return (
      snapshot.network === 'DEVNET' &&
      snapshot.wallet === config.withdrawalAuthority &&
      snapshot.delegate === config.fundingSigner &&
      snapshot.tokenAccount === config.tokenAccount &&
      snapshot.mint === config.usdcMint &&
      snapshot.balanceDecimals === decimals &&
      snapshot.verifiedAt.getTime() <= now.getTime() + 60_000 &&
      now.getTime() - snapshot.verifiedAt.getTime() <= config.snapshotMaxAgeMs &&
      delegated > 0n &&
      delegated <= config.maxTotalExposure &&
      delegated <= balance
    );
  } catch {
    return false;
  }
}

function assertExactReservationReplay(
  existing: {
    amount: string;
    currency: string;
    decimals: number;
    playerWallet: string;
    tier: number;
  } | null,
  input: {
    amount: string;
    currency: string;
    decimals: number;
    playerWallet: string;
    tier: number;
  },
): boolean {
  if (!existing) return false;
  if (
    existing.amount !== input.amount ||
    existing.currency !== input.currency ||
    existing.decimals !== input.decimals ||
    existing.playerWallet !== input.playerWallet ||
    existing.tier !== input.tier
  ) {
    throw new ConflictException('House reservation replay does not match original exposure');
  }
  return true;
}

export function shouldRetryTreasuryTransaction(error: unknown, attempt: number): boolean {
  if (attempt >= 3 || !error || typeof error !== 'object') return false;
  if ('code' in error && error.code === 'P2034') return true;
  if (!('cause' in error) || !error.cause || typeof error.cause !== 'object') return false;
  return (
    'originalCode' in error.cause &&
    error.cause.originalCode === '40001' &&
    'kind' in error.cause &&
    error.cause.kind === 'TransactionWriteConflict'
  );
}

export function readHouseTreasuryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): HouseTreasuryConfig {
  return {
    allowedDispositions: readDispositions(environment.DAILYDRAFT_HOUSE_ALLOWED_DISPOSITIONS),
    dailyLossLimit: readUnsignedAmount(environment.DAILYDRAFT_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO),
    enabled: environment.DAILYDRAFT_HOUSE_ENABLED === 'true',
    fundingSigner: trimmed(environment.DAILYDRAFT_HOUSE_DEVNET_FUNDING_SIGNER),
    houseWallet: trimmed(environment.DAILYDRAFT_HOUSE_DEVNET_WALLET),
    maxActivePerWallet: boundedInteger(
      environment.DAILYDRAFT_HOUSE_MAX_ACTIVE_PER_WALLET,
      1,
      1,
      20,
    ),
    maxConcurrentPerTier: boundedInteger(
      environment.DAILYDRAFT_HOUSE_MAX_CONCURRENT_PER_TIER,
      1,
      1,
      100,
    ),
    maxTotalExposure: readUnsignedAmount(
      environment.DAILYDRAFT_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO,
    ),
    minimumLiquidity: readUnsignedAmount(environment.DAILYDRAFT_HOUSE_MIN_LIQUIDITY_USDC_MICRO),
    network: trimmed(environment.DAILYDRAFT_NETWORK),
    snapshotMaxAgeMs:
      boundedInteger(environment.DAILYDRAFT_HOUSE_SNAPSHOT_MAX_AGE_SECONDS, 300, 30, 3_600) * 1_000,
    tokenAccount: trimmed(environment.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT),
    usdcMint: trimmed(environment.DAILYDRAFT_HOUSE_DEVNET_USDC_MINT),
    withdrawalAuthority: trimmed(environment.DAILYDRAFT_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY),
  };
}

export function houseTreasuryConfigurationErrors(config: HouseTreasuryConfig): string[] {
  const errors: string[] = [];
  if (!config.enabled) errors.push('house_disabled');
  if (config.network !== 'solana-devnet') errors.push('devnet_required');
  if (!isPublicKey(config.houseWallet)) errors.push('house_wallet_missing');
  if (!isPublicKey(config.fundingSigner)) errors.push('funding_signer_missing');
  if (!isPublicKey(config.withdrawalAuthority)) errors.push('withdrawal_authority_missing');
  if (!isPublicKey(config.tokenAccount)) errors.push('usdc_token_account_missing');
  if (!isPublicKey(config.usdcMint)) errors.push('usdc_mint_missing');
  if (config.houseWallet && config.fundingSigner && config.houseWallet !== config.fundingSigner) {
    errors.push('funding_signer_must_match_hot_wallet');
  }
  if (
    config.withdrawalAuthority &&
    [config.houseWallet, config.fundingSigner].includes(config.withdrawalAuthority)
  ) {
    errors.push('withdrawal_authority_not_separated');
  }
  if (config.maxTotalExposure <= 0n) errors.push('total_exposure_limit_missing');
  if (config.dailyLossLimit <= 0n) errors.push('daily_loss_limit_missing');
  if (config.minimumLiquidity <= 0n) errors.push('minimum_liquidity_missing');
  return errors;
}

function readDispositions(value?: string): HouseTreasuryConfig['allowedDispositions'] {
  const allowed = new Set(['buyback', 'hold', 'list', 'manual_review', 'promotion']);
  const values = (value ?? 'hold,manual_review')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => allowed.has(item));
  return [...new Set(values)] as HouseTreasuryConfig['allowedDispositions'];
}

function disableHouseTier(input: {
  evaluatedAt: Date;
  message: string;
  reason: HouseTierDisableReason;
  status: HttpStatus;
  tier: number;
}): HouseTierAdmissionError {
  const reenableBoundary = HOUSE_TIER_REENABLE_BOUNDARIES[input.reason];
  return new HouseTierAdmissionError(
    input.message,
    input.status,
    input.tier,
    input.reason,
    reenableBoundary,
    input.evaluatedAt,
  );
}

async function recordHouseTierAdmissionState(
  transaction: Prisma.TransactionClient,
  input: {
    disabled: boolean;
    evaluatedAt: Date;
    reason: HouseTierDisableReason | null;
    reenableBoundary: HouseTierReenableBoundary | null;
    tier: number;
  },
): Promise<void> {
  await transaction.$executeRaw`
    INSERT INTO "HouseTierAdmissionState" (
      "tier",
      "disabled",
      "reason",
      "reenableBoundary",
      "evaluatedAt",
      "updatedAt"
    ) VALUES (
      ${input.tier},
      ${input.disabled},
      ${input.reason},
      ${input.reenableBoundary},
      ${input.evaluatedAt},
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("tier") DO UPDATE SET
      "disabled" = EXCLUDED."disabled",
      "reason" = EXCLUDED."reason",
      "reenableBoundary" = EXCLUDED."reenableBoundary",
      "evaluatedAt" = EXCLUDED."evaluatedAt",
      "version" = "HouseTierAdmissionState"."version" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "HouseTierAdmissionState"."evaluatedAt" <= EXCLUDED."evaluatedAt"
  `;
}

function readUnsignedAmount(value?: string): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function parseStoredAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new ServiceUnavailableException('House treasury contains an invalid stored amount');
  }
  return BigInt(value);
}

function sumAmounts(rows: Array<{ amount: string }>): bigint {
  return rows.reduce((sum, row) => sum + parseStoredAmount(row.amount), 0n);
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfNextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
}

function trimmed(value?: string): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function isPublicKey(value: string | null): boolean {
  if (!value) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
