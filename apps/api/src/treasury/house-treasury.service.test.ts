import { describe, expect, test } from 'bun:test';
import {
  DuelSide,
  DuelStatus,
  HouseInventoryListingState,
  HouseInventoryStatus,
  HouseTreasuryLedgerType,
  HouseTreasuryReservationStatus,
} from '@dailydraft/db';

import { SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import { ACTIVE_HOUSE_RESERVATION_STATUSES } from './house-treasury.policy.js';
import { HouseTreasuryService } from './house-treasury.service.js';

const HOT_WALLET = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
const COLD_OWNER = '66KTYU8iBq36MBX8fG1vR8c1mh5T8LDqcP41wqmg2Zjs';
const TOKEN_ACCOUNT = '8t9zGQDVsTZhz4kB8DD5qGx7PyHhNzxpmBo3ZNnQ2Uhg';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('HouseTreasuryService', () => {
  test('persists only finalized custody with a cold owner and bounded hot-wallet delegate', async () => {
    const snapshots: SnapshotWrite[] = [];
    const database = treasuryDatabase(snapshots);
    const service = new HouseTreasuryService(
      database as never,
      new TreasuryRpc({
        amount: 150_000_000n,
        delegate: HOT_WALLET,
        delegatedAmount: 100_000_000n,
        mint: USDC_MINT,
        owner: COLD_OWNER,
      }),
    );

    await withHouseEnvironment(() => service.reconcileOnChain());

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      delegate: HOT_WALLET,
      delegatedAmount: '100000000',
      wallet: COLD_OWNER,
    });
  });

  test('fails closed when the hot signer owns custody or its delegation exceeds the exposure cap', async () => {
    const hotOwner = new HouseTreasuryService(
      treasuryDatabase([]) as never,
      new TreasuryRpc({
        amount: 150_000_000n,
        delegate: HOT_WALLET,
        delegatedAmount: 100_000_000n,
        mint: USDC_MINT,
        owner: HOT_WALLET,
      }),
    );
    const unboundedDelegate = new HouseTreasuryService(
      treasuryDatabase([]) as never,
      new TreasuryRpc({
        amount: 150_000_000n,
        delegate: HOT_WALLET,
        delegatedAmount: 100_000_001n,
        mint: USDC_MINT,
        owner: COLD_OWNER,
      }),
    );

    await expect(withHouseEnvironment(() => hotOwner.reconcileOnChain())).rejects.toThrow(
      'bounded delegate does not match policy',
    );
    await expect(withHouseEnvironment(() => unboundedDelegate.reconcileOnChain())).rejects.toThrow(
      'bounded delegate does not match policy',
    );
  });

  test('restores verified custody and quarantines mismatched inventory without rewriting history', async () => {
    const harness = inventoryReconciliationDatabase();
    const service = new HouseTreasuryService(
      harness.database as never,
      new InventoryReconciliationRpc(),
    );

    const result = await withHouseEnvironment(() => service.reconcileOnChain());

    expect(result).toMatchObject({
      inventoryChecked: 2,
      inventoryMismatched: 1,
      inventoryVerified: 1,
    });
    expect(
      harness.inventory.map(({ reconciliationError, status }) => ({
        reconciliationError,
        status,
      })),
    ).toEqual([
      { reconciliationError: null, status: HouseInventoryStatus.HELD },
      {
        reconciliationError: 'custody_mismatch',
        status: HouseInventoryStatus.RECONCILIATION_REQUIRED,
      },
    ]);
    expect(harness.ledger).toEqual([
      expect.objectContaining({ type: HouseTreasuryLedgerType.RECONCILIATION_ALERT }),
    ]);
    expect(harness.discrepancies).toEqual([
      expect.objectContaining({
        entityReference: 'hinv_mismatched_custody',
        kind: 'inventory_custody',
        observedSlot: '1',
      }),
    ]);
    expect(harness.inventory.every((asset) => asset.lastReconciledSlot === '1')).toBe(true);
  });

  test('records a slot-bound treasury discrepancy without rewriting prior ledger evidence', async () => {
    const harness = treasuryBalanceReconciliationDatabase({
      balanceAmount: '150000000',
      observedSlot: '40',
      verifiedAt: new Date('2026-07-20T10:00:00.000Z'),
    });
    harness.ledger.push({
      amount: '10000000',
      createdAt: new Date('2026-07-20T10:01:00.000Z'),
      type: HouseTreasuryLedgerType.HOUSE_PACK_COST,
    });
    const service = new HouseTreasuryService(
      harness.database as never,
      new TreasuryRpc(
        {
          amount: 130_000_000n,
          delegate: HOT_WALLET,
          delegatedAmount: 100_000_000n,
          mint: USDC_MINT,
          owner: COLD_OWNER,
        },
        41n,
      ),
    );

    const result = await withHouseEnvironment(() => service.reconcileOnChain());

    expect(result).toMatchObject({ observedSlot: '41', treasuryDiscrepancies: 1 });
    expect(harness.discrepancies).toEqual([
      expect.objectContaining({
        expectedValue: '140000000',
        kind: 'treasury_balance',
        observedSlot: '41',
        observedValue: '130000000',
      }),
    ]);
    expect(harness.snapshots.at(-1)).toMatchObject({
      balanceAmount: '130000000',
      observedSlot: '41',
    });
  });

  test('does not advance the treasury snapshot when discrepancy persistence fails', async () => {
    const harness = treasuryBalanceReconciliationDatabase(
      {
        balanceAmount: '150000000',
        observedSlot: '40',
        verifiedAt: new Date('2026-07-29T10:00:00.000Z'),
      },
      { failDiscrepancyWrite: true },
    );
    harness.ledger.push({
      amount: '10000000',
      createdAt: new Date('2026-07-29T10:01:00.000Z'),
      type: HouseTreasuryLedgerType.HOUSE_PACK_COST,
    });
    const service = new HouseTreasuryService(
      harness.database as never,
      new TreasuryRpc(
        {
          amount: 130_000_000n,
          delegate: HOT_WALLET,
          delegatedAmount: 100_000_000n,
          mint: USDC_MINT,
          owner: COLD_OWNER,
        },
        41n,
      ),
    );

    await expect(withHouseEnvironment(() => service.reconcileOnChain())).rejects.toThrow(
      'discrepancy write failed',
    );
    expect(harness.snapshots).toHaveLength(1);
    expect(harness.snapshots[0]?.observedSlot).toBe('40');
  });

  test('serializes concurrent observations without clearing an unexplained balance gap', async () => {
    const harness = treasuryBalanceReconciliationDatabase({
      balanceAmount: '150000000',
      observedSlot: '40',
      verifiedAt: new Date('2026-07-20T10:00:00.000Z'),
    });
    harness.ledger.push({
      amount: '10000000',
      createdAt: new Date('2026-07-20T10:01:00.000Z'),
      type: HouseTreasuryLedgerType.HOUSE_PACK_COST,
    });
    const account = {
      amount: 130_000_000n,
      delegate: HOT_WALLET,
      delegatedAmount: 100_000_000n,
      mint: USDC_MINT,
      owner: COLD_OWNER,
    };
    const first = new HouseTreasuryService(
      harness.database as never,
      new TreasuryRpc(account, 41n),
    );
    const second = new HouseTreasuryService(
      harness.database as never,
      new TreasuryRpc(account, 42n),
    );

    const results = await withHouseEnvironment(() =>
      Promise.all([first.reconcileOnChain(), second.reconcileOnChain()]),
    );

    expect(results.map((result) => result.treasuryDiscrepancies)).toEqual([1, 1]);
    expect(harness.snapshots.at(-1)?.observedSlot).toBe('42');
    expect(harness.discrepancies).toHaveLength(2);
    expect(harness.discrepancies).toEqual([
      expect.objectContaining({ expectedValue: '140000000', observedSlot: '41' }),
      expect.objectContaining({ expectedValue: '140000000', observedSlot: '42' }),
    ]);
  });

  test('rejects a stale finalized observation before replacing the recorded snapshot', async () => {
    const harness = treasuryBalanceReconciliationDatabase({
      balanceAmount: '150000000',
      observedSlot: '50',
      verifiedAt: new Date('2026-07-29T10:00:00.000Z'),
    });
    const service = new HouseTreasuryService(
      harness.database as never,
      new TreasuryRpc(
        {
          amount: 150_000_000n,
          delegate: HOT_WALLET,
          delegatedAmount: 100_000_000n,
          mint: USDC_MINT,
          owner: COLD_OWNER,
        },
        49n,
      ),
    );

    await expect(withHouseEnvironment(() => service.reconcileOnChain())).rejects.toThrow(
      'did not advance beyond recorded state',
    );
    expect(harness.snapshots).toHaveLength(1);
  });

  test('rotates unchanged lifecycle rows so a later release cannot starve beyond one batch', async () => {
    const reservations = Array.from({ length: 100 }, (_, index) =>
      reservation(`hres_${String(index).padStart(3, '0')}`, DuelStatus.MATCHED),
    );
    const terminal = reservation('hres_zzz', DuelStatus.CANCELLED);
    reservations.push(terminal);
    const harness = lifecycleDatabase(reservations);
    const service = new HouseTreasuryService(harness.database as never, {} as never);

    const first = await service.reconcileLifecycle(100);
    const second = await service.reconcileLifecycle(100);

    expect(first).toMatchObject({ checked: 100, released: 0 });
    expect(second.released).toBe(1);
    expect(terminal.status).toBe(HouseTreasuryReservationStatus.RELEASED);
  });

  test('persists only the house card on a tie without classifying it as a player-win loss', async () => {
    const tied = reservation('hres_tie', DuelStatus.SETTLED, {
      packOutcomes: outcomes(),
      winnerWallet: null,
    });
    const harness = lifecycleDatabase([tied]);
    const service = new HouseTreasuryService(harness.database as never, {} as never);

    const first = await service.reconcileLifecycle();
    const replay = await service.reconcileLifecycle();

    expect(first).toMatchObject({ inventoryCreated: 1, transitioned: 1 });
    expect(harness.inventory.map((row) => row.outcomeId)).toEqual(['outcome_opponent']);
    expect(harness.inventory[0]).toMatchObject({
      acquisitionValueAmount: '50000000',
      assetReference: 'outcome_opponent_mint',
      buybackEligible: false,
      buybackExpiresAt: null,
      buybackValueAmount: null,
      custodyWallet: HOT_WALLET,
      displayedValueAmount: null,
      disposition: 'MANUAL_REVIEW',
      insuredValueAmount: '50000000',
      listingState: 'UNLISTED',
      listingValueAmount: null,
      status: 'HELD',
    });
    expect(harness.ledger.map((row) => row.type)).toEqual([
      HouseTreasuryLedgerType.HOUSE_PACK_COST,
      HouseTreasuryLedgerType.HOUSE_WIN_INVENTORY,
    ]);
    expect(replay.checked).toBe(0);
    expect(harness.inventory).toHaveLength(1);
    expect(harness.ledger).toHaveLength(2);

    const inventory = await service.listInventory({ limit: 20 });
    expect(inventory.data[0]).toMatchObject({
      acquisitionValue: { amount: '50000000', currency: 'USDC', decimals: 6 },
      buybackValue: null,
      displayedValue: null,
      insuredValue: { amount: '50000000', currency: 'USDC', decimals: 6 },
      listingValue: null,
    });
  });

  test('persists returned house custody and pack cost after a post-open refund', async () => {
    const refunded = reservation('hres_refund', DuelStatus.REFUNDED, {
      packOutcomes: outcomes(),
      winnerWallet: null,
    });
    const harness = lifecycleDatabase([refunded]);
    const service = new HouseTreasuryService(harness.database as never, {} as never);

    await service.reconcileLifecycle();

    expect(refunded.status).toBe(HouseTreasuryReservationStatus.SETTLED);
    expect(harness.inventory.map((row) => row.outcomeId)).toEqual(['outcome_opponent']);
    expect(harness.ledger.map((row) => row.type)).toEqual([
      HouseTreasuryLedgerType.HOUSE_PACK_COST,
      HouseTreasuryLedgerType.HOUSE_WIN_INVENTORY,
    ]);
    expect(harness.ledger[0]?.metadata).toEqual({ reason: 'post_open_refund' });
  });

  test('reports acquisition, insured, listing, buyback, and displayed values separately', async () => {
    const service = new HouseTreasuryService(
      {
        houseInventoryAsset: {
          findMany: () =>
            Promise.resolve([
              {
                acquisitionValueAmount: '41000000',
                acquisitionValueCurrency: 'USDC',
                acquisitionValueDecimals: 6,
                assetReference: 'asset_valuations',
                buybackEligible: true,
                buybackExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
                buybackValueAmount: '43000000',
                buybackValueCurrency: 'USDC',
                buybackValueDecimals: 6,
                custodyWallet: HOT_WALLET,
                displayedValueAmount: '44000000',
                displayedValueCurrency: 'USDC',
                displayedValueDecimals: 6,
                displayName: 'Distinct valuations',
                disposition: 'MANUAL_REVIEW',
                duelId: 'duel_valuations',
                id: 'hinv_valuations',
                insuredValueAmount: '42000000',
                insuredValueCurrency: 'USDC',
                insuredValueDecimals: 6,
                lastReconciledAt: null,
                listingState: 'LISTED',
                listingValueAmount: '45000000',
                listingValueCurrency: 'USDC',
                listingValueDecimals: 6,
                reconciliationError: null,
                status: 'LISTED',
              },
            ]),
        },
      } as never,
      {} as never,
    );

    const result = await service.listInventory({ limit: 20 });

    expect(result.data[0]).toMatchObject({
      acquisitionValue: { amount: '41000000' },
      buybackValue: { amount: '43000000' },
      displayedValue: { amount: '44000000' },
      insuredValue: { amount: '42000000' },
      listingValue: { amount: '45000000' },
    });
  });

  test('holds incomplete terminal outcome evidence in recovery instead of releasing exposure', async () => {
    const incomplete = reservation('hres_incomplete', DuelStatus.REFUNDED, {
      packOutcomes: [outcome('incomplete_creator', DuelSide.CREATOR)],
    });
    const harness = lifecycleDatabase([incomplete]);
    const service = new HouseTreasuryService(harness.database as never, {} as never);

    await service.reconcileLifecycle();

    expect(incomplete.status).toBe(HouseTreasuryReservationStatus.RECOVERY_REQUIRED);
    expect(harness.inventory).toEqual([]);
    expect(harness.ledger).toEqual([]);
  });

  test('routes player wins, house wins, and pre-open refunds to distinct terminal accounting', async () => {
    const playerWin = reservation('hres_player_win', DuelStatus.SETTLED, {
      packOutcomes: outcomes(),
      winnerWallet: COLD_OWNER,
    });
    const houseWin = reservation('hres_house_win', DuelStatus.SETTLED, {
      packOutcomes: outcomes('house-win'),
      winnerWallet: HOT_WALLET,
    });
    const unopenedRefund = reservation('hres_unopened_refund', DuelStatus.REFUNDED);
    const harness = lifecycleDatabase([playerWin, houseWin, unopenedRefund]);
    const service = new HouseTreasuryService(harness.database as never, {} as never);

    const result = await service.reconcileLifecycle();

    expect(result).toMatchObject({ inventoryCreated: 2, released: 1, transitioned: 3 });
    expect(harness.inventory.map((row) => row.outcomeId).sort()).toEqual([
      'house-win_creator',
      'house-win_opponent',
    ]);
    const ledgerTypes = harness.ledger.map((row) => row.type);
    expect(ledgerTypes).toHaveLength(5);
    expect(
      ledgerTypes.filter((type) => type === HouseTreasuryLedgerType.PLAYER_WIN_LOSS),
    ).toHaveLength(1);
    expect(
      ledgerTypes.filter((type) => type === HouseTreasuryLedgerType.HOUSE_PACK_COST),
    ).toHaveLength(1);
    expect(
      ledgerTypes.filter((type) => type === HouseTreasuryLedgerType.HOUSE_WIN_INVENTORY),
    ).toHaveLength(2);
    expect(
      ledgerTypes.filter((type) => type === HouseTreasuryLedgerType.RESERVATION_RELEASED),
    ).toHaveLength(1);
  });

  test('reports active lifecycle buckets once and excludes released or settled exposure', async () => {
    const service = new HouseTreasuryService(
      summaryDatabase() as never,
      new TreasuryRpc({
        amount: 150_000_000n,
        delegate: HOT_WALLET,
        delegatedAmount: 100_000_000n,
        mint: USDC_MINT,
        owner: COLD_OWNER,
      }),
    );

    const summary = await withHouseEnvironment(() => service.getSummary());

    expect(summary.pendingGames).toBe(4);
    expect(summary.pendingGamesByStatus).toEqual({
      funded: 1,
      recovery_required: 1,
      reserved: 1,
      settlement_pending: 1,
    });
    expect(summary.risk.totalExposureAmount).toBe('100000000');
    expect(summary.risk.tierAdmissionStates).toEqual([
      {
        disabled: true,
        evaluatedAt: '2026-07-22T16:00:00.000Z',
        reason: 'minimum_liquidity',
        reenableBoundary: 'fresh_treasury_snapshot_or_reservation_release',
        tier: 50,
        version: 2,
      },
    ]);
    expect(summary.liquidity.availableAmount).toBe('0');
  });

  test('reports unresolved reconciliation discrepancies as a readiness and risk blocker', async () => {
    const service = new HouseTreasuryService(
      summaryDatabase([
        {
          detail: 'Custody mismatch',
          entityReference: 'hinv_unresolved',
          expectedValue: '1',
          firstObservedAt: new Date('2026-07-29T10:00:00.000Z'),
          id: 'hdisc_unresolved',
          kind: 'inventory_custody',
          lastObservedAt: new Date('2026-07-29T10:05:00.000Z'),
          observedSlot: '50',
          observedValue: '0',
        },
      ]) as never,
      {} as never,
    );

    const summary = await withHouseEnvironment(() => service.getSummary());

    expect(summary.ready).toBe(false);
    expect(summary.risk.disableReasons).toContain('reconciliation_discrepancy');
    expect(summary.reconciliation.discrepancies).toHaveLength(1);
  });
});

