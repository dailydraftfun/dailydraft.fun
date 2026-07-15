import { describe, expect, test } from 'bun:test';
import {
  DuelSide,
  DuelStatus,
  HouseTreasuryLedgerType,
  HouseTreasuryReservationStatus,
} from '@openpacksduel/db';

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
    expect(harness.ledger.map((row) => row.type)).toEqual([
      HouseTreasuryLedgerType.HOUSE_PACK_COST,
      HouseTreasuryLedgerType.HOUSE_WIN_INVENTORY,
    ]);
    expect(replay.checked).toBe(0);
    expect(harness.inventory).toHaveLength(1);
    expect(harness.ledger).toHaveLength(2);
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
  wallet: string;
}

class TreasuryRpc extends SolanaRpcGateway {
  constructor(private readonly account: LegacyTokenAccountFixture) {
    super();
  }

  async assertDevnet(): Promise<void> {}
  async getBlockHeight(): Promise<bigint> {
    return 1n;
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

function treasuryDatabase(snapshots: SnapshotWrite[]) {
  return {
    houseInventoryAsset: { findMany: () => Promise.resolve([]) },
    houseTreasurySnapshot: {
      upsert: ({ create }: { create: SnapshotWrite }) => {
        snapshots.push(create);
        return Promise.resolve(create);
      },
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
  outcomeId: string;
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
    houseInventoryAsset: {
      create: ({ data }: { data: InventoryWrite }) => {
        inventory.push(data);
        return Promise.resolve(data);
      },
      findUnique: ({ where }: { where: { outcomeId: string } }) =>
        Promise.resolve(inventory.find((row) => row.outcomeId === where.outcomeId) ?? null),
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
    OPENPACKSDUEL_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO: '100000000',
    OPENPACKSDUEL_HOUSE_DEVNET_FUNDING_SIGNER: HOT_WALLET,
    OPENPACKSDUEL_HOUSE_DEVNET_USDC_MINT: USDC_MINT,
    OPENPACKSDUEL_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT: TOKEN_ACCOUNT,
    OPENPACKSDUEL_HOUSE_DEVNET_WALLET: HOT_WALLET,
    OPENPACKSDUEL_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY: COLD_OWNER,
    OPENPACKSDUEL_HOUSE_ENABLED: 'true',
    OPENPACKSDUEL_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO: '100000000',
    OPENPACKSDUEL_HOUSE_MIN_LIQUIDITY_USDC_MICRO: '20000000',
    OPENPACKSDUEL_NETWORK: 'solana-devnet',
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
