import { describe, expect, test } from 'bun:test';
import {
  HouseTreasuryLedgerType,
  HouseTreasuryReservationStatus,
  type Prisma,
} from '@openpacksduel/db';

import { reserveHouseExposure } from './house-treasury.policy.js';

const NOW = new Date('2026-07-20T12:00:00.000Z');
const HOUSE = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
const WITHDRAWAL = '66KTYU8iBq36MBX8fG1vR8c1mh5T8LDqcP41wqmg2Zjs';
const TOKEN_ACCOUNT = '8t9zGQDVsTZhz4kB8DD5qGx7PyHhNzxpmBo3ZNnQ2Uhg';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('house treasury reservation transactions', () => {
  test('serializes concurrent retries into one reservation and one ledger entry', async () => {
    const database = new ReservationDatabase();
    const input = reservationInput('duel_concurrent_retry');

    await Promise.all([database.reserve(input), database.reserve(input)]);

    expect(database.lockAcquisitions).toBe(2);
    expect(database.reservations).toHaveLength(1);
    expect(database.ledger).toEqual([
      expect.objectContaining({
        idempotencyKey: 'reservation-created:duel_concurrent_retry',
        type: HouseTreasuryLedgerType.RESERVATION_CREATED,
      }),
    ]);
  });

  test('evaluates concurrent duels against one locked exposure snapshot', async () => {
    const database = new ReservationDatabase();
    const environment = configuredEnvironment();
    environment.OPENPACKSDUEL_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO = '50000000';

    const results = await Promise.allSettled([
      database.reserve(reservationInput('duel_concurrent_a'), environment),
      database.reserve(reservationInput('duel_concurrent_b'), environment),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(
      results.find(({ status }) => status === 'rejected'),
    ).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringContaining('total exposure limit'),
      }),
    });
    expect(database.lockAcquisitions).toBe(2);
    expect(database.reservations).toHaveLength(1);
    expect(database.ledger).toHaveLength(1);
  });

  test('counts every active exposure state once when enforcing the total limit', async () => {
    const database = new ReservationDatabase();
    for (const status of [
      HouseTreasuryReservationStatus.RESERVED,
      HouseTreasuryReservationStatus.FUNDED,
      HouseTreasuryReservationStatus.SETTLEMENT_PENDING,
      HouseTreasuryReservationStatus.RECOVERY_REQUIRED,
    ]) {
      database.seedReservation(status, '10000000');
    }
    const environment = configuredEnvironment();
    environment.OPENPACKSDUEL_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO = '200000000';
    environment.OPENPACKSDUEL_HOUSE_MIN_LIQUIDITY_USDC_MICRO = '1000000';

    await expect(
      database.reserve(
        { ...reservationInput('duel_active_exposure'), amount: '61000000' },
        environment,
      ),
    ).rejects.toThrow('total exposure limit');

    expect(database.reservations).toHaveLength(4);
    expect(database.ledger).toEqual([]);
  });

  test('excludes released and settled reservations from active exposure', async () => {
    const database = new ReservationDatabase();
    database.seedReservation(HouseTreasuryReservationStatus.RELEASED, '900000000');
    database.seedReservation(HouseTreasuryReservationStatus.SETTLED, '900000000');

    await database.reserve(reservationInput('duel_terminal_exposure'));

    expect(database.reservations).toHaveLength(3);
    expect(database.reservations.at(-1)?.status).toBe(HouseTreasuryReservationStatus.RESERVED);
  });

  test('rejects missing reviewed policy before acquiring a database lock', async () => {
    const database = new ReservationDatabase();

    await expect(database.reserve(reservationInput('duel_disabled'), {})).rejects.toThrow(
      'house_disabled',
    );

    expect(database.lockAcquisitions).toBe(0);
    expect(database.reservations).toEqual([]);
    expect(database.ledger).toEqual([]);
  });

  test('fails closed when an enabled policy omits a signer or exposure limit', async () => {
    for (const key of [
      'OPENPACKSDUEL_HOUSE_DEVNET_FUNDING_SIGNER',
      'OPENPACKSDUEL_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO',
    ]) {
      const database = new ReservationDatabase();
      const environment = configuredEnvironment();
      delete environment[key];

      await expect(
        database.reserve(reservationInput(`duel_missing_${key.toLowerCase()}`), environment),
      ).rejects.toThrow('House treasury is unavailable');
      expect(database.lockAcquisitions).toBe(0);
      expect(database.reservations).toEqual([]);
    }
  });
});

interface ReservationRow {
  amount: string;
  duelId: string;
  id: string;
  playerWallet: string;
  status: HouseTreasuryReservationStatus;
  tier: number;
}