interface LegacyTokenAccountFixture {
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
  mint: string;
  owner: string;
}

interface SnapshotWrite {
  balanceAmount: string;
  delegate: string;
  delegatedAmount: string;
  observedSlot: string;
  verifiedAt: Date;
  wallet: string;
}

interface ReconciliationInventoryRow {
  acquisitionValueAmount: string;
  acquisitionValueCurrency: string;
  acquisitionValueDecimals: number;
  assetReference: string;
  custodyWallet: string;
  duelId: string;
  id: string;
  listingState: HouseInventoryListingState;
  lastReconciledAt?: Date;
  lastReconciledSlot?: string;
  reconciliationError: string | null;
  status: HouseInventoryStatus;
  version: number;
}

class TreasuryRpc extends SolanaRpcGateway {
  constructor(
    private readonly account: LegacyTokenAccountFixture,
    private readonly slot = 1n,
  ) {
    super();
  }

  async assertDevnet(): Promise<void> {}
  async getBlockHeight(): Promise<bigint> {
    return 1n;
  }
  override async getFinalizedSlot(): Promise<bigint> {
    return this.slot;
  }
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    return { blockhash: HOT_WALLET, lastValidBlockHeight: 2n };
  }
  async getLegacyMint(): Promise<{ decimals: number; supply: bigint }> {
    return { decimals: 6, supply: 1_000_000_000n };
  }
  async getLegacyTokenAccount(): Promise<LegacyTokenAccountFixture> {
    return this.account;
  }
  async getFinalizedSignaturesForAddress(): Promise<[]> {
    return [];
  }
  async getSignatureStatuses(): Promise<[]> {
    return [];
  }
  async getTransaction(): Promise<null> {
    return null;
  }
}

