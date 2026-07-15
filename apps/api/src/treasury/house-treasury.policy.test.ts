import { describe, expect, test } from 'bun:test';
import { DuelStatus, HouseTreasuryReservationStatus, type Prisma } from '@openpacksduel/db';

import {
  houseTreasuryConfigurationErrors,
  readHouseTreasuryConfig,
  reserveHouseExposure,
} from './house-treasury.policy.js';
import { reservationTarget } from './house-treasury.service.js';

const HOUSE = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
const WITHDRAWAL = '66KTYU8iBq36MBX8fG1vR8c1mh5T8LDqcP41wqmg2Zjs';
const TOKEN_ACCOUNT = '8t9zGQDVsTZhz4kB8DD5qGx7PyHhNzxpmBo3ZNnQ2Uhg';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('house treasury policy', () => {
  test('fails closed by default', () => {
    const config = readHouseTreasuryConfig({});
    expect(config.enabled).toBe(false);
    expect(config.maxTotalExposure).toBe(0n);
    expect(houseTreasuryConfigurationErrors(config)).toContain('house_disabled');
    expect(houseTreasuryConfigurationErrors(config)).toContain('total_exposure_limit_missing');
  });

  test('requires withdrawal authority separation', () => {
    const environment = configuredEnvironment();
    environment.OPENPACKSDUEL_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY = HOUSE;
    expect(houseTreasuryConfigurationErrors(readHouseTreasuryConfig(environment))).toContain(
      'withdrawal_authority_not_separated',
    );
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
    const transaction = fakeTransaction({
      created: [],
      existingExposure: [{ amount: '40000000' }],
    });
    await expect(
      reserveHouseExposure(
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
      ),
    ).rejects.toThrow('minimum liquidity');
  });

  test('includes unresolved reservations in atomic daily-loss headroom', async () => {
    const environment = configuredEnvironment();
    environment.OPENPACKSDUEL_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO = '50000000';
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
    OPENPACKSDUEL_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO: '100000000',
    OPENPACKSDUEL_HOUSE_DEVNET_FUNDING_SIGNER: HOUSE,
    OPENPACKSDUEL_HOUSE_DEVNET_USDC_MINT: USDC_MINT,
    OPENPACKSDUEL_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT: TOKEN_ACCOUNT,
    OPENPACKSDUEL_HOUSE_DEVNET_WALLET: HOUSE,
    OPENPACKSDUEL_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY: WITHDRAWAL,
    OPENPACKSDUEL_HOUSE_ENABLED: 'true',
    OPENPACKSDUEL_HOUSE_MAX_ACTIVE_PER_WALLET: '2',
    OPENPACKSDUEL_HOUSE_MAX_CONCURRENT_PER_TIER: '2',
    OPENPACKSDUEL_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO: '100000000',
    OPENPACKSDUEL_HOUSE_MIN_LIQUIDITY_USDC_MICRO: '20000000',
    OPENPACKSDUEL_NETWORK: 'solana-devnet',
  };
}

function fakeTransaction(input: {
  created: unknown[];
  existingExposure: Array<{ amount: string }>;
}): Prisma.TransactionClient {
  return {
    $queryRaw: () => Promise.resolve([{ pg_advisory_xact_lock: '' }]),
    houseTreasuryLedgerEntry: {
      create: ({ data }: { data: unknown }) => {
        input.created.push(data);
        return Promise.resolve(data);
      },
      findMany: () => Promise.resolve([]),
    },
    houseTreasuryReservation: {
      count: () => Promise.resolve(0),
      create: ({ data }: { data: unknown }) => {
        input.created.push(data);
        return Promise.resolve(data);
      },
      findMany: () => Promise.resolve(input.existingExposure),
      findUnique: () => Promise.resolve(null),
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
