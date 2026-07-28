import { createHash } from 'node:crypto';
import {
  type DatabaseClient,
  OperatorReasonCode as DatabaseReasonCode,
  DuelStatus,
  DuelTransactionStatus,
  OperatorAction,
  OperatorActorClass,
  type Prisma,
} from '@dailydraft/db';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Keypair } from '@solana/web3.js';

import { rarityForSerializedValue } from '../common/pull-rarity.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import type { MatchmakingMode } from '../domain.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import {
  GLOBAL_EXPOSURE_CONTROL,
  HOUSE_TREASURY_SNAPSHOT_ID,
  type HouseTreasurySnapshotEvidence,
  houseTreasuryConfigurationErrors,
  houseTreasurySnapshotIsUsable,
  readHouseTreasuryConfig,
} from '../treasury/house-treasury.policy.js';
import type {
  AdminDuelQuery,
  EmergencyPauseRequest,
  OperatorAuditQuery,
  OperatorReasonCode,
} from './admin.dto.js';

const INTEGRATION_ACTOR_LABEL = 'integration-key';
const ACTIVE_DUEL_STATUSES: DuelStatus[] = [
  DuelStatus.WAITING,
  DuelStatus.MATCHED,
  DuelStatus.COMMITTING,
  DuelStatus.FUNDED,
  DuelStatus.OPENING,
  DuelStatus.AWAITING_ASSETS,
  DuelStatus.SETTLING,
  DuelStatus.CANCELLING,
  DuelStatus.REFUNDING,
];

