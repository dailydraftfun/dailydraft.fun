import {
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HouseTreasuryLedgerType,
  HouseTreasuryReservationStatus,
  type Prisma,
} from '@openpacksduel/db';
import { PublicKey } from '@solana/web3.js';

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
  tier_concurrency: 'House tier is disabled: tier concurrency limit',
  total_exposure: 'House tier is disabled: total exposure limit',
} as const;

export type HouseExposureLimitReason = keyof typeof HOUSE_EXPOSURE_LIMIT_MESSAGES;

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
  now = new Date(),
): Promise<void> {
  const config = readHouseTreasuryConfig(environment);
  const errors = houseTreasuryConfigurationErrors(config);
  if (errors.length > 0) {
    throw new ServiceUnavailableException(`House treasury is unavailable: ${errors.join(', ')}`);
  }
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
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(770392114)`;
  const existing = await transaction.houseTreasuryReservation.findUnique({
    where: { duelId: input.duelId },
  });
  if (existing) {
    if (
      existing.amount !== input.amount ||
      existing.currency !== input.currency ||
      existing.decimals !== input.decimals ||
      existing.playerWallet !== input.playerWallet ||
      existing.tier !== input.tier
    ) {
      throw new ConflictException('House reservation replay does not match original exposure');
    }
    return;
  }

  const snapshot = await transaction.houseTreasurySnapshot.findUnique({
    where: { id: HOUSE_TREASURY_SNAPSHOT_ID },
  });
  if (!snapshot || !houseTreasurySnapshotIsUsable(snapshot, config, now, input.decimals)) {
    throw new ServiceUnavailableException('House tier is disabled: treasury snapshot is stale');
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
      where: { status: { in: activeStatuses }, tier: input.tier },
    }),
    transaction.houseTreasuryLedgerEntry.findMany({
      select: { amount: true },
      where: {
        createdAt: { gte: startOfUtcDay(now), lt: startOfNextUtcDay(now) },
        type: HouseTreasuryLedgerType.PLAYER_WIN_LOSS,
      },
    }),
  ]);
  const requested = BigInt(input.amount);
  const totalExposure = sumAmounts(active);
  const dailyLoss = sumAmounts(dailyLossEntries);
  const verifiedBalance = parseStoredAmount(snapshot.balanceAmount);
  const delegatedAmount = parseStoredAmount(snapshot.delegatedAmount);

  assertHouseExposureAllowed(
    evaluateHouseExposureLimits(config, {
      activePerTier: tierActive,
      activePerWallet: walletActive,
      dailyLoss,
      delegatedAmount,
      requested,
      totalExposure,
      verifiedBalance,
    }),
  );

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

export function shouldRetryTreasuryTransaction(error: unknown, attempt: number): boolean {
  if (attempt >= 3 || !error || typeof error !== 'object') return false;
  return 'code' in error && error.code === 'P2034';
}

export function readHouseTreasuryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): HouseTreasuryConfig {
  return {
    allowedDispositions: readDispositions(environment.OPENPACKSDUEL_HOUSE_ALLOWED_DISPOSITIONS),
    dailyLossLimit: readUnsignedAmount(environment.OPENPACKSDUEL_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO),
    enabled: environment.OPENPACKSDUEL_HOUSE_ENABLED === 'true',
    fundingSigner: trimmed(environment.OPENPACKSDUEL_HOUSE_DEVNET_FUNDING_SIGNER),
    houseWallet: trimmed(environment.OPENPACKSDUEL_HOUSE_DEVNET_WALLET),
    maxActivePerWallet: boundedInteger(
      environment.OPENPACKSDUEL_HOUSE_MAX_ACTIVE_PER_WALLET,
      1,
      1,
      20,
    ),
    maxConcurrentPerTier: boundedInteger(
      environment.OPENPACKSDUEL_HOUSE_MAX_CONCURRENT_PER_TIER,
      1,
      1,
      100,
    ),
    maxTotalExposure: readUnsignedAmount(
      environment.OPENPACKSDUEL_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO,
    ),
    minimumLiquidity: readUnsignedAmount(environment.OPENPACKSDUEL_HOUSE_MIN_LIQUIDITY_USDC_MICRO),
    network: trimmed(environment.OPENPACKSDUEL_NETWORK),
    snapshotMaxAgeMs:
      boundedInteger(environment.OPENPACKSDUEL_HOUSE_SNAPSHOT_MAX_AGE_SECONDS, 300, 30, 3_600) *
      1_000,
    tokenAccount: trimmed(environment.OPENPACKSDUEL_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT),
    usdcMint: trimmed(environment.OPENPACKSDUEL_HOUSE_DEVNET_USDC_MINT),
    withdrawalAuthority: trimmed(environment.OPENPACKSDUEL_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY),
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

function assertHouseExposureAllowed(decision: HouseExposureLimitDecision): void {
  if (decision.allowed) return;
  const message = HOUSE_EXPOSURE_LIMIT_MESSAGES[decision.reason];
  if (decision.reason === 'player_exposure' || decision.reason === 'tier_concurrency') {
    throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }
  throw new ServiceUnavailableException(message);
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
