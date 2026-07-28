import {
  type DatabaseClient,
  DuelSide,
  DuelStatus,
  HouseInventoryDisposition,
  HouseInventoryListingState,
  HouseInventoryStatus,
  HouseTreasuryLedgerType,
  HouseTreasuryReservationSource,
  HouseTreasuryReservationStatus,
  type Prisma,
} from '@dailydraft/db';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import {
  acquireAdvisoryTransactionLock,
  acquireNamespacedAdvisoryTransactionLock,
} from '../database/advisory-lock.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway, SolanaRpcUnavailableError } from '../transactions/solana-rpc.client.js';
import { assertHouseProviderEvidence, providerReferenceKey } from './house-provider-evidence.js';
import type {
  CompleteHouseDispositionRequest,
  DelistHouseInventoryRequest,
  HouseDispositionRequest,
  HouseInventoryQuery,
} from './house-treasury.dto.js';
import {
  ACTIVE_HOUSE_RESERVATION_STATUSES,
  HOUSE_TREASURY_EXPOSURE_LOCK_KEY,
  HOUSE_TREASURY_SNAPSHOT_ID,
  type HouseTreasuryConfig,
  houseTreasuryConfigurationErrors,
  houseTreasurySnapshotIsUsable,
  readHouseTreasuryConfig,
} from './house-treasury.policy.js';