interface LedgerRow {
  idempotencyKey: string;
  type: HouseTreasuryLedgerType;
}

class ReservationDatabase {
  readonly reservations: ReservationRow[] = [];
  readonly ledger: LedgerRow[] = [];
  lockAcquisitions = 0;
  #lockTail = Promise.resolve();
  #seed = 0;

  async reserve(
    input: ReturnType<typeof reservationInput>,
    environment = configuredEnvironment(),
  ): Promise<void> {
    return this.$transaction((transaction) =>
      reserveHouseExposure(transaction, input, environment, NOW),
    );
  }

  seedReservation(status: HouseTreasuryReservationStatus, amount: string): void {
    this.#seed += 1;
    this.reservations.push({
      amount,
      duelId: `duel_seed_${this.#seed}`,
      id: `hres_seed_${this.#seed}`,
      playerWallet: `${WITHDRAWAL}_${this.#seed}`,
      status,
      tier: 50,
    });
  }

  async $transaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    let releaseLock: (() => void) | undefined;
    const transaction = {
      $queryRaw: async () => {
        releaseLock = await this.acquireLock();
        this.lockAcquisitions += 1;
        return [{ pg_advisory_xact_lock: '' }];
      },
      houseTreasuryLedgerEntry: {
        create: async ({ data }: { data: LedgerRow }) => {
          this.ledger.push(data);
          return data;
        },
        findMany: async () => [],
      },
      houseTreasuryReservation: {
        count: async ({
          where,
        }: {
          where: {
            playerWallet?: string;
            status: { in: HouseTreasuryReservationStatus[] };
            tier?: number;
          };
        }) =>
          this.activeReservations(where.status.in).filter(
            (row) =>
              (where.playerWallet === undefined || row.playerWallet === where.playerWallet) &&
              (where.tier === undefined || row.tier === where.tier),
          ).length,
        create: async ({
          data,
        }: {
          data: Omit<ReservationRow, 'status'>;
        }) => {
          const row = { ...data, status: HouseTreasuryReservationStatus.RESERVED };
          this.reservations.push(row);
          return row;
        },
        findMany: async ({
          where,
        }: {
          where: { status: { in: HouseTreasuryReservationStatus[] } };
        }) => this.activeReservations(where.status.in).map(({ amount }) => ({ amount })),
        findUnique: async ({ where }: { where: { duelId: string } }) =>
          this.reservations.find((row) => row.duelId === where.duelId) ?? null,
      },
      houseTreasurySnapshot: {
        findUnique: async () => ({
          balanceAmount: '100000000',
          balanceDecimals: 6,
          delegate: HOUSE,
          delegatedAmount: '100000000',
          mint: USDC_MINT,
          network: 'DEVNET',
          tokenAccount: TOKEN_ACCOUNT,
          verifiedAt: new Date('2026-07-20T11:59:00.000Z'),
          wallet: WITHDRAWAL,
        }),
      },
    } as unknown as Prisma.TransactionClient;

    try {
      return await operation(transaction);
    } finally {
      releaseLock?.();
    }
  }

  private activeReservations(statuses: HouseTreasuryReservationStatus[]) {
    return this.reservations.filter((row) => statuses.includes(row.status));
  }

  private async acquireLock(): Promise<() => void> {
    const previous = this.#lockTail;
    let release = () => {};
    this.#lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }
}

function reservationInput(duelId: string) {
  return {
    amount: '50000000',
    currency: 'USDC',
    decimals: 6,
    duelId,
    playerWallet: WITHDRAWAL,
    tier: 50,
  };
}

function configuredEnvironment(): NodeJS.ProcessEnv {
  return {
    OPENPACKSDUEL_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO: '100000000',
    OPENPACKSDUEL_HOUSE_DEVNET_FUNDING_SIGNER: HOUSE,
    OPENPACKSDUEL_HOUSE_DEVNET_USDC_MINT: USDC_MINT,
    OPENPACKSDUEL_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT: TOKEN_ACCOUNT,
    OPENPACKSDUEL_HOUSE_DEVNET_WALLET: HOUSE,
    OPENPACKSDUEL_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY: WITHDRAWAL,
    OPENPACKSDUEL_HOUSE_ENABLED: 'true',
    OPENPACKSDUEL_HOUSE_MAX_ACTIVE_PER_WALLET: '10',
    OPENPACKSDUEL_HOUSE_MAX_CONCURRENT_PER_TIER: '10',
    OPENPACKSDUEL_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO: '100000000',
    OPENPACKSDUEL_HOUSE_MIN_LIQUIDITY_USDC_MICRO: '20000000',
    OPENPACKSDUEL_NETWORK: 'solana-devnet',
  };
}