class InventoryReconciliationRpc extends SolanaRpcGateway {
  #inventoryAccountRead = 0;
  #mintRead = 0;

  async assertDevnet(): Promise<void> {}
  async getBlockHeight(): Promise<bigint> {
    return 1n;
  }
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    return { blockhash: HOT_WALLET, lastValidBlockHeight: 2n };
  }
  async getLegacyMint(): Promise<{ decimals: number; supply: bigint }> {
    this.#mintRead += 1;
    return this.#mintRead === 1
      ? { decimals: 6, supply: 1_000_000_000n }
      : { decimals: 0, supply: 1n };
  }
  async getLegacyTokenAccount(address: string): Promise<LegacyTokenAccountFixture> {
    if (address === TOKEN_ACCOUNT) {
      return {
        amount: 150_000_000n,
        delegate: HOT_WALLET,
        delegatedAmount: 100_000_000n,
        mint: USDC_MINT,
        owner: COLD_OWNER,
      };
    }
    this.#inventoryAccountRead += 1;
    return {
      amount: 1n,
      delegate: null,
      delegatedAmount: 0n,
      mint: this.#inventoryAccountRead === 1 ? TOKEN_ACCOUNT : HOT_WALLET,
      owner: this.#inventoryAccountRead === 1 ? HOT_WALLET : COLD_OWNER,
    };
  }
  async getFinalizedSignaturesForAddress(): Promise<[]> {
    return [];
  }
  async getSignatureStatuses(): Promise<[]> {
    return [];
  }
  async getTransaction(): Promise<null> {
    return null;
  }
}

