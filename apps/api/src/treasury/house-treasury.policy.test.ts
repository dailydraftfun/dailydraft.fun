import { describe, expect, test } from 'bun:test';
import {
  type DatabaseClient,
  DuelStatus,
  HouseTreasuryReservationStatus,
  type Prisma,
} from '@dailydraft/db';
import { HttpStatus } from '@nestjs/common';

import {
  evaluateHouseExposureLimits,
  HouseTierAdmissionError,
  houseTreasuryConfigurationErrors,
  persistHouseTierAdmissionFailure,
  persistHouseTierAdmissionFailureSafely,
  readHouseTreasuryConfig,
  reserveHouseExposure,
} from './house-treasury.policy.js';
import { reservationTarget } from './house-treasury.service.js';

const HOUSE = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
const WITHDRAWAL = '66KTYU8iBq36MBX8fG1vR8c1mh5T8LDqcP41wqmg2Zjs';
const TOKEN_ACCOUNT = '8t9zGQDVsTZhz4kB8DD5qGx7PyHhNzxpmBo3ZNnQ2Uhg';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('house treasury policy', () => {
  test('evaluates every configured exposure limit with stable reasons', () => {
    const cases = [
      { expected: 'player_exposure', snapshot: { activePerWallet: 2 } },
      { expected: 'tier_concurrency', snapshot: { activePerTier: 3 } },
      { expected: 'daily_loss', snapshot: { dailyLoss: 161n } },
      { expected: 'total_exposure', snapshot: { requested: 71n } },
      { expected: 'minimum_liquidity', snapshot: { verifiedBalance: 59n } },
      { expected: 'delegated_allowance', snapshot: { delegatedAmount: 39n } },
    ] as const;

    for (const { expected, snapshot } of cases) {
      expect(evaluateHouseExposureLimits(limitConfig(), limitSnapshot(snapshot))).toEqual({
        allowed: false,
        reason: expected,
      });
    }
  });

  test('allows exact boundaries and rejects only values beyond them', () => {
    const boundaries = [
      limitSnapshot({ activePerWallet: 1 }),
      limitSnapshot({ activePerTier: 2 }),
      limitSnapshot({ dailyLoss: 160n }),
      limitSnapshot({ requested: 70n }),
      limitSnapshot({ verifiedBalance: 60n }),
      limitSnapshot({ delegatedAmount: 40n }),
    ];

    for (const snapshot of boundaries) {
      expect(evaluateHouseExposureLimits(limitConfig(), snapshot)).toEqual({ allowed: true });
    }
  });

  test('uses a deterministic fail-closed precedence when several limits are exceeded', () => {
    expect(
      evaluateHouseExposureLimits(
        limitConfig(),
        limitSnapshot({
          activePerTier: 3,
          activePerWallet: 2,
          dailyLoss: 200n,
          delegatedAmount: 0n,
          requested: 100n,
          verifiedBalance: 0n,
        }),
      ),
    ).toEqual({ allowed: false, reason: 'player_exposure' });
  });

  test('fails closed by default', () => {
    const config = readHouseTreasuryConfig({});
    expect(config.enabled).toBe(false);
    expect(config.maxTotalExposure).toBe(0n);
    expect(houseTreasuryConfigurationErrors(config)).toContain('house_disabled');
    expect(houseTreasuryConfigurationErrors(config)).toContain('total_exposure_limit_missing');
  });

  test('requires withdrawal authority separation', () => {
    const environment = configuredEnvironment();
    environment.DAILYDRAFT_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY = HOUSE;
    expect(houseTreasuryConfigurationErrors(readHouseTreasuryConfig(environment))).toContain(
      'withdrawal_authority_not_separated',
    );
  });

  test('bounds invalid concurrency configuration and disables missing amount limits', () => {
    const config = readHouseTreasuryConfig({
      ...configuredEnvironment(),
      DAILYDRAFT_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO: 'invalid',
      DAILYDRAFT_HOUSE_MAX_ACTIVE_PER_WALLET: '2junk',
      DAILYDRAFT_HOUSE_MAX_CONCURRENT_PER_TIER: '0',
      DAILYDRAFT_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO: '-1',
      DAILYDRAFT_HOUSE_MIN_LIQUIDITY_USDC_MICRO: '',
    });

    expect(config.maxActivePerWallet).toBe(1);
    expect(config.maxConcurrentPerTier).toBe(1);
    expect(houseTreasuryConfigurationErrors(config)).toEqual(
      expect.arrayContaining([
        'total_exposure_limit_missing',
        'daily_loss_limit_missing',
        'minimum_liquidity_missing',
      ]),
    );
  });

  test('rejects malformed or zero exposure before acquiring the treasury lock', async () => {
    const invalidInputs = [
      { amount: '0' },
      { amount: '-1' },
      { amount: '1.5' },
      { amount: '1000000micro' },
      { currency: 'USD' },
      { decimals: 9 },
      { tier: 0 },
      { tier: 1.5 },
    ];

    for (const invalid of invalidInputs) {
      let lockAcquired = false;
      const transaction = {
        $executeRaw: () => {
          lockAcquired = true;
          return Promise.resolve(1);
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        reserveHouseExposure(
          transaction,
          {
            amount: '50000000',
            currency: 'USDC',
            decimals: 6,
            duelId: 'duel_invalid_exposure',
            playerWallet: WITHDRAWAL,
            tier: 50,
            ...invalid,
          },
          configuredEnvironment(),
        ),
      ).rejects.toThrow(
        'House exposure requires positive integer six-decimal USDC and a positive integer tier',
      );
      expect(lockAcquired).toBe(false);
    }
  });

  test('reserves against a fresh finalized snapshot and records an append-only entry', async () => {
    const created: unknown[] = [];
    const transaction = fakeTransaction({ created, existingExposure: [] });
    await reserveHouseExposure(
      transaction,
      {
        amount: '50000000',
        currency: 'USDC',
        decimals: 6,
        duelId: 'duel_policy123456',
        playerWallet: WITHDRAWAL,
        tier: 50,
      },
      configuredEnvironment(),
      new Date('2026-07-15T12:00:00.000Z'),
    );
    expect(created).toHaveLength(2);
  });

  test('disables a tier before payment when verified liquidity would cross the floor', async () => {
    const admissionStates: TierAdmissionState[] = [];
    const transaction = fakeTransaction({
      admissionStates,
      created: [],
      existingExposure: [{ amount: '40000000' }],
    });
    let rejection: unknown;
    try {
      await reserveHouseExposure(
        transaction,
        {
          amount: '50000000',
          currency: 'USDC',
          decimals: 6,
          duelId: 'duel_policy654321',
          playerWallet: WITHDRAWAL,
          tier: 50,
        },
        configuredEnvironment(),
        new Date('2026-07-15T12:00:00.000Z'),
      );
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toMatchObject({
      message: expect.stringContaining('minimum liquidity'),
      reason: 'minimum_liquidity',
      reenableBoundary: 'fresh_treasury_snapshot_or_reservation_release',
      tier: 50,
    });
    expect(admissionStates).toEqual([]);
  });

  test('does not disable a healthy tier for a wallet-scoped exposure rejection', async () => {
    const admissionStates: TierAdmissionState[] = [];
    const transaction = fakeTransaction({
      admissionStates,
      created: [],
      existingExposure: [],
      walletActive: 2,
    });

    await expect(
      reserveHouseExposure(
        transaction,
        {
          amount: '10000000',
          currency: 'USDC',
          decimals: 6,
          duelId: 'duel_wallet_scoped_limit',
          playerWallet: WITHDRAWAL,
          tier: 50,
        },
        configuredEnvironment(),
        new Date('2026-07-15T12:00:00.000Z'),
      ),
    ).rejects.toThrow('player exposure limit');
    expect(admissionStates).toEqual([]);
  });

  test('re-enables a tier when a later locked reservation satisfies every limit', async () => {
    const admissionStates: TierAdmissionState[] = [
      {
        disabled: true,
        evaluatedAt: new Date('2026-07-15T11:00:00.000Z'),
        reason: 'minimum_liquidity',
        reenableBoundary: 'fresh_treasury_snapshot_or_reservation_release',
        tier: 50,
        version: 1,
      },
    ];
    const transaction = fakeTransaction({ admissionStates, created: [], existingExposure: [] });

    await reserveHouseExposure(
      transaction,
      {
        amount: '10000000',
        currency: 'USDC',
        decimals: 6,
        duelId: 'duel_tier_reenabled',
        playerWallet: WITHDRAWAL,
        tier: 50,
      },
      configuredEnvironment(),
      new Date('2026-07-15T12:00:00.000Z'),
    );

    expect(admissionStates).toEqual([
      expect.objectContaining({
        disabled: false,
        reason: null,
        reenableBoundary: null,
        tier: 50,
        version: 2,
      }),
    ]);
  });

  test('persists a rolled-back tier denial in the caller recovery transaction', async () => {
    const admissionStates: TierAdmissionState[] = [];
    const transaction = fakeTransaction({
      admissionStates,
      created: [],
      existingExposure: [{ amount: '40000000' }],
    });
    let rejection: unknown;
    try {
      await reserveHouseExposure(
        transaction,
        {
          amount: '50000000',
          currency: 'USDC',
          decimals: 6,
          duelId: 'duel_persisted_denial',
          playerWallet: WITHDRAWAL,
          tier: 50,
        },
        configuredEnvironment(),
        new Date('2026-07-15T12:00:00.000Z'),
      );
    } catch (error) {
      rejection = error;
    }
    admissionStates.length = 0;

    expect(await persistHouseTierAdmissionFailure(transaction, rejection)).toBe(true);
    expect(admissionStates[0]).toMatchObject({
      disabled: true,
      reason: 'minimum_liquidity',
      tier: 50,
    });
  });

  test('records the tier denial inside its own transaction when persisting safely', async () => {
    const admissionStates: TierAdmissionState[] = [];
    const transaction = fakeTransaction({ admissionStates, created: [], existingExposure: [] });
    let transactionCalls = 0;
    const database = {
      $transaction: (run: (client: Prisma.TransactionClient) => Promise<unknown>) => {
        transactionCalls += 1;
        return run(transaction);
      },
    } as unknown as DatabaseClient;

    await persistHouseTierAdmissionFailureSafely(database, tierAdmissionError());

    expect(transactionCalls).toBe(1);
    expect(admissionStates[0]).toMatchObject({
      disabled: true,
      reason: 'minimum_liquidity',
      tier: 50,
    });
  });

  test('swallows a failed bookkeeping write so the original reservation error survives', async () => {
    const database = {
      $transaction: () => Promise.reject(new Error('unapplied migration')),
    } as unknown as DatabaseClient;

    // Must resolve — the caller's HouseTierAdmissionError contract and replay path
    // cannot be replaced by a transient failure in observability-only bookkeeping.
    await expect(
      persistHouseTierAdmissionFailureSafely(database, tierAdmissionError()),
    ).resolves.toBeUndefined();
  });

  test('never opens a transaction for a non-tier-admission error', async () => {
    let transactionCalls = 0;
    const database = {
      $transaction: () => {
        transactionCalls += 1;
        return Promise.resolve();
      },
    } as unknown as DatabaseClient;

    await persistHouseTierAdmissionFailureSafely(database, new Error('unrelated failure'));

    expect(transactionCalls).toBe(0);
  });

  test('allows an exact reservation replay while emergency pause blocks new admission', async () => {
    const existingReservation = {
      amount: '50000000',
      currency: 'USDC',
      decimals: 6,
      playerWallet: WITHDRAWAL,
      tier: 50,
    };
    const replay = fakeTransaction({
      created: [],
      existingExposure: [],
      existingReservation,
      paused: true,
    });
    const fresh = fakeTransaction({ created: [], existingExposure: [], paused: true });

    await expect(
      reserveHouseExposure(
        replay,
        { ...existingReservation, duelId: 'duel_paused_replay' },
        configuredEnvironment(),
      ),
    ).resolves.toBeUndefined();
    await expect(
      reserveHouseExposure(
        fresh,
        { ...existingReservation, duelId: 'duel_paused_new' },
        configuredEnvironment(),
      ),
    ).rejects.toThrow('paused by an operator');
  });

  test('includes unresolved reservations in atomic daily-loss headroom', async () => {
    const environment = configuredEnvironment();
    environment.DAILYDRAFT_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO = '50000000';
    const transaction = fakeTransaction({
      created: [],
      existingExposure: [{ amount: '50000000' }],
    });
    await expect(
      reserveHouseExposure(
        transaction,
        {
          amount: '50000000',
          currency: 'USDC',
          decimals: 6,
          duelId: 'duel_daily_loss_limit',
          playerWallet: WITHDRAWAL,
          tier: 50,
        },
        environment,
        new Date('2026-07-15T12:00:00.000Z'),
      ),
    ).rejects.toThrow('daily loss limit');
  });

  test('maps reconciliation lifecycle states without reopening terminal exposure', () => {
    expect(reservationTarget(DuelStatus.FUNDED)).toBe(HouseTreasuryReservationStatus.FUNDED);
    expect(reservationTarget(DuelStatus.SETTLING)).toBe(
      HouseTreasuryReservationStatus.SETTLEMENT_PENDING,
    );
    expect(reservationTarget(DuelStatus.REFUNDING)).toBe(
      HouseTreasuryReservationStatus.RECOVERY_REQUIRED,
    );
    expect(reservationTarget(DuelStatus.REFUNDED)).toBe(HouseTreasuryReservationStatus.RELEASED);
    expect(reservationTarget(DuelStatus.SETTLED)).toBe(HouseTreasuryReservationStatus.SETTLED);
  });
});

function configuredEnvironment(): NodeJS.ProcessEnv {
  return {
    DAILYDRAFT_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO: '100000000',
    DAILYDRAFT_HOUSE_DEVNET_FUNDING_SIGNER: HOUSE,
    DAILYDRAFT_HOUSE_DEVNET_USDC_MINT: USDC_MINT,
    DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT: TOKEN_ACCOUNT,
    DAILYDRAFT_HOUSE_DEVNET_WALLET: HOUSE,
    DAILYDRAFT_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY: WITHDRAWAL,
    DAILYDRAFT_HOUSE_ENABLED: 'true',
    DAILYDRAFT_HOUSE_MAX_ACTIVE_PER_WALLET: '2',
    DAILYDRAFT_HOUSE_MAX_CONCURRENT_PER_TIER: '2',
    DAILYDRAFT_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO: '100000000',
    DAILYDRAFT_HOUSE_MIN_LIQUIDITY_USDC_MICRO: '20000000',
    DAILYDRAFT_NETWORK: 'solana-devnet',
  };
}

function limitConfig() {
  return {
    dailyLossLimit: 200n,
    maxActivePerWallet: 2,
    maxConcurrentPerTier: 3,
    maxTotalExposure: 100n,
    minimumLiquidity: 20n,
  };
}

function limitSnapshot(overrides: Partial<Parameters<typeof evaluateHouseExposureLimits>[1]> = {}) {
  return {
    activePerTier: 0,
    activePerWallet: 0,
    dailyLoss: 20n,
    delegatedAmount: 100n,
    requested: 10n,
    totalExposure: 30n,
    verifiedBalance: 150n,
    ...overrides,
  };
}

function tierAdmissionError(): HouseTierAdmissionError {
  return new HouseTierAdmissionError(
    'House tier temporarily unavailable',
    HttpStatus.SERVICE_UNAVAILABLE,
    50,
    'minimum_liquidity',
    'fresh_treasury_snapshot_or_reservation_release',
    new Date('2026-07-15T12:00:00.000Z'),
  );
}

interface TierAdmissionState {
  disabled: boolean;
  evaluatedAt: Date;
  reason: string | null;
  reenableBoundary: string | null;
  tier: number;
  version: number;
}

function fakeTransaction(input: {
  admissionStates?: TierAdmissionState[];
  created: unknown[];
  existingExposure: Array<{ amount: string }>;
  existingReservation?: {
    amount: string;
    currency: string;
    decimals: number;
    playerWallet: string;
    tier: number;
  };
  paused?: boolean;
  tierActive?: number;
  walletActive?: number;
}): Prisma.TransactionClient {
  const admissionStates = input.admissionStates ?? [];
  let advisoryLocks = 0;
  return {
    $executeRaw: (
      query: TemplateStringsArray,
      tier: number,
      disabled: boolean,
      reason: string | null,
      reenableBoundary: string | null,
      evaluatedAt: Date,
    ) => {
      if (query.join('').includes('pg_advisory_xact_lock')) {
        advisoryLocks += 1;
        return Promise.resolve(1);
      }
      const row = admissionStates.find((candidate) => candidate.tier === tier);
      if (!row) {
        admissionStates.push({
          disabled,
          evaluatedAt,
          reason,
          reenableBoundary,
          tier,
          version: 1,
        });
        return Promise.resolve(1);
      }
      if (row.evaluatedAt.getTime() > evaluatedAt.getTime()) return Promise.resolve(0);
      Object.assign(row, { disabled, evaluatedAt, reason, reenableBoundary });
      row.version += 1;
      return Promise.resolve(1);
    },
    $queryRaw: () => Promise.resolve([{ paused: input.paused ?? false }]),
    houseTreasuryLedgerEntry: {
      create: ({ data }: { data: unknown }) => {
        input.created.push(data);
        return Promise.resolve(data);
      },
      findMany: () => Promise.resolve([]),
    },
    houseTreasuryReservation: {
      count: ({ where }: { where: { playerWallet?: string; tier?: number } }) =>
        Promise.resolve(
          where.playerWallet !== undefined
            ? (input.walletActive ?? 0)
            : where.tier !== undefined
              ? (input.tierActive ?? 0)
              : 0,
        ),
      create: ({ data }: { data: unknown }) => {
        input.created.push(data);
        return Promise.resolve(data);
      },
      findMany: () => Promise.resolve(input.existingExposure),
      findUnique: () => Promise.resolve(input.existingReservation ?? null),
    },
    houseTreasurySnapshot: {
      findUnique: () =>
        Promise.resolve({
          balanceAmount: '100000000',
          balanceDecimals: 6,
          delegate: HOUSE,
          delegatedAmount: '100000000',
          mint: USDC_MINT,
          network: 'DEVNET',
          tokenAccount: TOKEN_ACCOUNT,
          verifiedAt: new Date('2026-07-15T11:59:00.000Z'),
          wallet: WITHDRAWAL,
        }),
    },
  } as unknown as Prisma.TransactionClient;
}