export interface RiskLimits {
  allowedTiers: number[];
  houseEnabled: boolean;
  maxActiveDuelsPerWallet: number;
  maxConcurrentDuelsPerTier: number;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly rpc: SolanaRpcGateway,
  ) {}

  async assertCreateAllowed(input: {
    mode: MatchmakingMode;
    tier: number;
    wallet: string;
  }): Promise<void> {
    await this.assertNotPaused();
    const limits = readRiskLimits();
    if (!limits.allowedTiers.includes(input.tier)) {
      throw new ConflictException(`Pack tier ${input.tier} is disabled by devnet risk controls`);
    }
    if (input.mode === 'house' && !limits.houseEnabled) {
      throw new ServiceUnavailableException('House entry is disabled by devnet risk controls');
    }
    const [walletActive, tierActive] = await Promise.all([
      this.activeDuelsForWallet(input.wallet),
      this.database.duel.count({
        where: {
          stakeAmount: String(input.tier * 1_000_000),
          stakeDecimals: 6,
          status: { in: ACTIVE_DUEL_STATUSES },
        },
      }),
    ]);
    assertWithinRiskLimits({ limits, tierActive, walletActive });
  }

  async assertJoinAllowed(duelId: string, wallet: string): Promise<void> {
    await this.assertNotPaused();
    const walletActive = await this.activeDuelsForWallet(wallet);
    assertWithinRiskLimits({ limits: readRiskLimits(), tierActive: 0, walletActive });
    const duelExists = await this.database.duel.count({ where: { id: duelId } });
    if (duelExists !== 1) throw new NotFoundException(`Duel ${duelId} was not found`);
  }

  async assertNotPaused(): Promise<void> {
    const control = await this.database.runtimeControl.findUnique({
      where: { key: GLOBAL_EXPOSURE_CONTROL },
    });
    if (control?.paused) {
      throw new ServiceUnavailableException('New duel exposure is paused by an operator');
    }
  }

  async getEmergencyPause() {
    const control = await this.database.runtimeControl.findUnique({
      where: { key: GLOBAL_EXPOSURE_CONTROL },
    });
    return toPauseState(control);
  }

  async setEmergencyPause(input: EmergencyPauseRequest) {
    const reasonCode = toDatabaseReason(input.reasonCode);
    try {
      return await this.database.$transaction(async (transaction) => {
        const current = await transaction.runtimeControl.findUnique({
          where: { key: GLOBAL_EXPOSURE_CONTROL },
        });
        const previousPaused = current?.paused ?? false;
        if (isPauseNoop(current, input.paused, reasonCode)) return toPauseState(current);
        const control = current
          ? await updateRuntimeControl(transaction, current, input.paused, reasonCode)
          : await transaction.runtimeControl.create({
              data: {
                actorClass: OperatorActorClass.INTEGRATION_KEY,
                actorLabel: INTEGRATION_ACTOR_LABEL,
                key: GLOBAL_EXPOSURE_CONTROL,
                paused: input.paused,
                reasonCode,
              },
            });
        await transaction.operatorAuditEvent.create({
          data: {
            action: input.paused ? OperatorAction.EMERGENCY_PAUSE : OperatorAction.EMERGENCY_RESUME,
            actorClass: OperatorActorClass.INTEGRATION_KEY,
            actorLabel: INTEGRATION_ACTOR_LABEL,
            id: createId('oaud'),
            nextPaused: input.paused,
            previousPaused,
            reasonCode,
          },
        });
        return toPauseState(control);
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        const current = await this.database.runtimeControl.findUnique({
          where: { key: GLOBAL_EXPOSURE_CONTROL },
        });
        if (isPauseNoop(current, input.paused, reasonCode)) return toPauseState(current);
      }
      throw error;
    }
  }

  async listAudit(query: OperatorAuditQuery) {
    const cursor = query.cursor
      ? await this.database.operatorAuditEvent.findUnique({ where: { id: query.cursor } })
      : null;
    if (query.cursor && !cursor) throw new BadRequestException('Audit cursor was not found');
    const rows = await this.database.operatorAuditEvent.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(cursor
        ? {
            where: {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            },
          }
        : {}),
    });
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      data: visible.map((row) => ({
        action: row.action.toLowerCase(),
        actorClass: 'integration_key',
        actorLabel: row.actorLabel,
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        nextPaused: row.nextPaused,
        previousPaused: row.previousPaused,
        reasonCode: row.reasonCode.toLowerCase(),
      })),
      hasMore,
      nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  async listAttentionDuels(query: AdminDuelQuery) {
    const stuckBefore = new Date(Date.now() - stuckThresholdMinutes() * 60 * 1_000);
    const where = buildAttentionWhere(query, stuckBefore);
    const cursor = query.cursor
      ? await this.database.duel.findUnique({ where: { id: query.cursor } })
      : null;
    if (query.cursor && !cursor) throw new BadRequestException('Duel cursor was not found');
    const rows = await this.database.duel.findMany({
      include: {
        packOutcomes: { select: { assetReference: true } },
        transactions: {
          orderBy: { createdAt: 'asc' },
          select: {
            action: true,
            errorCode: true,
            id: true,
            providerReference: true,
            recoveredAt: true,
            recoveryCandidateAt: true,
            signature: true,
            status: true,
            stuckAt: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      where: {
        AND: [
          where,
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
    });
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      data: visible.map((duel) => ({
        attention: attentionReasons(duel, stuckBefore),
        createdAt: duel.createdAt.toISOString(),
        duelId: duel.id,
        mode: duel.mode.toLowerCase(),
        providerMode: duel.providerMode.toLowerCase().replaceAll('_', '-'),
        status: duel.status.toLowerCase(),
        tier: Number(duel.stakeAmount) / 10 ** duel.stakeDecimals,
        transactionCount: duel.transactions.length,
        updatedAt: duel.updatedAt.toISOString(),
      })),
      hasMore,
      nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  async getTimeline(duelId: string) {
    const duel = await this.database.duel.findUnique({
      include: {
        events: { orderBy: { sequence: 'asc' } },
        packOutcomes: { orderBy: { side: 'asc' } },
        transactions: { orderBy: { createdAt: 'asc' } },
      },
      where: { id: duelId },
    });
    if (!duel) throw new NotFoundException(`Duel ${duelId} was not found`);
    return {
      custody: {
        escrowAddress: duel.escrowAddress,
        houseOpponent: duel.houseOpponent,
        winnerWallet: duel.winnerWallet,
      },
      duel: {
        createdAt: duel.createdAt.toISOString(),
        creatorWallet: duel.creatorWallet,
        duelId: duel.id,
        mode: duel.mode.toLowerCase(),
        opponentWallet: duel.opponentWallet,
        providerMode: duel.providerMode.toLowerCase().replaceAll('_', '-'),
        status: duel.status.toLowerCase(),
        updatedAt: duel.updatedAt.toISOString(),
        version: duel.version,
      },
      events: duel.events.map((event) => ({
        actorWallet: event.actorWallet,
        createdAt: event.createdAt.toISOString(),
        data: event.data,
        fromStatus: event.fromStatus?.toLowerCase() ?? null,
        id: event.id,
        sequence: event.sequence,
        toStatus: event.toStatus?.toLowerCase() ?? null,
        type: event.type,
      })),
      outcomes: duel.packOutcomes.map((outcome) => ({
        assetReference: outcome.assetReference,
        displayName: outcome.displayName,
        insuredValue: {
          amount: outcome.insuredValueAmount,
          currency: outcome.insuredValueCurrency,
          decimals: outcome.insuredValueDecimals,
        },
        isMock: outcome.isMock,
        openedAt: outcome.openedAt.toISOString(),
        poolVersion: outcome.poolVersion,
        providerReference: outcome.providerReference,
        rarity: rarityForSerializedValue(outcome.insuredValueAmount, outcome.insuredValueDecimals),
        resultHash: outcome.resultHash,
        side: outcome.side.toLowerCase(),
        sourceTimestamp: outcome.sourceTimestamp?.toISOString() ?? null,
        valuationPolicyHash: outcome.valuationPolicyHash,
      })),
      transactions: duel.transactions.map((transaction) => ({
        action: transaction.action.toLowerCase(),
        checkAttempts: transaction.checkAttempts,
        confirmationStatus: transaction.confirmationStatus,
        createdAt: transaction.createdAt.toISOString(),
        errorCode: transaction.errorCode,
        errorMessage: transaction.errorMessage,
        finalizedAt: transaction.finalizedAt?.toISOString() ?? null,
        id: transaction.id,
        lastCheckedAt: transaction.lastCheckedAt?.toISOString() ?? null,
        providerReference: transaction.providerReference,
        recoveredAt: transaction.recoveredAt?.toISOString() ?? null,
        recoveryAlertCode: transaction.recoveryAlertCode,
        recoveryCandidateAt: transaction.recoveryCandidateAt?.toISOString() ?? null,
        recoveryCandidateSignature: transaction.recoveryCandidateSignature,
        recoveryCheckAttempts: transaction.recoveryCheckAttempts,
        signature: transaction.signature,
        submissionSource: transaction.recoveredAt
          ? 'rpc-recovery'
          : transaction.submittedAt && transaction.signature
            ? 'api-submission'
            : null,
        status: transaction.status.toLowerCase(),
        stuckAt: transaction.stuckAt?.toISOString() ?? null,
        wallet: transaction.wallet,
      })),
      valuation: {
        policyHash: duel.valuationPolicyHash,
        resultHash: duel.resultHash,
        resultReadyAt: duel.resultReadyAt?.toISOString() ?? null,
        stake: {
          amount: duel.stakeAmount,
          currency: duel.stakeCurrency,
          decimals: duel.stakeDecimals,
        },
      },
    };
  }

  async getRiskSummary() {
    const limits = readRiskLimits();
    const [duels, failedDuels, stuckTransactions, unboundEscrowAlerts] = await Promise.all([
      this.database.duel.findMany({
        select: {
          creatorWallet: true,
          mode: true,
          opponentWallet: true,
          stakeAmount: true,
          stakeDecimals: true,
        },
        where: { status: { in: ACTIVE_DUEL_STATUSES } },
      }),
      this.database.duel.count({ where: { status: DuelStatus.FAILED } }),
      this.database.duelTransaction.count({ where: { stuckAt: { not: null } } }),
      this.database.duelTransaction.count({
        where: { recoveredAt: null, recoveryCandidateAt: { not: null } },
      }),
    ]);
    const tiers = new Map<number, number>();
    const wallets = new Map<string, number>();
    let houseDuels = 0;
    for (const duel of duels) {
      const tier = Number(duel.stakeAmount) / 10 ** duel.stakeDecimals;
      tiers.set(tier, (tiers.get(tier) ?? 0) + 1);
      wallets.set(duel.creatorWallet, (wallets.get(duel.creatorWallet) ?? 0) + 1);
      if (duel.opponentWallet) {
        wallets.set(duel.opponentWallet, (wallets.get(duel.opponentWallet) ?? 0) + 1);
      }
      if (duel.mode === 'HOUSE') houseDuels += 1;
    }
    return {
      activeDuels: duels.length,
      activeHouseDuels: houseDuels,
      activeWalletsAtLimit: [...wallets.entries()]
        .filter(([, count]) => count >= limits.maxActiveDuelsPerWallet)
        .map(([wallet, count]) => ({ activeDuels: count, walletRef: walletReference(wallet) })),
      failedDuels,
      limits,
      stuckTransactions,
      unboundEscrowAlerts,
      tiers: [...tiers.entries()]
        .sort(([left], [right]) => left - right)
        .map(([tier, activeDuels]) => ({ activeDuels, tier })),
    };
  }

  async getReadiness() {
    let databaseReady = true;
    let unboundEscrowAlerts: number | null = null;
    let unresolvedTreasuryDiscrepancies: number | null = null;
    let treasurySnapshot: HouseTreasurySnapshotEvidence | null = null;
    try {
      const [, alertCount, discrepancyCount, snapshot] = await Promise.all([
        this.database.duel.count({ where: { id: '__readiness__' } }),
        this.database.duelTransaction.count({
          where: { recoveredAt: null, recoveryCandidateAt: { not: null } },
        }),
        this.database.houseReconciliationDiscrepancy.count({
          where: { resolvedAt: null },
        }),
        this.database.houseTreasurySnapshot.findUnique({
          select: {
            balanceAmount: true,
            balanceDecimals: true,
            delegate: true,
            delegatedAmount: true,
            mint: true,
            network: true,
            tokenAccount: true,
            verifiedAt: true,
            wallet: true,
          },
          where: { id: HOUSE_TREASURY_SNAPSHOT_ID },
        }),
      ]);
      unboundEscrowAlerts = alertCount;
      unresolvedTreasuryDiscrepancies = discrepancyCount;
      treasurySnapshot = snapshot;
    } catch {
      databaseReady = false;
    }
    let rpcVerifiedDevnet = true;
    try {
      await this.rpc.assertDevnet();
    } catch {
      rpcVerifiedDevnet = false;
    }
    const providerMode = process.env.DAILYDRAFT_PROVIDER_MODE ?? 'mock';
    const collectorRequired = providerMode === 'collector-crypt-sandbox';
    const demoRequired = providerMode === 'dailydraft-devnet';
    const demoCredentialConfigured = demoProviderConfigured();
    const limits = readRiskLimits();
    const treasuryConfig = readHouseTreasuryConfig();
    const treasuryConfigurationErrors = houseTreasuryConfigurationErrors(treasuryConfig);
    const treasurySnapshotFresh = Boolean(
      treasurySnapshot && houseTreasurySnapshotIsUsable(treasurySnapshot, treasuryConfig),
    );
    return {
      database: { reachable: databaseReady },
      recovery: {
        ready: unboundEscrowAlerts === 0,
        unboundEscrowAlerts,
      },
      provider: {
        configured:
          providerMode === 'mock' ||
          (demoRequired && demoCredentialConfigured) ||
          (collectorRequired && Boolean(process.env.COLLECTOR_CRYPT_API_KEY)),
        credentialConfigured:
          demoCredentialConfigured || Boolean(process.env.COLLECTOR_CRYPT_API_KEY),
        mode: providerMode,
        verified: providerMode === 'mock' || (demoRequired && demoCredentialConfigured),
      },
      rpc: {
        configured: Boolean(process.env.SOLANA_RPC_URL),
        reachable: rpcVerifiedDevnet,
        usesPublicDefault: !process.env.SOLANA_RPC_URL,
        verifiedDevnet: rpcVerifiedDevnet,
      },
      treasury: {
        configured: treasuryConfigurationErrors.length === 0,
        configurationErrors: treasuryConfigurationErrors,
        entryEnabled: limits.houseEnabled,
        escrowProgramIdConfigured: Boolean(process.env.ESCROW_PROGRAM_ID),
        finalizedBalanceSnapshotFresh: treasurySnapshotFresh,
        finalizedBalanceVerifiedAt: treasurySnapshot?.verifiedAt.toISOString() ?? null,
        fundingSignerConfigured: Boolean(treasuryConfig.fundingSigner),
        houseEnabled: limits.houseEnabled,
        houseWalletConfigured: Boolean(process.env.DAILYDRAFT_HOUSE_DEVNET_WALLET),
        separationOfDuties: Boolean(
          treasuryConfig.withdrawalAuthority &&
            treasuryConfig.withdrawalAuthority !== treasuryConfig.houseWallet &&
            treasuryConfig.withdrawalAuthority !== treasuryConfig.fundingSigner,
        ),
        usdcTokenAccountConfigured: Boolean(treasuryConfig.tokenAccount),
        unresolvedReconciliationDiscrepancies: unresolvedTreasuryDiscrepancies,
        verified:
          treasuryConfigurationErrors.length === 0 &&
          treasurySnapshotFresh &&
          unresolvedTreasuryDiscrepancies === 0,
        withdrawalAuthorityConfigured: Boolean(treasuryConfig.withdrawalAuthority),
      },
      workers: { cronSecretConfigured: Boolean(process.env.CRON_SECRET) },
    };
  }

  private activeDuelsForWallet(wallet: string): Promise<number> {
    return this.database.duel.count({
      where: {
        OR: [{ creatorWallet: wallet }, { opponentWallet: wallet }],
        status: { in: ACTIVE_DUEL_STATUSES },
      },
    });
  }
}

function demoProviderConfigured(): boolean {
  if (process.env.DAILYDRAFT_PROVIDER_ASSET_STANDARD !== 'legacy-spl-nft') return false;
  const expected = process.env.ESCROW_PROVIDER_SIGNER?.trim();
  const value = process.env.DAILYDRAFT_DEVNET_PROVIDER_KEYPAIR_JSON?.trim();
  if (!expected || !value) return false;
  try {
    const secret: unknown = JSON.parse(value);
    if (
      !Array.isArray(secret) ||
      secret.length !== 64 ||
      !secret.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ) {
      return false;
    }
    return Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey.toBase58() === expected;
  } catch {
    return false;
  }
}

export function readRiskLimits(environment: NodeJS.ProcessEnv = process.env): RiskLimits {
  const configuredTiers = environment.DAILYDRAFT_ALLOWED_TIERS;
  const allowed = (configuredTiers ?? '50')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => [25, 50, 100].includes(value));
  return {
    allowedTiers: [...new Set(configuredTiers === undefined ? [50] : allowed)].sort(
      (a, b) => a - b,
    ),
    houseEnabled: environment.DAILYDRAFT_HOUSE_ENABLED === 'true',
    maxActiveDuelsPerWallet: boundedInteger(
      environment.DAILYDRAFT_MAX_ACTIVE_DUELS_PER_WALLET,
      3,
      1,
      100,
    ),
    maxConcurrentDuelsPerTier: boundedInteger(
      environment.DAILYDRAFT_MAX_CONCURRENT_DUELS_PER_TIER,
      20,
      1,
      1_000,
    ),
  };
}

export function assertWithinRiskLimits(input: {
  limits: RiskLimits;
  tierActive: number;
  walletActive: number;
}): void {
  if (input.walletActive >= input.limits.maxActiveDuelsPerWallet) {
    throw new HttpException('Wallet active-duel limit reached', HttpStatus.TOO_MANY_REQUESTS);
  }
  if (input.tierActive >= input.limits.maxConcurrentDuelsPerTier) {
    throw new HttpException(
      'Pack-tier concurrent-duel limit reached',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export function isPauseNoop(
  current: { paused: boolean; reasonCode: DatabaseReasonCode | null } | null,
  paused: boolean,
  reasonCode: DatabaseReasonCode,
): boolean {
  return Boolean(current && current.paused === paused && current.reasonCode === reasonCode);
}

export function assertPauseVersionUpdated(count: number): void {
  if (count !== 1) throw new ConflictException('Emergency control changed concurrently');
}

function buildAttentionWhere(query: AdminDuelQuery, stuckBefore: Date): Prisma.DuelWhereInput {
  const stuck: Prisma.DuelWhereInput = {
    OR: [
      { fundedAt: { lt: stuckBefore }, status: DuelStatus.FUNDED },
      { transactions: { some: { stuckAt: { not: null } } } },
      {
        transactions: {
          some: { recoveredAt: null, recoveryCandidateAt: { not: null } },
        },
      },
    ],
  };
  const failed: Prisma.DuelWhereInput = {
    OR: [
      { status: DuelStatus.FAILED },
      {
        transactions: {
          some: { status: { in: [DuelTransactionStatus.FAILED, DuelTransactionStatus.EXPIRED] } },
        },
      },
    ],
  };
  return {
    AND: [
      query.attention === 'stuck'
        ? stuck
        : query.attention === 'failed'
          ? failed
          : { OR: [stuck, failed] },
      ...(query.duelId ? [{ id: query.duelId }] : []),
      ...(query.wallet
        ? [{ OR: [{ creatorWallet: query.wallet }, { opponentWallet: query.wallet }] }]
        : []),
      ...(query.signature ? [{ transactions: { some: { signature: query.signature } } }] : []),
      ...(query.providerReference
        ? [
            {
              OR: [
                { transactions: { some: { providerReference: query.providerReference } } },
                { packOutcomes: { some: { providerReference: query.providerReference } } },
              ],
            },
          ]
        : []),
      ...(query.assetReference
        ? [{ packOutcomes: { some: { assetReference: query.assetReference } } }]
        : []),
    ],
  };
}

function attentionReasons(
  duel: {
    fundedAt: Date | null;
    status: DuelStatus;
    transactions: Array<{
      recoveredAt: Date | null;
      recoveryCandidateAt: Date | null;
      status: DuelTransactionStatus;
      stuckAt: Date | null;
    }>;
  },
  stuckBefore: Date,
): string[] {
  const reasons = new Set<string>();
  if (duel.status === DuelStatus.FAILED) reasons.add('duel_failed');
  if (duel.status === DuelStatus.FUNDED && duel.fundedAt && duel.fundedAt < stuckBefore) {
    reasons.add('funded_stuck');
  }
  if (duel.transactions.some((transaction) => transaction.stuckAt))
    reasons.add('transaction_stuck');
  if (
    duel.transactions.some(
      (transaction) => transaction.recoveryCandidateAt && !transaction.recoveredAt,
    )
  ) {
    reasons.add('unbound_finalized_escrow');
  }
  if (
    duel.transactions.some(
      (transaction) =>
        transaction.status === DuelTransactionStatus.FAILED ||
        transaction.status === DuelTransactionStatus.EXPIRED,
    )
  ) {
    reasons.add('transaction_failed');
  }
  return [...reasons];
}

function toPauseState(
  control: {
    paused: boolean;
    reasonCode: DatabaseReasonCode | null;
    updatedAt: Date;
    version: number;
  } | null,
) {
  return {
    paused: control?.paused ?? false,
    reasonCode: control?.reasonCode?.toLowerCase() ?? null,
    updatedAt: control?.updatedAt.toISOString() ?? null,
    version: control?.version ?? 0,
  };
}

async function updateRuntimeControl(
  transaction: Prisma.TransactionClient,
  current: { key: string; version: number },
  paused: boolean,
  reasonCode: DatabaseReasonCode,
) {
  const changed = await transaction.runtimeControl.updateMany({
    data: {
      actorClass: OperatorActorClass.INTEGRATION_KEY,
      actorLabel: INTEGRATION_ACTOR_LABEL,
      paused,
      reasonCode,
      version: { increment: 1 },
    },
    where: { key: current.key, version: current.version },
  });
  assertPauseVersionUpdated(changed.count);
  return transaction.runtimeControl.findUniqueOrThrow({ where: { key: current.key } });
}

function toDatabaseReason(reason: OperatorReasonCode): DatabaseReasonCode {
  return DatabaseReasonCode[reason.toUpperCase() as keyof typeof DatabaseReasonCode];
}

function walletReference(wallet: string): string {
  return `wallet_${createHash('sha256').update(wallet).digest('hex').slice(0, 16)}`;
}

function stuckThresholdMinutes(): number {
  return boundedInteger(process.env.DAILYDRAFT_STUCK_FUNDED_MINUTES, 5, 1, 1_440);
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