function treasuryDatabase(snapshots: SnapshotWrite[]) {
  const discrepancies: unknown[] = [];
  const transaction = {
    $executeRaw: () => Promise.resolve(1),
    houseInventoryAsset: { findMany: () => Promise.resolve([]) },
    houseReconciliationDiscrepancy: reconciliationDiscrepancyStore(discrepancies),
    houseTreasuryLedgerEntry: { findMany: () => Promise.resolve([]) },
    houseTreasurySnapshot: {
      findUnique: () => Promise.resolve(snapshots.at(-1) ?? null),
      upsert: ({ create }: { create: SnapshotWrite }) => {
        snapshots.push(create);
        return Promise.resolve(create);
      },
    },
  };
  return {
    ...transaction,
    $transaction: <T>(operation: (client: typeof transaction) => Promise<T>) =>
      operation(transaction),
  };
}

function inventoryReconciliationDatabase() {
  const inventory: ReconciliationInventoryRow[] = [
    {
      acquisitionValueAmount: '41000000',
      acquisitionValueCurrency: 'USDC',
      acquisitionValueDecimals: 6,
      assetReference: TOKEN_ACCOUNT,
      custodyWallet: HOT_WALLET,
      duelId: 'duel_verified_custody',
      id: 'hinv_verified_custody',
      listingState: HouseInventoryListingState.UNLISTED,
      reconciliationError: 'previous_mismatch',
      status: HouseInventoryStatus.RECONCILIATION_REQUIRED,
      version: 1,
    },
    {
      acquisitionValueAmount: '42000000',
      acquisitionValueCurrency: 'USDC',
      acquisitionValueDecimals: 6,
      assetReference: HOT_WALLET,
      custodyWallet: HOT_WALLET,
      duelId: 'duel_mismatched_custody',
      id: 'hinv_mismatched_custody',
      listingState: HouseInventoryListingState.UNLISTED,
      reconciliationError: null,
      status: HouseInventoryStatus.HELD,
      version: 1,
    },
  ];
  const ledger: LedgerWrite[] = [];
  const discrepancies: unknown[] = [];
  const transaction = {
    $executeRaw: () => Promise.resolve(1),
    houseInventoryAsset: {
      updateMany: ({
        data,
        where,
      }: {
        data: {
          lastReconciledAt: Date;
          lastReconciledSlot: string;
          reconciliationError: string | null;
          status: HouseInventoryStatus;
          version: { increment: number };
        };
        where: { id: string; version: number };
      }) => {
        const row = inventory.find(
          (candidate) => candidate.id === where.id && candidate.version === where.version,
        );
        if (!row) return Promise.resolve({ count: 0 });
        row.lastReconciledAt = data.lastReconciledAt;
        row.lastReconciledSlot = data.lastReconciledSlot;
        row.reconciliationError = data.reconciliationError;
        row.status = data.status;
        row.version += data.version.increment;
        return Promise.resolve({ count: 1 });
      },
    },
    houseTreasuryLedgerEntry: {
      create: ({ data }: { data: LedgerWrite }) => {
        ledger.push(data);
        return Promise.resolve(data);
      },
      findUnique: ({ where }: { where: { idempotencyKey: string } }) =>
        Promise.resolve(
          ledger.find((entry) => entry.idempotencyKey === where.idempotencyKey) ?? null,
        ),
      findMany: () => Promise.resolve([]),
    },
    houseReconciliationDiscrepancy: reconciliationDiscrepancyStore(discrepancies),
    houseTreasurySnapshot: {
      findUnique: () => Promise.resolve(null),
      upsert: () => Promise.resolve({}),
    },
  };
  return {
    database: {
      $transaction: <T>(operation: (client: typeof transaction) => Promise<T>) =>
        operation(transaction),
      houseInventoryAsset: { findMany: () => Promise.resolve(inventory) },
      houseReconciliationDiscrepancy: reconciliationDiscrepancyStore(discrepancies),
      houseTreasuryLedgerEntry: { findMany: () => Promise.resolve([]) },
      houseTreasurySnapshot: {
        findUnique: () => Promise.resolve(null),
        upsert: () => Promise.resolve({}),
      },
    },
    discrepancies,
    inventory,
    ledger,
  };
}

