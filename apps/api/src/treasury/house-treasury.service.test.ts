import { describe, expect, test } from 'bun:test';
import { DuelStatus, HouseTreasuryReservationStatus } from '@openpacksduel/db';

import { SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
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
    const service = new HouseTreasuryService(lifecycleDatabase(reservations) as never, {} as never);

    const first = await service.reconcileLifecycle(100);
    const second = await service.reconcileLifecycle(100);

    expect(first).toMatchObject({ checked: 100, released: 0 });
    expect(second.released).toBe(1);
    expect(terminal.status).toBe(HouseTreasuryReservationStatus.RELEASED);
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
    opponentWallet: string;
    packOutcomes: [];
    status: DuelStatus;
    winnerWallet: null;
  };
  duelId: string;
  id: string;
  lastReconciledAt: Date | null;
  status: HouseTreasuryReservationStatus;
  version: number;
}

function reservation(id: string, duelStatus: DuelStatus): ReservationFixture {
  return {
    amount: '50000000',
    currency: 'USDC',
    decimals: 6,
    duel: {
      opponentWallet: HOT_WALLET,
      packOutcomes: [],
      status: duelStatus,
      winnerWallet: null,
    },
    duelId: `duel_${id}`,
    id,
    lastReconciledAt: null,
    status: HouseTreasuryReservationStatus.RESERVED,
    version: 1,
  };
}

function lifecycleDatabase(reservations: ReservationFixture[]) {
  const ledgerKeys = new Set<string>();
  const transaction = {
    houseInventoryAsset: {
      create: () => Promise.reject(new Error('inventory creation is not expected')),
      findUnique: () => Promise.resolve(null),
    },
    houseTreasuryLedgerEntry: {
      create: ({ data }: { data: { idempotencyKey: string } }) => {
        ledgerKeys.add(data.idempotencyKey);
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
  return {
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
            .filter((row) =>
              [
                HouseTreasuryReservationStatus.RESERVED,
                HouseTreasuryReservationStatus.FUNDED,
                HouseTreasuryReservationStatus.SETTLEMENT_PENDING,
                HouseTreasuryReservationStatus.RECOVERY_REQUIRED,
              ].includes(row.status),
            )
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
