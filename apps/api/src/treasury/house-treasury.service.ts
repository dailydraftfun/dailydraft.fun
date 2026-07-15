import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type DatabaseClient,
  DuelStatus,
  HouseInventoryDisposition,
  HouseInventoryListingState,
  HouseInventoryStatus,
  HouseTreasuryLedgerType,
  HouseTreasuryReservationStatus,
  type Prisma,
} from '@openpacksduel/db';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway, SolanaRpcUnavailableError } from '../transactions/solana-rpc.client.js';
import type {
  CompleteHouseDispositionRequest,
  HouseDispositionRequest,
  HouseInventoryQuery,
} from './house-treasury.dto.js';
import {
  ACTIVE_HOUSE_RESERVATION_STATUSES,
  HOUSE_TREASURY_SNAPSHOT_ID,
  houseTreasuryConfigurationErrors,
  readHouseTreasuryConfig,
} from './house-treasury.policy.js';

const LIFECYCLE_BATCH_LIMIT = 100;

@Injectable()
export class HouseTreasuryService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly rpc: SolanaRpcGateway,
  ) {}

  async assertFundingAllowed(duelId: string): Promise<void> {
    const duel = await this.database.duel.findUnique({
      select: { houseOpponent: true },
      where: { id: duelId },
    });
    if (!duel?.houseOpponent) return;
    const reservation = await this.database.houseTreasuryReservation.findUnique({
      where: { duelId },
    });
    const fundingStatuses = new Set<HouseTreasuryReservationStatus>([
      HouseTreasuryReservationStatus.RESERVED,
      HouseTreasuryReservationStatus.FUNDED,
    ]);
    if (!reservation || !fundingStatuses.has(reservation.status)) {
      throw new ServiceUnavailableException(
        'House funding is disabled: no active treasury reservation',
      );
    }
  }

  async reconcile(limit = LIFECYCLE_BATCH_LIMIT) {
    const boundedLimit = Math.max(1, Math.min(limit, LIFECYCLE_BATCH_LIMIT));
    const lifecycle = await this.reconcileLifecycle(boundedLimit);
    const onChain = await this.reconcileOnChain(boundedLimit);
    return { lifecycle, onChain };
  }

  async reconcileLifecycle(limit = LIFECYCLE_BATCH_LIMIT) {
    const rows = await this.database.houseTreasuryReservation.findMany({
      include: {
        duel: { include: { packOutcomes: { orderBy: { side: 'asc' } } } },
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.max(1, Math.min(limit, LIFECYCLE_BATCH_LIMIT)),
      where: { status: { in: [...ACTIVE_HOUSE_RESERVATION_STATUSES] } },
    });
    const summary = { checked: 0, inventoryCreated: 0, released: 0, transitioned: 0 };
    for (const row of rows) {
      summary.checked += 1;
      const result = await this.database.$transaction(async (transaction) => {
        const current = await transaction.houseTreasuryReservation.findUnique({
          include: { duel: { include: { packOutcomes: { orderBy: { side: 'asc' } } } } },
          where: { id: row.id },
        });
        if (!current || !ACTIVE_HOUSE_RESERVATION_STATUSES.includes(current.status)) {
          return { inventoryCreated: 0, released: false, transitioned: false };
        }
        const target = reservationTarget(current.duel.status);
        if (!target || target === current.status) {
          return { inventoryCreated: 0, released: false, transitioned: false };
        }
        const now = new Date();
        const changed = await transaction.houseTreasuryReservation.updateMany({
          data: {
            ...(target === HouseTreasuryReservationStatus.FUNDED ? { fundedAt: now } : {}),
            ...(target === HouseTreasuryReservationStatus.RELEASED ? { releasedAt: now } : {}),
            ...(target === HouseTreasuryReservationStatus.SETTLED ? { settledAt: now } : {}),
            status: target,
            version: { increment: 1 },
          },
          where: { id: current.id, status: current.status, version: current.version },
        });
        if (changed.count !== 1)
          return { inventoryCreated: 0, released: false, transitioned: false };

        if (target === HouseTreasuryReservationStatus.RELEASED) {
          await appendLedger(transaction, {
            amount: current.amount,
            currency: current.currency,
            decimals: current.decimals,
            duelId: current.duelId,
            idempotencyKey: `reservation-released:${current.duelId}`,
            reservationId: current.id,
            type: HouseTreasuryLedgerType.RESERVATION_RELEASED,
          });
          return { inventoryCreated: 0, released: true, transitioned: true };
        }
        if (target === HouseTreasuryReservationStatus.FUNDED) {
          await appendLedger(transaction, {
            amount: current.amount,
            currency: current.currency,
            decimals: current.decimals,
            duelId: current.duelId,
            idempotencyKey: `house-funding-committed:${current.duelId}`,
            reservationId: current.id,
            type: HouseTreasuryLedgerType.HOUSE_FUNDING_COMMITTED,
          });
        }
        if (target !== HouseTreasuryReservationStatus.SETTLED) {
          return { inventoryCreated: 0, released: false, transitioned: true };
        }
        if (current.duel.winnerWallet !== current.duel.opponentWallet) {
          await appendLedger(transaction, {
            amount: current.amount,
            currency: current.currency,
            decimals: current.decimals,
            duelId: current.duelId,
            idempotencyKey: `player-win-loss:${current.duelId}`,
            reservationId: current.id,
            type: HouseTreasuryLedgerType.PLAYER_WIN_LOSS,
          });
          return { inventoryCreated: 0, released: false, transitioned: true };
        }
        await appendLedger(transaction, {
          amount: current.amount,
          currency: current.currency,
          decimals: current.decimals,
          duelId: current.duelId,
          idempotencyKey: `house-pack-cost:${current.duelId}`,
          reservationId: current.id,
          type: HouseTreasuryLedgerType.HOUSE_PACK_COST,
        });
        let inventoryCreated = 0;
        for (const outcome of current.duel.packOutcomes) {
          const existing = await transaction.houseInventoryAsset.findUnique({
            where: { outcomeId: outcome.id },
          });
          if (existing) continue;
          const inventoryId = createId('hinv');
          await transaction.houseInventoryAsset.create({
            data: {
              acquisitionValueAmount: outcome.insuredValueAmount,
              acquisitionValueCurrency: outcome.insuredValueCurrency,
              acquisitionValueDecimals: outcome.insuredValueDecimals,
              assetReference: outcome.assetReference,
              custodyWallet: current.duel.opponentWallet ?? '',
              displayName: outcome.displayName,
              disposition: HouseInventoryDisposition.MANUAL_REVIEW,
              duelId: current.duelId,
              id: inventoryId,
              outcomeId: outcome.id,
            },
          });
          await appendLedger(transaction, {
            amount: outcome.insuredValueAmount,
            currency: outcome.insuredValueCurrency,
            decimals: outcome.insuredValueDecimals,
            duelId: current.duelId,
            idempotencyKey: `house-win-inventory:${outcome.id}`,
            inventoryId,
            reservationId: current.id,
            type: HouseTreasuryLedgerType.HOUSE_WIN_INVENTORY,
          });
          inventoryCreated += 1;
        }
        return { inventoryCreated, released: false, transitioned: true };
      });
      summary.inventoryCreated += result.inventoryCreated;
      if (result.released) summary.released += 1;
      if (result.transitioned) summary.transitioned += 1;
    }
    return summary;
  }

  async reconcileOnChain(limit = LIFECYCLE_BATCH_LIMIT) {
    const config = readHouseTreasuryConfig();
    const errors = houseTreasuryConfigurationErrors(config).filter(
      (error) => error !== 'house_disabled',
    );
    if (errors.length > 0) {
      throw new ServiceUnavailableException(`House treasury is unavailable: ${errors.join(', ')}`);
    }
    await this.rpc.assertDevnet();
    const mint = await this.rpc.getLegacyMint(config.usdcMint ?? '');
    const account = await this.rpc.getLegacyTokenAccount(config.tokenAccount ?? '');
    if (
      mint.decimals !== 6 ||
      account.mint !== config.usdcMint ||
      account.owner !== config.houseWallet
    ) {
      throw new ServiceUnavailableException('Finalized house USDC account does not match policy');
    }
    const verifiedAt = new Date();
    await this.database.houseTreasurySnapshot.upsert({
      create: {
        balanceAmount: account.amount.toString(),
        balanceDecimals: mint.decimals,
        id: HOUSE_TREASURY_SNAPSHOT_ID,
        mint: account.mint,
        tokenAccount: config.tokenAccount ?? '',
        verifiedAt,
        wallet: account.owner,
      },
      update: {
        balanceAmount: account.amount.toString(),
        balanceDecimals: mint.decimals,
        mint: account.mint,
        tokenAccount: config.tokenAccount ?? '',
        verifiedAt,
        wallet: account.owner,
      },
      where: { id: HOUSE_TREASURY_SNAPSHOT_ID },
    });

    const inventory = await this.database.houseInventoryAsset.findMany({
      orderBy: { updatedAt: 'asc' },
      take: Math.max(1, Math.min(limit, LIFECYCLE_BATCH_LIMIT)),
      where: {
        status: {
          in: [
            HouseInventoryStatus.HELD,
            HouseInventoryStatus.LISTED,
            HouseInventoryStatus.RECONCILIATION_REQUIRED,
          ],
        },
      },
    });
    let mismatched = 0;
    let verified = 0;
    for (const asset of inventory) {
      const verification = await this.verifyInventoryAsset(
        asset.assetReference,
        asset.custodyWallet,
      );
      const status = verification.ok
        ? asset.listingState === HouseInventoryListingState.LISTED
          ? HouseInventoryStatus.LISTED
          : HouseInventoryStatus.HELD
        : HouseInventoryStatus.RECONCILIATION_REQUIRED;
      const changed = await this.database.$transaction(async (transaction) => {
        const update = await transaction.houseInventoryAsset.updateMany({
          data: {
            lastReconciledAt: verifiedAt,
            reconciliationError: verification.error,
            status,
            version: { increment: 1 },
          },
          where: { id: asset.id, version: asset.version },
        });
        if (update.count !== 1) return false;
        if (!verification.ok) {
          await appendLedger(transaction, {
            amount: asset.acquisitionValueAmount,
            currency: asset.acquisitionValueCurrency,
            decimals: asset.acquisitionValueDecimals,
            duelId: asset.duelId,
            idempotencyKey: `reconciliation-alert:${asset.id}:${asset.version + 1}`,
            inventoryId: asset.id,
            metadata: { code: verification.error ?? 'custody_unverified' },
            type: HouseTreasuryLedgerType.RECONCILIATION_ALERT,
          });
        }
        return true;
      });
      if (!changed) continue;
      if (verification.ok) verified += 1;
      else mismatched += 1;
    }
    return {
      balanceAmount: account.amount.toString(),
      balanceDecimals: mint.decimals,
      inventoryChecked: inventory.length,
      inventoryMismatched: mismatched,
      inventoryVerified: verified,
      verifiedAt: verifiedAt.toISOString(),
    };
  }

  async getSummary() {
    const config = readHouseTreasuryConfig();
    const [snapshot, reservations, inventory, ledger] = await Promise.all([
      this.database.houseTreasurySnapshot.findUnique({
        where: { id: HOUSE_TREASURY_SNAPSHOT_ID },
      }),
      this.database.houseTreasuryReservation.findMany({
        select: { amount: true, status: true, tier: true },
      }),
      this.database.houseInventoryAsset.findMany({
        select: {
          acquisitionValueAmount: true,
          acquisitionValueDecimals: true,
          assetReference: true,
          realizedAmount: true,
          realizedDecimals: true,
          status: true,
        },
      }),
      this.database.houseTreasuryLedgerEntry.findMany({
        select: { amount: true, createdAt: true, type: true },
      }),
    ]);
    const active = reservations.filter((row) =>
      ACTIVE_HOUSE_RESERVATION_STATUSES.includes(row.status),
    );
    const totalExposure = sum(active.map((row) => row.amount));
    const balance = snapshot ? storedAmount(snapshot.balanceAmount) : 0n;
    const available = balance > totalExposure ? balance - totalExposure : 0n;
    const tierCounts = new Map<number, number>();
    for (const reservation of active) {
      tierCounts.set(reservation.tier, (tierCounts.get(reservation.tier) ?? 0) + 1);
    }
    const dailyLoss = sum(
      ledger
        .filter(
          (entry) =>
            entry.type === HouseTreasuryLedgerType.PLAYER_WIN_LOSS &&
            entry.createdAt >= startOfUtcDay(new Date()),
        )
        .map((entry) => entry.amount),
    );
    const realizedProceeds = sum(
      inventory.flatMap((asset) => (asset.realizedAmount ? [asset.realizedAmount] : [])),
    );
    const costTypes = new Set<HouseTreasuryLedgerType>([
      HouseTreasuryLedgerType.PLAYER_WIN_LOSS,
      HouseTreasuryLedgerType.HOUSE_PACK_COST,
    ]);
    const realizedCosts = sum(
      ledger.filter((entry) => costTypes.has(entry.type)).map((entry) => entry.amount),
    );
    const heldValue = sum(
      inventory
        .filter((asset) => asset.status !== HouseInventoryStatus.DISPOSED)
        .map((asset) => asset.acquisitionValueAmount),
    );
    const configurationErrors = houseTreasuryConfigurationErrors(config);
    const snapshotFresh = Boolean(
      snapshot && Date.now() - snapshot.verifiedAt.getTime() <= config.snapshotMaxAgeMs,
    );
    return {
      configuration: {
        allowedDispositions: config.allowedDispositions,
        errors: configurationErrors,
        fundingSignerConfigured: Boolean(config.fundingSigner),
        houseEnabled: config.enabled,
        hotWalletConfigured: Boolean(config.houseWallet),
        network: config.network,
        separationOfDuties: Boolean(
          config.withdrawalAuthority &&
            config.withdrawalAuthority !== config.houseWallet &&
            config.withdrawalAuthority !== config.fundingSigner,
        ),
        withdrawalAuthorityConfigured: Boolean(config.withdrawalAuthority),
      },
      inventory: {
        concentration: concentration(inventory),
        heldAssets: inventory.filter((asset) => asset.status !== HouseInventoryStatus.DISPOSED)
          .length,
        heldValueAmount: heldValue.toString(),
        realizedCostAmount: realizedCosts.toString(),
        realizedPnlAmount: (realizedProceeds - realizedCosts).toString(),
        realizedProceedsAmount: realizedProceeds.toString(),
      },
      liquidity: {
        availableAmount: available.toString(),
        balanceAmount: snapshot?.balanceAmount ?? null,
        decimals: snapshot?.balanceDecimals ?? 6,
        minimumAmount: config.minimumLiquidity.toString(),
        snapshotFresh,
        verifiedAt: snapshot?.verifiedAt.toISOString() ?? null,
      },
      pendingGames: active.length,
      pendingGamesByStatus: Object.fromEntries(
        ACTIVE_HOUSE_RESERVATION_STATUSES.map((status) => [
          status.toLowerCase(),
          active.filter((reservation) => reservation.status === status).length,
        ]),
      ),
      risk: {
        dailyLossAmount: dailyLoss.toString(),
        dailyLossLimitAmount: config.dailyLossLimit.toString(),
        disableReasons: [
          ...configurationErrors,
          ...(!snapshotFresh ? ['treasury_snapshot_stale'] : []),
          ...(dailyLoss >= config.dailyLossLimit ? ['daily_loss_limit'] : []),
          ...(totalExposure >= config.maxTotalExposure ? ['total_exposure_limit'] : []),
          ...(available <= config.minimumLiquidity ? ['minimum_liquidity'] : []),
        ],
        maxTotalExposureAmount: config.maxTotalExposure.toString(),
        totalExposureAmount: totalExposure.toString(),
        tiers: [...tierCounts.entries()].map(([tier, pendingGames]) => ({ pendingGames, tier })),
      },
      ready: configurationErrors.length === 0 && snapshotFresh,
    };
  }

  async listInventory(query: HouseInventoryQuery) {
    const rows = await this.database.houseInventoryAsset.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      where: query.status
        ? {
            status:
              HouseInventoryStatus[query.status.toUpperCase() as keyof typeof HouseInventoryStatus],
          }
        : {},
    });
    return {
      data: rows.map((row) => ({
        acquisitionValue: {
          amount: row.acquisitionValueAmount,
          currency: row.acquisitionValueCurrency,
          decimals: row.acquisitionValueDecimals,
        },
        assetReference: row.assetReference,
        buybackEligible: row.buybackEligible,
        buybackExpiresAt: row.buybackExpiresAt?.toISOString() ?? null,
        custodyWallet: row.custodyWallet,
        disposition: row.disposition.toLowerCase(),
        displayName: row.displayName,
        duelId: row.duelId,
        id: row.id,
        lastReconciledAt: row.lastReconciledAt?.toISOString() ?? null,
        listingState: row.listingState.toLowerCase(),
        reconciliationError: row.reconciliationError,
        status: row.status.toLowerCase(),
      })),
    };
  }

  async setDisposition(inventoryId: string, input: HouseDispositionRequest) {
    const config = readHouseTreasuryConfig();
    if (!config.allowedDispositions.includes(input.disposition)) {
      throw new ConflictException('Inventory disposition is disabled by treasury policy');
    }
    return this.database.$transaction(async (transaction) => {
      const row = await transaction.houseInventoryAsset.findUnique({ where: { id: inventoryId } });
      if (!row) throw new NotFoundException(`Inventory asset ${inventoryId} was not found`);
      if (row.status === HouseInventoryStatus.DISPOSED) {
        throw new ConflictException('Disposed inventory cannot be reassigned');
      }
      const changed = await transaction.houseInventoryAsset.updateMany({
        data: {
          disposition: toDisposition(input.disposition),
          version: { increment: 1 },
        },
        where: { id: row.id, version: row.version },
      });
      if (changed.count !== 1) throw new ConflictException('Inventory state changed');
      await appendLedger(transaction, {
        amount: row.acquisitionValueAmount,
        currency: row.acquisitionValueCurrency,
        decimals: row.acquisitionValueDecimals,
        duelId: row.duelId,
        idempotencyKey: `inventory-disposition:${row.id}:${row.version + 1}`,
        inventoryId: row.id,
        metadata: { disposition: input.disposition, reason: input.reason },
        type: HouseTreasuryLedgerType.INVENTORY_DISPOSITION_SET,
      });
      return transaction.houseInventoryAsset.findUniqueOrThrow({ where: { id: row.id } });
    });
  }

  async completeDisposition(inventoryId: string, input: CompleteHouseDispositionRequest) {
    return this.database.$transaction(async (transaction) => {
      const row = await transaction.houseInventoryAsset.findUnique({ where: { id: inventoryId } });
      if (!row) throw new NotFoundException(`Inventory asset ${inventoryId} was not found`);
      if (row.status === HouseInventoryStatus.DISPOSED) return row;
      if (row.status === HouseInventoryStatus.RECONCILIATION_REQUIRED) {
        throw new ConflictException('Inventory custody must reconcile before disposition');
      }
      const changed = await transaction.houseInventoryAsset.updateMany({
        data: {
          disposedAt: new Date(),
          listingState:
            row.disposition === HouseInventoryDisposition.LIST
              ? HouseInventoryListingState.SOLD
              : row.listingState,
          realizedAmount: input.realizedAmount,
          realizedCurrency: input.realizedCurrency,
          realizedDecimals: input.realizedDecimals,
          status: HouseInventoryStatus.DISPOSED,
          version: { increment: 1 },
        },
        where: { id: row.id, status: row.status, version: row.version },
      });
      if (changed.count !== 1) throw new ConflictException('Inventory state changed');
      await appendLedger(transaction, {
        amount: input.realizedAmount,
        currency: input.realizedCurrency,
        decimals: input.realizedDecimals,
        duelId: row.duelId,
        idempotencyKey: `inventory-disposed:${row.id}`,
        inventoryId: row.id,
        metadata: { disposition: row.disposition.toLowerCase(), reason: input.reason },
        type: HouseTreasuryLedgerType.INVENTORY_DISPOSED,
      });
      return transaction.houseInventoryAsset.findUniqueOrThrow({ where: { id: row.id } });
    });
  }

  private async verifyInventoryAsset(
    assetReference: string,
    custodyWallet: string,
  ): Promise<{ error: string | null; ok: boolean }> {
    try {
      const mint = new PublicKey(assetReference);
      const owner = new PublicKey(custodyWallet);
      const tokenAccount = getAssociatedTokenAddressSync(mint, owner);
      const account = await this.rpc.getLegacyTokenAccount(tokenAccount.toBase58());
      const canonicalMint = await this.rpc.getLegacyMint(mint.toBase58());
      if (
        account.amount !== 1n ||
        account.mint !== mint.toBase58() ||
        account.owner !== owner.toBase58() ||
        canonicalMint.decimals !== 0 ||
        canonicalMint.supply !== 1n
      ) {
        return { error: 'custody_mismatch', ok: false };
      }
      return { error: null, ok: true };
    } catch (error) {
      return {
        error: error instanceof SolanaRpcUnavailableError ? 'rpc_unverified' : 'invalid_asset',
        ok: false,
      };
    }
  }
}