function summaryDatabase(discrepancies: Array<Record<string, unknown>> = []) {
  const reservations = [
    { amount: '10000000', status: HouseTreasuryReservationStatus.RESERVED, tier: 10 },
    { amount: '20000000', status: HouseTreasuryReservationStatus.FUNDED, tier: 20 },
    {
      amount: '30000000',
      status: HouseTreasuryReservationStatus.SETTLEMENT_PENDING,
      tier: 30,
    },
    {
      amount: '40000000',
      status: HouseTreasuryReservationStatus.RECOVERY_REQUIRED,
      tier: 40,
    },
    { amount: '500000000', status: HouseTreasuryReservationStatus.RELEASED, tier: 50 },
    { amount: '500000000', status: HouseTreasuryReservationStatus.SETTLED, tier: 50 },
  ];
  return {
    houseInventoryAsset: { findMany: () => Promise.resolve([]) },
    houseReconciliationDiscrepancy: { findMany: () => Promise.resolve(discrepancies) },
    houseTierAdmissionState: {
      findMany: () =>
        Promise.resolve([
          {
            disabled: true,
            evaluatedAt: new Date('2026-07-22T16:00:00.000Z'),
            reason: 'minimum_liquidity',
            reenableBoundary: 'fresh_treasury_snapshot_or_reservation_release',
            tier: 50,
            version: 2,
          },
        ]),
    },
    houseTreasuryLedgerEntry: { findMany: () => Promise.resolve([]) },
    houseTreasuryReservation: { findMany: () => Promise.resolve(reservations) },
    houseTreasurySnapshot: {
      findUnique: () =>
        Promise.resolve({
          balanceAmount: '150000000',
          balanceDecimals: 6,
          delegate: HOT_WALLET,
          delegatedAmount: '100000000',
          mint: USDC_MINT,
          network: 'DEVNET',
          observedSlot: '1',
          tokenAccount: TOKEN_ACCOUNT,
          verifiedAt: new Date(),
          wallet: COLD_OWNER,
        }),
    },
  };
}