const LIFECYCLE_BATCH_LIMIT = 100;
const HOUSE_INVENTORY_LOCK_NAMESPACE = 1_324_771_909;
const HOUSE_TREASURY_RECONCILIATION_LOCK_NAMESPACE = 1_324_771_910;
const HOUSE_INVENTORY_DISPOSITION_LOCK_NAMESPACE = 1_324_771_911;

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
      orderBy: [{ lastReconciledAt: { nulls: 'first', sort: 'asc' } }, { id: 'asc' }],
      take: Math.max(1, Math.min(limit, LIFECYCLE_BATCH_LIMIT)),
      where: {
        duelId: { not: null },
        status: { in: [...ACTIVE_HOUSE_RESERVATION_STATUSES] },
      },
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
        const now = new Date();
        if (!current.duel || !current.duelId) {
          throw new ServiceUnavailableException('Duel treasury reservation binding is incomplete');
        }
        const duelId = current.duelId;
        const resolution = houseReservationResolution(current.duel);
        const target = resolution.target;
        if (!target || target === current.status) {
          await transaction.houseTreasuryReservation.updateMany({
            data: { lastReconciledAt: now, version: { increment: 1 } },
            where: { id: current.id, status: current.status, version: current.version },
          });
          return { inventoryCreated: 0, released: false, transitioned: false };
        }
        const changed = await transaction.houseTreasuryReservation.updateMany({
          data: {
            ...(target === HouseTreasuryReservationStatus.FUNDED ? { fundedAt: now } : {}),
            ...(target === HouseTreasuryReservationStatus.RELEASED ? { releasedAt: now } : {}),
            ...(target === HouseTreasuryReservationStatus.SETTLED ? { settledAt: now } : {}),
            lastReconciledAt: now,
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
            duelId,
            idempotencyKey: `reservation-released:${duelId}`,
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
            duelId,
            idempotencyKey: `house-funding-committed:${duelId}`,
            reservationId: current.id,
            type: HouseTreasuryLedgerType.HOUSE_FUNDING_COMMITTED,
          });
        }
        if (target !== HouseTreasuryReservationStatus.SETTLED) {
          return { inventoryCreated: 0, released: false, transitioned: true };
        }
        if (resolution.ledgerType === HouseTreasuryLedgerType.PLAYER_WIN_LOSS) {
          await appendLedger(transaction, {
            amount: current.amount,
            currency: current.currency,
            decimals: current.decimals,
            duelId,
            idempotencyKey: `player-win-loss:${duelId}`,
            metadata: { reason: resolution.reason },
            reservationId: current.id,
            type: HouseTreasuryLedgerType.PLAYER_WIN_LOSS,
          });
          return { inventoryCreated: 0, released: false, transitioned: true };
        }
        if (
          resolution.ledgerType !== HouseTreasuryLedgerType.HOUSE_PACK_COST ||
          !resolution.custodyWallet ||
          !resolution.reason ||
          resolution.reason === 'player_win'
        ) {
          throw new ServiceUnavailableException('House terminal accounting is incomplete');
        }
        await appendLedger(transaction, {
          amount: current.amount,
          currency: current.currency,
          decimals: current.decimals,
          duelId,
          idempotencyKey: `house-pack-cost:${duelId}`,
          metadata: { reason: resolution.reason },
          reservationId: current.id,
          type: HouseTreasuryLedgerType.HOUSE_PACK_COST,
        });
        let inventoryCreated = 0;
        for (const outcome of current.duel.packOutcomes.filter((candidate) =>
          resolution.inventorySides.includes(candidate.side),
        )) {
          const acquired = await acquireHouseInventoryAsset(transaction, {
            custodyWallet: resolution.custodyWallet,
            duelId,
            outcome,
            reason: resolution.reason,
            reservationId: current.id,
          });
          if (acquired.created) inventoryCreated += 1;
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
    const observedSlot = await this.rpc.getFinalizedSlot();
    if (
      mint.decimals !== 6 ||
      account.mint !== config.usdcMint ||
      account.owner !== config.withdrawalAuthority ||
      !account.delegate ||
      account.delegate !== config.fundingSigner ||
      account.delegatedAmount <= 0n ||
      account.delegatedAmount > config.maxTotalExposure ||
      account.delegatedAmount > account.amount
    ) {
      throw new ServiceUnavailableException(
        'Finalized house USDC account owner or bounded delegate does not match policy',
      );
    }
    const delegate = account.delegate;
    const verifiedAt = new Date();
    const treasuryDiscrepancies = await this.database.$transaction(async (transaction) => {
      await acquireAdvisoryTransactionLock(transaction, HOUSE_TREASURY_EXPOSURE_LOCK_KEY);
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        HOUSE_TREASURY_SNAPSHOT_ID,
        HOUSE_TREASURY_RECONCILIATION_LOCK_NAMESPACE,
      );
      const previousSnapshot = await transaction.houseTreasurySnapshot.findUnique({
        where: { id: HOUSE_TREASURY_SNAPSHOT_ID },
      });
      if (previousSnapshot && storedAmount(previousSnapshot.observedSlot) >= observedSlot) {
        throw new ServiceUnavailableException(
          'Finalized treasury observation did not advance beyond recorded state',
        );
      }

      let discrepancyCount = 0;
      if (previousSnapshot) {
        const unresolvedDiscrepancy = await transaction.houseReconciliationDiscrepancy.findFirst({
          orderBy: [{ lastObservedAt: 'desc' }, { id: 'desc' }],
          select: { expectedValue: true, lastObservedAt: true },
          where: {
            entityReference: HOUSE_TREASURY_SNAPSHOT_ID,
            kind: 'treasury_balance',
            resolvedAt: null,
          },
        });
        const ledgerSinceSnapshot = await transaction.houseTreasuryLedgerEntry.findMany({
          select: { amount: true, type: true },
          where: {
            createdAt: {
              gt: unresolvedDiscrepancy?.lastObservedAt ?? previousSnapshot.verifiedAt,
            },
          },
        });
        const expectedBalance = ledgerSinceSnapshot.reduce(
          (balance, entry) =>
            entry.type === HouseTreasuryLedgerType.INVENTORY_DISPOSED
              ? balance + storedAmount(entry.amount)
              : entry.type === HouseTreasuryLedgerType.PLAYER_WIN_LOSS ||
                  entry.type === HouseTreasuryLedgerType.HOUSE_PACK_COST
                ? balance - storedAmount(entry.amount)
                : balance,
          storedAmount(unresolvedDiscrepancy?.expectedValue ?? previousSnapshot.balanceAmount),
        );
        if (expectedBalance !== account.amount) {
          discrepancyCount = 1;
          await recordReconciliationDiscrepancy(transaction, {
            detail: 'Finalized treasury balance differs from append-only ledger movement',
            entityReference: HOUSE_TREASURY_SNAPSHOT_ID,
            expectedValue: expectedBalance.toString(),
            kind: 'treasury_balance',
            observedSlot: observedSlot.toString(),
            observedValue: account.amount.toString(),
            verifiedAt,
          });
        } else {
          await resolveReconciliationDiscrepancies(
            transaction,
            'treasury_balance',
            HOUSE_TREASURY_SNAPSHOT_ID,
            verifiedAt,
          );
        }
      }

      await transaction.houseTreasurySnapshot.upsert({
        create: {
          balanceAmount: account.amount.toString(),
          balanceDecimals: mint.decimals,
          delegate,
          delegatedAmount: account.delegatedAmount.toString(),
          id: HOUSE_TREASURY_SNAPSHOT_ID,
          mint: account.mint,
          observedSlot: observedSlot.toString(),
          tokenAccount: config.tokenAccount ?? '',
          verifiedAt,
          wallet: account.owner,
        },
        update: {
          balanceAmount: account.amount.toString(),
          balanceDecimals: mint.decimals,
          delegate,
          delegatedAmount: account.delegatedAmount.toString(),
          mint: account.mint,
          observedSlot: observedSlot.toString(),
          tokenAccount: config.tokenAccount ?? '',
          verifiedAt,
          wallet: account.owner,
        },
        where: { id: HOUSE_TREASURY_SNAPSHOT_ID },
      });
      return discrepancyCount;
    });

    const inventory = await this.database.houseInventoryAsset.findMany({
      orderBy: [{ lastReconciledAt: { nulls: 'first', sort: 'asc' } }, { id: 'asc' }],
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
        await acquireAdvisoryTransactionLock(transaction, HOUSE_TREASURY_EXPOSURE_LOCK_KEY);
        await acquireNamespacedAdvisoryTransactionLock(
          transaction,
          asset.assetReference,
          HOUSE_INVENTORY_LOCK_NAMESPACE,
        );
        const update = await transaction.houseInventoryAsset.updateMany({
          data: {
            lastReconciledAt: verifiedAt,
            lastReconciledSlot: observedSlot.toString(),
            reconciliationError: verification.error,
            status,
            version: { increment: 1 },
          },
          where: { id: asset.id, version: asset.version },
        });
        if (update.count !== 1) return false;
        if (!verification.ok) {
          await recordReconciliationDiscrepancy(transaction, {
            detail: verification.error ?? 'Inventory custody could not be verified',
            entityReference: asset.id,
            expectedValue: '1',
            kind: 'inventory_custody',
            observedSlot: observedSlot.toString(),
            observedValue: '0',
            verifiedAt,
          });
          await appendLedger(transaction, {
            amount: asset.acquisitionValueAmount,
            ...(asset.crashRoundId ? { crashRoundId: asset.crashRoundId } : {}),
            currency: asset.acquisitionValueCurrency,
            decimals: asset.acquisitionValueDecimals,
            ...(asset.duelId ? { duelId: asset.duelId } : {}),
            idempotencyKey: `reconciliation-alert:${asset.id}:${observedSlot}`,
            inventoryId: asset.id,
            metadata: { code: verification.error ?? 'custody_unverified' },
            type: HouseTreasuryLedgerType.RECONCILIATION_ALERT,
          });
        } else {
          await resolveReconciliationDiscrepancies(
            transaction,
            'inventory_custody',
            asset.id,
            verifiedAt,
          );
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
      observedSlot: observedSlot.toString(),
      treasuryDiscrepancies,
      verifiedAt: verifiedAt.toISOString(),
    };
  }

  async getSummary() {
    const config = readHouseTreasuryConfig();
    const [snapshot, reservations, inventory, ledger, tierAdmissionStates, discrepancies] =
      await Promise.all([
        this.database.houseTreasurySnapshot.findUnique({
          where: { id: HOUSE_TREASURY_SNAPSHOT_ID },
        }),
        this.database.houseTreasuryReservation.findMany({
          select: { amount: true, source: true, status: true, tier: true },
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
        this.database.houseTierAdmissionState.findMany({ orderBy: { tier: 'asc' } }),
        this.database.houseReconciliationDiscrepancy.findMany({
          orderBy: [{ firstObservedAt: 'asc' }, { id: 'asc' }],
          take: 100,
          where: { resolvedAt: null },
        }),
      ]);
    const active = reservations.filter((row) =>
      ACTIVE_HOUSE_RESERVATION_STATUSES.includes(row.status),
    );
    const totalExposure = sum(active.map((row) => row.amount));
    const balance = snapshot ? storedAmount(snapshot.balanceAmount) : 0n;
    const delegated = snapshot ? storedAmount(snapshot.delegatedAmount) : 0n;
    const usableCapacity = balance < delegated ? balance : delegated;
    const available = usableCapacity > totalExposure ? usableCapacity - totalExposure : 0n;
    const tierCounts = new Map<number, number>();
    for (const reservation of active) {
      if (reservation.source === HouseTreasuryReservationSource.CRASH) continue;
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
    const snapshotFresh = Boolean(snapshot && houseTreasurySnapshotIsUsable(snapshot, config));
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
        delegatedAmount: snapshot?.delegatedAmount ?? null,
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
      reconciliation: {
        discrepancies: discrepancies.map((row) => ({
          detail: row.detail,
          entityReference: row.entityReference,
          expectedValue: row.expectedValue,
          firstObservedAt: row.firstObservedAt.toISOString(),
          kind: row.kind,
          lastObservedAt: row.lastObservedAt.toISOString(),
          observedSlot: row.observedSlot,
          observedValue: row.observedValue,
        })),
        observedSlot: snapshot?.observedSlot ?? null,
        verifiedAt: snapshot?.verifiedAt.toISOString() ?? null,
      },
      risk: {
        dailyLossAmount: dailyLoss.toString(),
        dailyLossLimitAmount: config.dailyLossLimit.toString(),
        disableReasons: [
          ...configurationErrors,
          ...(discrepancies.length > 0 ? ['reconciliation_discrepancy'] : []),
          ...(!snapshotFresh ? ['treasury_snapshot_stale'] : []),
          ...(dailyLoss >= config.dailyLossLimit ? ['daily_loss_limit'] : []),
          ...(totalExposure >= config.maxTotalExposure ? ['total_exposure_limit'] : []),
          ...(available <= config.minimumLiquidity ? ['minimum_liquidity'] : []),
        ],
        maxTotalExposureAmount: config.maxTotalExposure.toString(),
        tierAdmissionStates: tierAdmissionStates.map((state) => ({
          disabled: state.disabled,
          evaluatedAt: state.evaluatedAt.toISOString(),
          reason: state.reason,
          reenableBoundary: state.reenableBoundary,
          tier: state.tier,
          version: state.version,
        })),
        totalExposureAmount: totalExposure.toString(),
        tiers: [...tierCounts.entries()].map(([tier, pendingGames]) => ({ pendingGames, tier })),
      },
      ready: configurationErrors.length === 0 && discrepancies.length === 0 && snapshotFresh,
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
        buybackValue: optionalStoredMoney(
          row.buybackValueAmount,
          row.buybackValueCurrency,
          row.buybackValueDecimals,
        ),
        custodyWallet: row.custodyWallet,
        disposition: row.disposition.toLowerCase(),
        dispositionReason: row.dispositionReason,
        dispositionRequestedAt: row.dispositionRequestedAt?.toISOString() ?? null,
        displayName: row.displayName,
        displayedValue: optionalStoredMoney(
          row.displayedValueAmount,
          row.displayedValueCurrency,
          row.displayedValueDecimals,
        ),
        duelId: row.duelId,
        id: row.id,
        insuredValue: {
          amount: row.insuredValueAmount,
          currency: row.insuredValueCurrency,
          decimals: row.insuredValueDecimals,
        },
        lastReconciledAt: row.lastReconciledAt?.toISOString() ?? null,
        listingValue: optionalStoredMoney(
          row.listingValueAmount,
          row.listingValueCurrency,
          row.listingValueDecimals,
        ),
        listingState: row.listingState.toLowerCase(),
        realizedFeeAmount: row.realizedFeeAmount,
        realizedGainLossAmount: row.realizedGainLossAmount,
        reconciliationError: row.reconciliationError,
        status: row.status.toLowerCase(),
      })),
    };
  }

  async setDisposition(inventoryId: string, input: HouseDispositionRequest) {
    const config = readHouseTreasuryConfig();
    return this.database.$transaction(async (transaction) => {
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        inventoryId,
        HOUSE_INVENTORY_DISPOSITION_LOCK_NAMESPACE,
      );
      const row = await transaction.houseInventoryAsset.findUnique({ where: { id: inventoryId } });
      if (!row) throw new NotFoundException(`Inventory asset ${inventoryId} was not found`);
      const idempotencyKey = `inventory-disposition:${input.operationKey}`;
      const replay = await transaction.houseTreasuryLedgerEntry.findUnique({
        where: { idempotencyKey },
      });
      if (replay) {
        assertDispositionReplay(replay, row.id, input);
        return row;
      }
      if (row.status === HouseInventoryStatus.DISPOSED) {
        throw new ConflictException('Disposed inventory cannot be reassigned');
      }
      if (row.listingState === HouseInventoryListingState.LISTED) {
        throw new ConflictException('Listed inventory must be delisted before reassignment');
      }
      if (input.disposition === 'list' && (!input.provider || !input.providerListingReference)) {
        throw new ConflictException('Listing requires durable provider listing evidence');
      }
      const decision = dispositionDecision(row, input.disposition, config.allowedDispositions);
      const now = new Date();
      const changed = await transaction.houseInventoryAsset.updateMany({
        data: {
          disposition: decision.disposition,
          dispositionReason: decision.reason ?? input.reason,
          dispositionRequestedAt: now,
          ...(decision.disposition === HouseInventoryDisposition.LIST
            ? {
                listingState: HouseInventoryListingState.LISTED,
                status: HouseInventoryStatus.LISTED,
              }
            : {}),
          version: { increment: 1 },
        },
        where: { id: row.id, version: row.version },
      });
      if (changed.count !== 1) throw new ConflictException('Inventory state changed');
      await appendLedger(transaction, {
        amount: row.acquisitionValueAmount,
        ...(row.crashRoundId ? { crashRoundId: row.crashRoundId } : {}),
        currency: row.acquisitionValueCurrency,
        decimals: row.acquisitionValueDecimals,
        ...(row.duelId ? { duelId: row.duelId } : {}),
        idempotencyKey,
        inventoryId: row.id,
        metadata: {
          disposition: decision.disposition.toLowerCase(),
          operationKey: input.operationKey,
          ...(input.provider ? { provider: input.provider } : {}),
          ...(input.providerListingReference
            ? { providerListingReference: input.providerListingReference }
            : {}),
          reason: decision.reason ?? input.reason,
          requestedDisposition: input.disposition,
        },
        type: HouseTreasuryLedgerType.INVENTORY_DISPOSITION_SET,
      });
      return transaction.houseInventoryAsset.findUniqueOrThrow({ where: { id: row.id } });
    });
  }

  async delistInventory(inventoryId: string, input: DelistHouseInventoryRequest) {
    const cancelledAt = new Date(input.cancelledAt);
    if (!Number.isFinite(cancelledAt.getTime())) {
      throw new ConflictException('Provider cancellation time is invalid');
    }
    assertHouseProviderEvidence(
      input.provider,
      {
        cancelledAt: cancelledAt.toISOString(),
        inventoryId,
        provider: input.provider,
        providerCancellationReference: input.providerCancellationReference,
        providerListingReference: input.providerListingReference,
        status: 'cancelled',
      },
      {
        hash: input.providerCancellationEvidenceHash,
        signature: input.providerCancellationSignature,
      },
    );
    return this.database.$transaction(async (transaction) => {
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        inventoryId,
        HOUSE_INVENTORY_DISPOSITION_LOCK_NAMESPACE,
      );
      const row = await transaction.houseInventoryAsset.findUnique({ where: { id: inventoryId } });
      if (!row) throw new NotFoundException(`Inventory asset ${inventoryId} was not found`);
      const idempotencyKey = `inventory-delisted:${providerReferenceKey(
        input.provider,
        input.providerCancellationReference,
      )}`;
      const replay = await transaction.houseTreasuryLedgerEntry.findUnique({
        where: { idempotencyKey },
      });
      if (replay) {
        assertDelistReplay(replay, row.id, input);
        return row;
      }
      if (
        row.status !== HouseInventoryStatus.LISTED ||
        row.listingState !== HouseInventoryListingState.LISTED ||
        row.disposition !== HouseInventoryDisposition.LIST
      ) {
        throw new ConflictException('Only actively listed inventory can be delisted');
      }
      const listed = await transaction.houseTreasuryLedgerEntry.findFirst({
        orderBy: { createdAt: 'desc' },
        where: {
          inventoryId: row.id,
          type: HouseTreasuryLedgerType.INVENTORY_DISPOSITION_SET,
        },
      });
      const listingMetadata = jsonRecord(listed?.metadata ?? null);
      if (
        listingMetadata?.disposition !== 'list' ||
        listingMetadata.provider !== input.provider ||
        listingMetadata.providerListingReference !== input.providerListingReference
      ) {
        throw new ConflictException(
          'Provider cancellation evidence does not match the active listing',
        );
      }
      if (
        !listed ||
        cancelledAt < listed.createdAt ||
        cancelledAt.getTime() > Date.now() + 5 * 60 * 1_000
      ) {
        throw new ConflictException(
          'Provider cancellation time must follow the active listing and not be in the future',
        );
      }
      const changed = await transaction.houseInventoryAsset.updateMany({
        data: {
          listingState: HouseInventoryListingState.UNLISTED,
          status: HouseInventoryStatus.HELD,
          version: { increment: 1 },
        },
        where: {
          disposition: HouseInventoryDisposition.LIST,
          id: row.id,
          listingState: HouseInventoryListingState.LISTED,
          status: HouseInventoryStatus.LISTED,
          version: row.version,
        },
      });
      if (changed.count !== 1) throw new ConflictException('Inventory state changed');
      await appendLedger(transaction, {
        amount: row.acquisitionValueAmount,
        ...(row.crashRoundId ? { crashRoundId: row.crashRoundId } : {}),
        currency: row.acquisitionValueCurrency,
        decimals: row.acquisitionValueDecimals,
        ...(row.duelId ? { duelId: row.duelId } : {}),
        idempotencyKey,
        inventoryId: row.id,
        metadata: {
          cancelledAt: cancelledAt.toISOString(),
          operationKey: input.operationKey,
          provider: input.provider,
          providerCancellationEvidenceHash: input.providerCancellationEvidenceHash,
          providerCancellationReference: input.providerCancellationReference,
          providerCancellationSignature: input.providerCancellationSignature,
          providerListingReference: input.providerListingReference,
          reason: input.reason,
          transition: 'delist',
        },
        type: HouseTreasuryLedgerType.INVENTORY_DISPOSITION_SET,
      });
      return transaction.houseInventoryAsset.findUniqueOrThrow({ where: { id: row.id } });
    });
  }

  async completeDisposition(inventoryId: string, input: CompleteHouseDispositionRequest) {
    return this.database.$transaction(async (transaction) => {
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        inventoryId,
        HOUSE_INVENTORY_DISPOSITION_LOCK_NAMESPACE,
      );
      const row = await transaction.houseInventoryAsset.findUnique({ where: { id: inventoryId } });
      if (!row) throw new NotFoundException(`Inventory asset ${inventoryId} was not found`);
      const idempotencyKey =
        input.provider && input.providerSaleReference
          ? `inventory-disposed:${providerReferenceKey(
              input.provider,
              input.providerSaleReference,
            )}`
          : `inventory-disposed:${input.operationKey}`;
      const replay = await transaction.houseTreasuryLedgerEntry.findUnique({
        where: { idempotencyKey },
      });
      if (replay) {
        assertDispositionCompletionReplay(replay, row.id, input);
        return row;
      }
      if (row.status === HouseInventoryStatus.DISPOSED) {
        throw new ConflictException('Disposed inventory completion key does not match');
      }
      if (row.status === HouseInventoryStatus.RECONCILIATION_REQUIRED) {
        throw new ConflictException('Inventory custody must reconcile before disposition');
      }
      if (
        row.disposition !== HouseInventoryDisposition.BUYBACK &&
        row.disposition !== HouseInventoryDisposition.LIST
      ) {
        throw new ConflictException(
          'Inventory disposition is not eligible for realized completion',
        );
      }
      if (
        row.disposition === HouseInventoryDisposition.BUYBACK &&
        row.listingState === HouseInventoryListingState.LISTED
      ) {
        throw new ConflictException('Listed inventory cannot complete a buyback before delisting');
      }
      if (
        row.disposition === HouseInventoryDisposition.LIST &&
        row.listingState !== HouseInventoryListingState.LISTED
      ) {
        throw new ConflictException('Unlisted inventory cannot complete a listing sale');
      }
      const listingCompletion =
        row.disposition === HouseInventoryDisposition.LIST
          ? await assertActiveListingCompletion(transaction, row, input)
          : null;
      if (
        row.disposition !== HouseInventoryDisposition.LIST &&
        dispositionCompletionCarriesProviderEvidence(input)
      ) {
        throw new ConflictException('Buyback completion cannot carry marketplace sale evidence');
      }
      const gross = storedAmount(input.realizedAmount);
      const fee = storedAmount(input.feeAmount);
      if (fee > gross)
        throw new ConflictException('Disposition fee cannot exceed realized proceeds');
      const net = gross - fee;
      const gainLoss = net - storedAmount(row.acquisitionValueAmount);
      const changed = await transaction.houseInventoryAsset.updateMany({
        data: {
          disposedAt: new Date(),
          listingState:
            row.disposition === HouseInventoryDisposition.LIST
              ? HouseInventoryListingState.SOLD
              : HouseInventoryListingState.UNLISTED,
          realizedAmount: net.toString(),
          realizedCurrency: input.realizedCurrency,
          realizedDecimals: input.realizedDecimals,
          realizedFeeAmount: input.feeAmount,
          realizedGainLossAmount: gainLoss.toString(),
          status: HouseInventoryStatus.DISPOSED,
          version: { increment: 1 },
        },
        where: { id: row.id, status: row.status, version: row.version },
      });
      if (changed.count !== 1) throw new ConflictException('Inventory state changed');
      await appendLedger(transaction, {
        amount: net.toString(),
        ...(row.crashRoundId ? { crashRoundId: row.crashRoundId } : {}),
        currency: input.realizedCurrency,
        decimals: input.realizedDecimals,
        ...(row.duelId ? { duelId: row.duelId } : {}),
        idempotencyKey,
        inventoryId: row.id,
        metadata: {
          disposition: row.disposition.toLowerCase(),
          feeAmount: input.feeAmount,
          gainLossAmount: gainLoss.toString(),
          grossAmount: input.realizedAmount,
          operationKey: input.operationKey,
          ...(listingCompletion ?? {}),
          reason: input.reason,
        },
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

export function houseReservationResolution(duel: {
  creatorWallet: string;
  opponentWallet: string | null;
  packOutcomes: Array<{ side: DuelSide }>;
  status: DuelStatus;
  winnerWallet: string | null;
}): {
  custodyWallet: string | null;
  inventorySides: DuelSide[];
  ledgerType: HouseTreasuryLedgerType | null;
  reason: 'house_win' | 'player_win' | 'post_open_refund' | 'tie' | null;
  target: HouseTreasuryReservationStatus | null;
} {
  if (duel.status === DuelStatus.CANCELLED) {
    return duel.packOutcomes.length === 0
      ? unresolvedHouseReservation(HouseTreasuryReservationStatus.RELEASED)
      : unresolvedHouseReservation(HouseTreasuryReservationStatus.RECOVERY_REQUIRED);
  }
  if (duel.status === DuelStatus.REFUNDED) {
    if (duel.packOutcomes.length === 0) {
      return unresolvedHouseReservation(HouseTreasuryReservationStatus.RELEASED);
    }
    if (!hasCanonicalOutcomeSides(duel.packOutcomes) || !duel.opponentWallet) {
      return unresolvedHouseReservation(HouseTreasuryReservationStatus.RECOVERY_REQUIRED);
    }
    return {
      custodyWallet: duel.opponentWallet,
      inventorySides: [DuelSide.OPPONENT],
      ledgerType: HouseTreasuryLedgerType.HOUSE_PACK_COST,
      reason: 'post_open_refund',
      target: HouseTreasuryReservationStatus.SETTLED,
    };
  }
  if (duel.status !== DuelStatus.SETTLED) {
    return unresolvedHouseReservation(reservationTarget(duel.status));
  }
  if (!hasCanonicalOutcomeSides(duel.packOutcomes) || !duel.opponentWallet) {
    return unresolvedHouseReservation(HouseTreasuryReservationStatus.RECOVERY_REQUIRED);
  }
  if (duel.winnerWallet === duel.creatorWallet) {
    return {
      custodyWallet: duel.opponentWallet,
      inventorySides: [],
      ledgerType: HouseTreasuryLedgerType.PLAYER_WIN_LOSS,
      reason: 'player_win',
      target: HouseTreasuryReservationStatus.SETTLED,
    };
  }
  if (duel.winnerWallet === duel.opponentWallet) {
    return {
      custodyWallet: duel.opponentWallet,
      inventorySides: [DuelSide.CREATOR, DuelSide.OPPONENT],
      ledgerType: HouseTreasuryLedgerType.HOUSE_PACK_COST,
      reason: 'house_win',
      target: HouseTreasuryReservationStatus.SETTLED,
    };
  }
  if (duel.winnerWallet === null) {
    return {
      custodyWallet: duel.opponentWallet,
      inventorySides: [DuelSide.OPPONENT],
      ledgerType: HouseTreasuryLedgerType.HOUSE_PACK_COST,
      reason: 'tie',
      target: HouseTreasuryReservationStatus.SETTLED,
    };
  }
  return unresolvedHouseReservation(HouseTreasuryReservationStatus.RECOVERY_REQUIRED);
}

function unresolvedHouseReservation(
  target: HouseTreasuryReservationStatus | null,
): ReturnType<typeof houseReservationResolution> {
  return {
    custodyWallet: null,
    inventorySides: [],
    ledgerType: null,
    reason: null,
    target,
  };
}

function hasCanonicalOutcomeSides(outcomes: Array<{ side: DuelSide }>): boolean {
  return (
    outcomes.length === 2 &&
    outcomes.filter((outcome) => outcome.side === DuelSide.CREATOR).length === 1 &&
    outcomes.filter((outcome) => outcome.side === DuelSide.OPPONENT).length === 1
  );
}

interface HouseInventoryAcquisitionInput {
  custodyWallet: string;
  duelId: string;
  outcome: {
    assetReference: string;
    displayName: string;
    id: string;
    insuredValueAmount: string;
    insuredValueCurrency: string;
    insuredValueDecimals: number;
    side: DuelSide;
  };
  reason: 'house_win' | 'post_open_refund' | 'tie';
  reservationId: string;
}

export async function acquireHouseInventoryAsset(
  transaction: Prisma.TransactionClient,
  input: HouseInventoryAcquisitionInput,
): Promise<{ created: boolean; inventoryId: string }> {
  await acquireNamespacedAdvisoryTransactionLock(
    transaction,
    input.outcome.assetReference,
    HOUSE_INVENTORY_LOCK_NAMESPACE,
  );
  const [byOutcome, byAsset] = await Promise.all([
    transaction.houseInventoryAsset.findUnique({ where: { outcomeId: input.outcome.id } }),
    transaction.houseInventoryAsset.findFirst({
      where: { assetReference: input.outcome.assetReference },
    }),
  ]);
  if (byOutcome && byAsset && byOutcome.id !== byAsset.id) {
    throw new ConflictException('House inventory source conflicts with a canonical asset record');
  }
  const existing = byOutcome ?? byAsset;
  if (existing) {
    if (!inventoryAcquisitionMatches(existing, input)) {
      throw new ConflictException('House inventory asset is already ledgered from another source');
    }
    return { created: false, inventoryId: existing.id };
  }

  const inventoryId = createId('hinv');
  await transaction.houseInventoryAsset.create({
    data: {
      acquisitionValueAmount: input.outcome.insuredValueAmount,
      acquisitionValueCurrency: input.outcome.insuredValueCurrency,
      acquisitionValueDecimals: input.outcome.insuredValueDecimals,
      assetReference: input.outcome.assetReference,
      buybackEligible: false,
      buybackExpiresAt: null,
      buybackValueAmount: null,
      buybackValueCurrency: null,
      buybackValueDecimals: null,
      custodyWallet: input.custodyWallet,
      displayedValueAmount: null,
      displayedValueCurrency: null,
      displayedValueDecimals: null,
      displayName: input.outcome.displayName,
      disposition: HouseInventoryDisposition.MANUAL_REVIEW,
      duelId: input.duelId,
      id: inventoryId,
      insuredValueAmount: input.outcome.insuredValueAmount,
      insuredValueCurrency: input.outcome.insuredValueCurrency,
      insuredValueDecimals: input.outcome.insuredValueDecimals,
      listingState: HouseInventoryListingState.UNLISTED,
      listingValueAmount: null,
      listingValueCurrency: null,
      listingValueDecimals: null,
      outcomeId: input.outcome.id,
      status: HouseInventoryStatus.HELD,
    },
  });
  await appendLedger(transaction, {
    amount: input.outcome.insuredValueAmount,
    currency: input.outcome.insuredValueCurrency,
    decimals: input.outcome.insuredValueDecimals,
    duelId: input.duelId,
    idempotencyKey: `house-win-inventory:${input.outcome.id}`,
    inventoryId,
    metadata: { reason: input.reason, side: input.outcome.side.toLowerCase() },
    reservationId: input.reservationId,
    type: HouseTreasuryLedgerType.HOUSE_WIN_INVENTORY,
  });
  return { created: true, inventoryId };
}

function inventoryAcquisitionMatches(
  existing: {
    acquisitionValueAmount: string;
    acquisitionValueCurrency: string;
    acquisitionValueDecimals: number;
    assetReference: string;
    custodyWallet: string;
    displayName: string;
    duelId: string | null;
    insuredValueAmount: string;
    insuredValueCurrency: string;
    insuredValueDecimals: number;
    outcomeId: string | null;
  },
  input: HouseInventoryAcquisitionInput,
): boolean {
  return (
    existing.duelId === input.duelId &&
    existing.outcomeId === input.outcome.id &&
    existing.assetReference === input.outcome.assetReference &&
    existing.displayName === input.outcome.displayName &&
    existing.custodyWallet === input.custodyWallet &&
    existing.acquisitionValueAmount === input.outcome.insuredValueAmount &&
    existing.acquisitionValueCurrency === input.outcome.insuredValueCurrency &&
    existing.acquisitionValueDecimals === input.outcome.insuredValueDecimals &&
    existing.insuredValueAmount === input.outcome.insuredValueAmount &&
    existing.insuredValueCurrency === input.outcome.insuredValueCurrency &&
    existing.insuredValueDecimals === input.outcome.insuredValueDecimals
  );
}

async function appendLedger(
  transaction: Prisma.TransactionClient,
  input: {
    amount: string;
    crashRoundId?: string;
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
      ...(input.crashRoundId ? { crashRoundId: input.crashRoundId } : {}),
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

function dispositionDecision(
  row: {
    buybackEligible: boolean;
    buybackExpiresAt: Date | null;
    buybackValueAmount: string | null;
    listingState: HouseInventoryListingState;
    listingValueAmount: string | null;
  },
  requested: HouseDispositionRequest['disposition'],
  allowed: HouseTreasuryConfig['allowedDispositions'],
): { disposition: HouseInventoryDisposition; reason: string | null } {
  if (!allowed.includes(requested)) {
    return {
      disposition: HouseInventoryDisposition.MANUAL_REVIEW,
      reason: `Manual review required: ${requested} capability is not configured`,
    };
  }
  if (requested === 'promotion') {
    return {
      disposition: HouseInventoryDisposition.MANUAL_REVIEW,
      reason: 'Manual review required: promotion needs human approval',
    };
  }
  if (
    requested === 'buyback' &&
    (!row.buybackEligible ||
      !row.buybackValueAmount ||
      !row.buybackExpiresAt ||
      row.buybackExpiresAt.getTime() <= Date.now())
  ) {
    return {
      disposition: HouseInventoryDisposition.MANUAL_REVIEW,
      reason: 'Manual review required: buyback eligibility or quote is unavailable',
    };
  }
  if (
    requested === 'list' &&
    (!row.listingValueAmount || row.listingState === HouseInventoryListingState.SOLD)
  ) {
    return {
      disposition: HouseInventoryDisposition.MANUAL_REVIEW,
      reason: 'Manual review required: listing eligibility or quote is unavailable',
    };
  }
  return { disposition: toDisposition(requested), reason: null };
}

function assertDispositionReplay(
  ledger: { inventoryId: string | null; metadata: Prisma.JsonValue | null },
  inventoryId: string,
  input: HouseDispositionRequest,
): void {
  const metadata = jsonRecord(ledger.metadata);
  if (
    ledger.inventoryId !== inventoryId ||
    metadata?.operationKey !== input.operationKey ||
    metadata?.requestedDisposition !== input.disposition ||
    (input.disposition === 'list' &&
      (metadata.provider !== input.provider ||
        metadata.providerListingReference !== input.providerListingReference))
  ) {
    throw new ConflictException('Disposition operation key was already used for another request');
  }
}

async function assertActiveListingCompletion(
  transaction: Prisma.TransactionClient,
  row: {
    id: string;
  },
  input: CompleteHouseDispositionRequest,
): Promise<{
  provider: string;
  providerListingReference: string;
  providerSaleAt: string;
  providerSaleEvidenceHash: string;
  providerSaleReference: string;
  providerSaleSignature: string;
}> {
  if (
    !input.provider ||
    !input.providerListingReference ||
    !input.providerSaleAt ||
    !input.providerSaleEvidenceHash ||
    !input.providerSaleReference ||
    !input.providerSaleSignature
  ) {
    throw new ConflictException('Listing sale completion requires exact provider sale evidence');
  }
  const listed = await transaction.houseTreasuryLedgerEntry.findFirst({
    orderBy: { createdAt: 'desc' },
    where: {
      inventoryId: row.id,
      type: HouseTreasuryLedgerType.INVENTORY_DISPOSITION_SET,
    },
  });
  const listingMetadata = jsonRecord(listed?.metadata ?? null);
  if (
    listingMetadata?.disposition !== 'list' ||
    listingMetadata.provider !== input.provider ||
    listingMetadata.providerListingReference !== input.providerListingReference
  ) {
    throw new ConflictException('Provider sale evidence does not match the active listing');
  }
  const providerSaleAt = new Date(input.providerSaleAt);
  if (
    !Number.isFinite(providerSaleAt.getTime()) ||
    !listed ||
    providerSaleAt < listed.createdAt ||
    providerSaleAt.getTime() > Date.now() + 5 * 60 * 1_000
  ) {
    throw new ConflictException(
      'Provider sale time must follow the active listing and not be in the future',
    );
  }
  const canonicalSaleAt = providerSaleAt.toISOString();
  assertHouseProviderEvidence(
    input.provider,
    {
      feeAmount: input.feeAmount,
      inventoryId: row.id,
      provider: input.provider,
      providerListingReference: input.providerListingReference,
      providerSaleAt: canonicalSaleAt,
      providerSaleReference: input.providerSaleReference,
      realizedAmount: input.realizedAmount,
      realizedCurrency: input.realizedCurrency,
      realizedDecimals: input.realizedDecimals,
      status: 'sold',
    },
    {
      hash: input.providerSaleEvidenceHash,
      signature: input.providerSaleSignature,
    },
  );
  return {
    provider: input.provider,
    providerListingReference: input.providerListingReference,
    providerSaleAt: canonicalSaleAt,
    providerSaleEvidenceHash: input.providerSaleEvidenceHash,
    providerSaleReference: input.providerSaleReference,
    providerSaleSignature: input.providerSaleSignature,
  };
}

function dispositionCompletionCarriesProviderEvidence(
  input: CompleteHouseDispositionRequest,
): boolean {
  return Boolean(
    input.provider ||
      input.providerListingReference ||
      input.providerSaleAt ||
      input.providerSaleEvidenceHash ||
      input.providerSaleReference ||
      input.providerSaleSignature,
  );
}

function assertDelistReplay(
  ledger: { inventoryId: string | null; metadata: Prisma.JsonValue | null },
  inventoryId: string,
  input: DelistHouseInventoryRequest,
): void {
  const metadata = jsonRecord(ledger.metadata);
  if (
    ledger.inventoryId !== inventoryId ||
    metadata?.operationKey !== input.operationKey ||
    metadata.provider !== input.provider ||
    metadata.providerListingReference !== input.providerListingReference ||
    metadata.providerCancellationReference !== input.providerCancellationReference ||
    metadata.providerCancellationEvidenceHash !== input.providerCancellationEvidenceHash ||
    metadata.providerCancellationSignature !== input.providerCancellationSignature ||
    metadata.cancelledAt !== new Date(input.cancelledAt).toISOString() ||
    metadata.reason !== input.reason
  ) {
    throw new ConflictException('Delist operation key was already used for another result');
  }
}

function assertDispositionCompletionReplay(
  ledger: { inventoryId: string | null; metadata: Prisma.JsonValue | null },
  inventoryId: string,
  input: CompleteHouseDispositionRequest,
): void {
  const metadata = jsonRecord(ledger.metadata);
  if (
    ledger.inventoryId !== inventoryId ||
    metadata?.operationKey !== input.operationKey ||
    metadata?.grossAmount !== input.realizedAmount ||
    metadata?.feeAmount !== input.feeAmount ||
    metadata?.reason !== input.reason ||
    metadata?.provider !== input.provider ||
    metadata?.providerListingReference !== input.providerListingReference ||
    metadata?.providerSaleAt !==
      (input.providerSaleAt ? new Date(input.providerSaleAt).toISOString() : undefined) ||
    metadata?.providerSaleEvidenceHash !== input.providerSaleEvidenceHash ||
    metadata?.providerSaleReference !== input.providerSaleReference ||
    metadata?.providerSaleSignature !== input.providerSaleSignature
  ) {
    throw new ConflictException('Disposition completion key was already used for another result');
  }
}

function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function storedAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new ServiceUnavailableException('Invalid treasury amount');
  return BigInt(value);
}

function optionalStoredMoney(
  amount: string | null,
  currency: string | null,
  decimals: number | null,
): { amount: string; currency: string; decimals: number } | null {
  if (amount === null && currency === null && decimals === null) return null;
  if (amount === null || currency === null || decimals === null) {
    throw new ServiceUnavailableException('Inventory valuation record is incomplete');
  }
  return { amount, currency, decimals };
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

async function recordReconciliationDiscrepancy(
  database: Pick<Prisma.TransactionClient, 'houseReconciliationDiscrepancy'>,
  input: {
    detail: string;
    entityReference: string;
    expectedValue: string;
    kind: string;
    observedSlot: string;
    observedValue: string;
    verifiedAt: Date;
  },
): Promise<void> {
  const idempotencyKey = [
    'house-reconciliation',
    input.kind,
    input.entityReference,
    input.observedSlot,
  ].join(':');
  await database.houseReconciliationDiscrepancy.upsert({
    create: {
      detail: input.detail,
      entityReference: input.entityReference,
      expectedValue: input.expectedValue,
      firstObservedAt: input.verifiedAt,
      id: createId('hdisc'),
      idempotencyKey,
      kind: input.kind,
      lastObservedAt: input.verifiedAt,
      observedSlot: input.observedSlot,
      observedValue: input.observedValue,
    },
    update: {
      detail: input.detail,
      expectedValue: input.expectedValue,
      lastObservedAt: input.verifiedAt,
      observedValue: input.observedValue,
      resolvedAt: null,
    },
    where: { idempotencyKey },
  });
}

async function resolveReconciliationDiscrepancies(
  database: Pick<Prisma.TransactionClient, 'houseReconciliationDiscrepancy'>,
  kind: string,
  entityReference: string,
  resolvedAt: Date,
): Promise<void> {
  await database.houseReconciliationDiscrepancy.updateMany({
    data: { resolvedAt },
    where: { entityReference, kind, resolvedAt: null },
  });
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