export function reservationTarget(status: DuelStatus): HouseTreasuryReservationStatus | null {
  switch (status) {
    case DuelStatus.CANCELLED:
    case DuelStatus.REFUNDED:
      return HouseTreasuryReservationStatus.RELEASED;
    case DuelStatus.CANCELLING:
    case DuelStatus.REFUNDING:
    case DuelStatus.FAILED:
      return HouseTreasuryReservationStatus.RECOVERY_REQUIRED;
    case DuelStatus.FUNDED:
    case DuelStatus.OPENING:
      return HouseTreasuryReservationStatus.FUNDED;
    case DuelStatus.AWAITING_ASSETS:
    case DuelStatus.SETTLING:
      return HouseTreasuryReservationStatus.SETTLEMENT_PENDING;
    case DuelStatus.SETTLED:
      return HouseTreasuryReservationStatus.SETTLED;
    default:
      return null;
  }
}

async function appendLedger(
  transaction: Prisma.TransactionClient,
  input: {
    amount: string;
    currency: string;
    decimals: number;
    duelId?: string;
    idempotencyKey: string;
    inventoryId?: string;
    metadata?: Prisma.InputJsonValue;
    reservationId?: string;
    type: HouseTreasuryLedgerType;
  },
): Promise<void> {
  const existing = await transaction.houseTreasuryLedgerEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return;
  await transaction.houseTreasuryLedgerEntry.create({
    data: {
      amount: input.amount,
      currency: input.currency,
      decimals: input.decimals,
      ...(input.duelId ? { duelId: input.duelId } : {}),
      id: createId('hled'),
      idempotencyKey: input.idempotencyKey,
      ...(input.inventoryId ? { inventoryId: input.inventoryId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.reservationId ? { reservationId: input.reservationId } : {}),
      type: input.type,
    },
  });
}

function toDisposition(value: HouseDispositionRequest['disposition']): HouseInventoryDisposition {
  return HouseInventoryDisposition[value.toUpperCase() as keyof typeof HouseInventoryDisposition];
}

function storedAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new ServiceUnavailableException('Invalid treasury amount');
  return BigInt(value);
}

function sum(values: string[]): bigint {
  return values.reduce((total, value) => total + storedAmount(value), 0n);
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function concentration(
  assets: Array<{
    acquisitionValueAmount: string;
    assetReference: string;
    status: HouseInventoryStatus;
  }>,
) {
  const active = assets.filter((asset) => asset.status !== HouseInventoryStatus.DISPOSED);
  const total = sum(active.map((asset) => asset.acquisitionValueAmount));
  const byAsset = new Map<string, bigint>();
  for (const asset of active) {
    byAsset.set(
      asset.assetReference,
      (byAsset.get(asset.assetReference) ?? 0n) + storedAmount(asset.acquisitionValueAmount),
    );
  }
  const largest = [...byAsset.values()].reduce(
    (maximum, value) => (value > maximum ? value : maximum),
    0n,
  );
  return {
    largestAssetBasisPoints: total === 0n ? 0 : Number((largest * 10_000n) / total),
    uniqueAssets: byAsset.size,
  };
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