function treasuryBalanceReconciliationDatabase(
  previous: Pick<SnapshotWrite, 'balanceAmount' | 'observedSlot' | 'verifiedAt'>,
  options: { failDiscrepancyWrite?: boolean } = {},
) {
  const snapshots = [
    {
      ...previous,
      delegate: HOT_WALLET,
      delegatedAmount: '100000000',
      wallet: COLD_OWNER,
    },
  ];
  const ledger: Array<{
    amount: string;
    createdAt: Date;
    type: HouseTreasuryLedgerType;
  }> = [];
  const discrepancies: unknown[] = [];
  const discrepancyStore = reconciliationDiscrepancyStore(discrepancies, {
    ...(options.failDiscrepancyWrite !== undefined
      ? { failUpsert: options.failDiscrepancyWrite }
      : {}),
  });
  let transactionTail = Promise.resolve();
  const transaction = {
    $executeRaw: () => Promise.resolve(1),
    houseReconciliationDiscrepancy: discrepancyStore,
    houseTreasuryLedgerEntry: {
      findMany: ({ where }: { where: { createdAt: { gt: Date } } }) =>
        Promise.resolve(ledger.filter((entry) => entry.createdAt > where.createdAt.gt)),
    },
    houseTreasurySnapshot: {
      findUnique: () => Promise.resolve(snapshots.at(-1) ?? null),
      upsert: ({
        create,
        update,
      }: {
        create: (typeof snapshots)[number];
        update: (typeof snapshots)[number];
      }) => {
        const next = snapshots.length === 0 ? create : update;
        snapshots.push(next);
        return Promise.resolve(next);
      },
    },
  };
  return {
    database: {
      $transaction: async <T>(operation: (client: typeof transaction) => Promise<T>) => {
        const previousTransaction = transactionTail;
        let release = () => {};
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previousTransaction;
        try {
          return await operation(transaction);
        } finally {
          release();
        }
      },
      houseInventoryAsset: { findMany: () => Promise.resolve([]) },
      houseReconciliationDiscrepancy: discrepancyStore,
      houseTreasuryLedgerEntry: {
        findMany: ({ where }: { where: { createdAt: { gt: Date } } }) =>
          Promise.resolve(ledger.filter((entry) => entry.createdAt > where.createdAt.gt)),
      },
      houseTreasurySnapshot: {
        findUnique: () => Promise.resolve(snapshots.at(-1) ?? null),
        upsert: ({
          create,
          update,
        }: {
          create: (typeof snapshots)[number];
          update: (typeof snapshots)[number];
        }) => {
          const next = snapshots.length === 0 ? create : update;
          snapshots.push(next);
          return Promise.resolve(next);
        },
      },
    },
    discrepancies,
    ledger,
    snapshots,
  };
}

function reconciliationDiscrepancyStore(rows: unknown[], options: { failUpsert?: boolean } = {}) {
  return {
    findFirst: () => {
      const unresolved = rows
        .filter(
          (row): row is Record<string, unknown> =>
            typeof row === 'object' &&
            row !== null &&
            (row as Record<string, unknown>).resolvedAt == null,
        )
        .sort(
          (left, right) =>
            new Date(String(right.lastObservedAt)).getTime() -
            new Date(String(left.lastObservedAt)).getTime(),
        );
      return Promise.resolve(unresolved[0] ?? null);
    },
    updateMany: ({
      data,
      where,
    }: {
      data: { resolvedAt: Date };
      where: { entityReference: string; kind: string; resolvedAt: null };
    }) => {
      let count = 0;
      for (const row of rows) {
        if (
          typeof row === 'object' &&
          row !== null &&
          'entityReference' in row &&
          row.entityReference === where.entityReference &&
          'kind' in row &&
          row.kind === where.kind &&
          'resolvedAt' in row &&
          row.resolvedAt === null
        ) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
    upsert: ({
      create,
      update,
      where,
    }: {
      create: { idempotencyKey: string };
      update: Record<string, unknown>;
      where: { idempotencyKey: string };
    }) => {
      if (options.failUpsert) throw new Error('discrepancy write failed');
      const existing = rows.find(
        (row) =>
          typeof row === 'object' &&
          row !== null &&
          'idempotencyKey' in row &&
          row.idempotencyKey === where.idempotencyKey,
      );
      if (!existing) rows.push({ ...create, resolvedAt: null });
      else if (typeof existing === 'object' && existing !== null) Object.assign(existing, update);
      return Promise.resolve(existing ?? create);
    },
  };
}

interface ReservationFixture {
  amount: string;
  currency: string;
  decimals: number;
  duel: {
    creatorWallet: string;
    opponentWallet: string | null;
    packOutcomes: OutcomeFixture[];
    status: DuelStatus;
    winnerWallet: string | null;
  };
  duelId: string;
  id: string;
  lastReconciledAt: Date | null;
  status: HouseTreasuryReservationStatus;
  version: number;
}

interface OutcomeFixture {
  assetReference: string;
  displayName: string;
  id: string;
  insuredValueAmount: string;
  insuredValueCurrency: string;
  insuredValueDecimals: number;
  side: DuelSide;
}

function reservation(
  id: string,
  duelStatus: DuelStatus,
  duel: Partial<ReservationFixture['duel']> = {},
): ReservationFixture {
  return {
    amount: '50000000',
    currency: 'USDC',
    decimals: 6,
    duel: {
      creatorWallet: COLD_OWNER,
      opponentWallet: HOT_WALLET,
      packOutcomes: [],
      status: duelStatus,
      winnerWallet: null,
      ...duel,
    },
    duelId: `duel_${id}`,
    id,
    lastReconciledAt: null,
    status: HouseTreasuryReservationStatus.RESERVED,
    version: 1,
  };
}

function outcomes(prefix = 'outcome'): OutcomeFixture[] {
  return [
    outcome(`${prefix}_creator`, DuelSide.CREATOR),
    outcome(`${prefix}_opponent`, DuelSide.OPPONENT),
  ];
}

function outcome(id: string, side: DuelSide): OutcomeFixture {
  return {
    assetReference: `${id}_mint`,
    displayName: `${side.toLowerCase()} card`,
    id,
    insuredValueAmount: '50000000',
    insuredValueCurrency: 'USDC',
    insuredValueDecimals: 6,
    side,
  };
}

interface InventoryWrite {
  acquisitionValueAmount: string;
  acquisitionValueCurrency: string;
  acquisitionValueDecimals: number;
  assetReference: string;
  buybackEligible: boolean;
  buybackExpiresAt: Date | null;
  buybackValueAmount: string | null;
  buybackValueCurrency: string | null;
  buybackValueDecimals: number | null;
  custodyWallet: string;
  displayedValueAmount: string | null;
  displayedValueCurrency: string | null;
  displayedValueDecimals: number | null;
  displayName: string;
  disposition: string;
  duelId: string;
  id: string;
  insuredValueAmount: string;
  insuredValueCurrency: string;
  insuredValueDecimals: number;
  listingState: string;
  listingValueAmount: string | null;
  listingValueCurrency: string | null;
  listingValueDecimals: number | null;
  outcomeId: string;
  status: string;
}

interface LedgerWrite {
  idempotencyKey: string;
  metadata?: unknown;
  type: HouseTreasuryLedgerType;
}

function lifecycleDatabase(reservations: ReservationFixture[]) {
  const ledgerKeys = new Set<string>();
  const inventory: InventoryWrite[] = [];
  const ledger: LedgerWrite[] = [];
  const transaction = {
    $executeRaw: () => Promise.resolve(1),
    houseInventoryAsset: {
      create: ({ data }: { data: InventoryWrite }) => {
        inventory.push(data);
        return Promise.resolve(data);
      },
      findUnique: ({ where }: { where: { outcomeId: string } }) =>
        Promise.resolve(inventory.find((row) => row.outcomeId === where.outcomeId) ?? null),
      findFirst: ({ where }: { where: { assetReference: string } }) =>
        Promise.resolve(
          inventory.find((row) => row.assetReference === where.assetReference) ?? null,
        ),
    },
    houseTreasuryLedgerEntry: {
      create: ({ data }: { data: LedgerWrite }) => {
        ledgerKeys.add(data.idempotencyKey);
        ledger.push(data);
        return Promise.resolve(data);
      },
      findUnique: ({ where }: { where: { idempotencyKey: string } }) =>
        Promise.resolve(ledgerKeys.has(where.idempotencyKey) ? { id: 'existing' } : null),
    },
    houseTreasuryReservation: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(reservations.find((row) => row.id === where.id) ?? null),
      updateMany: ({
        data,
        where,
      }: {
        data: {
          lastReconciledAt?: Date;
          status?: HouseTreasuryReservationStatus;
          version: { increment: number };
        };
        where: { id: string; status: HouseTreasuryReservationStatus; version: number };
      }) => {
        const row = reservations.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.status === where.status &&
            candidate.version === where.version,
        );
        if (!row) return Promise.resolve({ count: 0 });
        if (data.lastReconciledAt) row.lastReconciledAt = data.lastReconciledAt;
        if (data.status) row.status = data.status;
        row.version += data.version.increment;
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const database = {
    $transaction: (
      operation: (client: typeof transaction) => Promise<{
        inventoryCreated: number;
        released: boolean;
        transitioned: boolean;
      }>,
    ) => operation(transaction),
    houseInventoryAsset: { findMany: () => Promise.resolve(inventory) },
    houseTreasuryReservation: {
      findMany: ({ take }: { take: number }) =>
        Promise.resolve(
          reservations
            .filter((row) => ACTIVE_HOUSE_RESERVATION_STATUSES.includes(row.status))
            .sort((left, right) => {
              if (!left.lastReconciledAt && right.lastReconciledAt) return -1;
              if (left.lastReconciledAt && !right.lastReconciledAt) return 1;
              const time =
                (left.lastReconciledAt?.getTime() ?? 0) - (right.lastReconciledAt?.getTime() ?? 0);
              return time === 0 ? left.id.localeCompare(right.id) : time;
            })
            .slice(0, take),
        ),
    },
  };
  return { database, inventory, ledger };
}

async function withHouseEnvironment<T>(operation: () => Promise<T>): Promise<T> {
  const values: Record<string, string> = {
    DAILYDRAFT_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO: '100000000',
    DAILYDRAFT_HOUSE_DEVNET_FUNDING_SIGNER: HOT_WALLET,
    DAILYDRAFT_HOUSE_DEVNET_USDC_MINT: USDC_MINT,
    DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT: TOKEN_ACCOUNT,
    DAILYDRAFT_HOUSE_DEVNET_WALLET: HOT_WALLET,
    DAILYDRAFT_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY: COLD_OWNER,
    DAILYDRAFT_HOUSE_ENABLED: 'true',
    DAILYDRAFT_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO: '100000000',
    DAILYDRAFT_HOUSE_MIN_LIQUIDITY_USDC_MICRO: '20000000',
    DAILYDRAFT_NETWORK: 'solana-devnet',
  };
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
