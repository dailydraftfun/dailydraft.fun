import { describe, expect, test } from 'bun:test';
import {
  HouseTreasuryLedgerType,
  HouseTreasuryReservationSource,
  HouseTreasuryReservationStatus,
  type Prisma,
} from '@dailydraft/db';

import {
  CRASH_RISK_HEALTH_SCHEMA_VERSION,
  CRASH_RISK_POLICY_VERSION,
  CRASH_RISK_RULES_SCHEMA_VERSION,
  type CrashRiskHealthFixture,
  CrashRiskPolicyError,
  CrashRiskPolicyService,
  type CrashRiskRules,
  hashCrashRiskRules,
  type UnsignedCrashRiskRules,
  validateCrashRiskHealth,
  validateCrashRiskRules,
} from './crash-risk.policy.js';

const NOW = new Date('2026-07-28T20:00:00.000Z');
const ROUND = {
  id: 'crash-risk-unit-round',
  playerWalletReference: 'fixture-wallet:risk-player',
  riskExpiresAt: new Date('2026-07-28T20:05:00.000Z'),
  riskRulesHash: '',
  riskRulesVersion: 'synthetic-risk-v1',
};

describe('versioned Crash risk contract', () => {
  test('pins exact rules and accepts only fresh matching provider and pool evidence', () => {
    expect(validateCrashRiskRules(RULES)).toEqual(RULES);
    expect(validateCrashRiskHealth(HEALTH, RULES, NOW)).toEqual(HEALTH);

    for (const invalid of [
      null,
      { ...RULES, activation: 'live' },
      { ...RULES, network: 'solana-mainnet' },
      { ...RULES, maxStage: 0 },
      { ...RULES, maxDurationMs: 0 },
      { ...RULES, maxPotAmount: '0' },
      { ...RULES, maxWalletExposureAmount: '999999' },
      { ...RULES, maxTreasuryExposureAmount: '9999999' },
      { ...RULES, riskRulesHash: '0'.repeat(64) },
    ]) {
      expect(() => validateCrashRiskRules(invalid)).toThrow(CrashRiskPolicyError);
    }

    for (const invalid of [
      null,
      { ...HEALTH, observedAt: '2026-07-28T19:58:59.999Z' },
      { ...HEALTH, providerStatus: 'degraded' },
      { ...HEALTH, poolStatus: 'closed' },
      { ...HEALTH, providerReference: 'fixture-provider:other' },
      { ...HEALTH, poolReference: 'fixture-pool:other' },
      { ...HEALTH, riskRulesHash: '0'.repeat(64) },
      { ...HEALTH, unsupported: true },
    ]) {
      expect(() => validateCrashRiskHealth(invalid, RULES, NOW)).toThrow(CrashRiskPolicyError);
    }
  });

  test('accepts exact pot, wallet, and treasury boundaries in the canonical ledger', async () => {
    const database = new RiskDatabase();
    database.seedReservation('other-round', '9000000', 'fixture-wallet:other');
    const service = new CrashRiskPolicyService(configuredEnvironment());

    await service.reserveRound(database.transaction, {
      health: HEALTH,
      initialPot: usdc('1000000'),
      now: NOW,
      round: binding(),
      rules: RULES,
    });

    expect(database.reservations.at(-1)).toMatchObject({
      amount: '1000000',
      crashRoundId: ROUND.id,
      source: HouseTreasuryReservationSource.CRASH,
      status: HouseTreasuryReservationStatus.RESERVED,
    });
    expect(database.ledger).toEqual([
      expect.objectContaining({
        idempotencyKey: `crash-reservation-created:${ROUND.id}`,
        type: HouseTreasuryLedgerType.RESERVATION_CREATED,
      }),
    ]);
  });

  test.each([
    {
      configure(database: RiskDatabase) {
        database.seedReservation('wallet-existing', '9500000', ROUND.playerWalletReference);
      },
      expected: 'per-wallet exposure',
      initialPot: '1000000',
      name: 'per-wallet amount',
    },
    {
      configure(database: RiskDatabase) {
        database.seedReservation('treasury-existing', '9500000', 'fixture-wallet:other');
      },
      expected: 'aggregate treasury exposure',
      initialPot: '1000000',
      name: 'aggregate treasury amount',
    },
    {
      configure(database: RiskDatabase) {
        database.paused = true;
      },
      expected: 'paused',
      initialPot: '1000000',
      name: 'operator pause',
    },
    {
      configure(database: RiskDatabase) {
        database.snapshot.verifiedAt = new Date('2026-07-28T19:00:00.000Z');
      },
      expected: 'snapshot',
      initialPot: '1000000',
      name: 'stale treasury evidence',
    },
  ])('rejects $name before recording exposure', async ({ configure, expected, initialPot }) => {
    const database = new RiskDatabase();
    configure(database);
    const service = new CrashRiskPolicyService(configuredEnvironment());

    await expect(
      service.reserveRound(database.transaction, {
        health: HEALTH,
        initialPot: usdc(initialPot),
        now: NOW,
        round: binding(),
        rules: RULES,
      }),
    ).rejects.toThrow(expected);

    expect(database.reservations.filter(({ crashRoundId }) => crashRoundId === ROUND.id)).toEqual(
      [],
    );
    expect(database.ledger).toEqual([]);
  });

  test('checks stage, duration, pot and health before changing a reservation', async () => {
    const cases = [
      {
        expected: 'maximum stage',
        input: { nextPot: usdc('2000000'), nextStage: 4, now: NOW, health: HEALTH },
      },
      {
        expected: 'maximum session duration',
        input: {
          nextPot: usdc('2000000'),
          nextStage: 2,
          now: ROUND.riskExpiresAt,
          health: {
            ...HEALTH,
            observedAt: ROUND.riskExpiresAt.toISOString(),
          },
        },
      },
      {
        expected: 'pot limit',
        input: { nextPot: usdc('10000001'), nextStage: 2, now: NOW, health: HEALTH },
      },
      {
        expected: 'health evidence',
        input: {
          nextPot: usdc('2000000'),
          nextStage: 2,
          now: NOW,
          health: { ...HEALTH, poolStatus: 'closed' },
        },
      },
    ];

    for (const [index, { expected, input }] of cases.entries()) {
      const database = new RiskDatabase();
      database.seedReservation(ROUND.id, '1000000', ROUND.playerWalletReference);
      const service = new CrashRiskPolicyService(configuredEnvironment());
      await expect(
        service.applyTransition(database.transaction, {
          acceptsRisk: true,
          ...input,
          round: binding(),
          rules: RULES,
          terminal: false,
        }),
      ).rejects.toThrow(expected);
      expect(database.reservations[0]?.amount).toBe('1000000');
      expect(database.ledger, `case ${index}`).toEqual([]);
    }
  });

  test('adjusts once and releases terminal exposure idempotently', async () => {
    const database = new RiskDatabase();
    database.seedReservation(ROUND.id, '1000000', ROUND.playerWalletReference);
    const service = new CrashRiskPolicyService(configuredEnvironment());

    await service.applyTransition(database.transaction, {
      acceptsRisk: true,
      health: HEALTH,
      nextPot: usdc('2000000'),
      nextStage: 2,
      now: NOW,
      round: binding(),
      rules: RULES,
      terminal: false,
    });
    await service.releaseTerminal(database.transaction, {
      now: NOW,
      round: binding(),
      stage: 2,
    });
    await service.releaseTerminal(database.transaction, {
      now: NOW,
      round: binding(),
      stage: 2,
    });

    expect(database.reservations[0]).toMatchObject({
      amount: '2000000',
      status: HouseTreasuryReservationStatus.RELEASED,
      version: 3,
    });
    expect(database.ledger.map(({ type }) => type)).toEqual([
      HouseTreasuryLedgerType.RESERVATION_ADJUSTED,
      HouseTreasuryLedgerType.RESERVATION_RELEASED,
    ]);
  });
});

interface ReservationRow {
  amount: string;
  crashRoundId: string | null;
  currency: string;
  decimals: number;
  id: string;
  playerWallet: string;
  riskRulesHash: string | null;
  source: HouseTreasuryReservationSource;
  status: HouseTreasuryReservationStatus;
  tier: number;
  version: number;
}

class RiskDatabase {
  readonly reservations: ReservationRow[] = [];
  readonly ledger: Array<{ idempotencyKey: string; type: HouseTreasuryLedgerType }> = [];
  paused = false;
  readonly snapshot = {
    balanceAmount: '100000000',
    balanceDecimals: 6,
    delegate: 'E97fUPq9eP69ukeDWvmiKJcvuvKADWpYZfYVyanuH4e2',
    delegatedAmount: '10000000',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    network: 'DEVNET' as const,
    tokenAccount: 'uBtRQpewxbLPA1ykwB1R2LKyrNFjf9bh29k3yux3Cvc',
    verifiedAt: NOW,
    wallet: '66KTYU8iBq36MBX8fG1vR8c1mh5T8LDqcP41wqmg2Zjs',
  };

  readonly transaction = {
    $executeRaw: async () => 1,
    houseTreasuryLedgerEntry: {
      create: async ({
        data,
      }: {
        data: { idempotencyKey: string; type: HouseTreasuryLedgerType };
      }) => {
        if (this.ledger.some(({ idempotencyKey }) => idempotencyKey === data.idempotencyKey)) {
          throw new Error('duplicate ledger key');
        }
        this.ledger.push({ idempotencyKey: data.idempotencyKey, type: data.type });
        return data;
      },
      findMany: async () => [],
    },
    houseTreasuryReservation: {
      create: async ({ data }: { data: Omit<ReservationRow, 'status' | 'version'> }) => {
        const row = {
          ...data,
          status: HouseTreasuryReservationStatus.RESERVED,
          version: 1,
        };
        this.reservations.push(row);
        return row;
      },
      findMany: async ({
        where,
      }: {
        where: {
          playerWallet?: string;
          status: { in: HouseTreasuryReservationStatus[] };
        };
      }) =>
        this.reservations.filter(
          ({ playerWallet, status }) =>
            where.status.in.includes(status) &&
            (!where.playerWallet || where.playerWallet === playerWallet),
        ),
      findUnique: async ({ where }: { where: { crashRoundId: string } }) =>
        this.reservations.find(({ crashRoundId }) => crashRoundId === where.crashRoundId) ?? null,
      updateMany: async ({
        data,
        where,
      }: {
        data: {
          amount?: string;
          releasedAt?: Date;
          status?: HouseTreasuryReservationStatus;
          tier?: number;
          version: { increment: number };
        };
        where: {
          id: string;
          status: { in: HouseTreasuryReservationStatus[] };
          version: number;
        };
      }) => {
        const row = this.reservations.find(
          ({ id, status, version }) =>
            id === where.id && where.status.in.includes(status) && version === where.version,
        );
        if (!row) return { count: 0 };
        if (data.amount) row.amount = data.amount;
        if (data.status) row.status = data.status;
        if (data.tier) row.tier = data.tier;
        row.version += data.version.increment;
        return { count: 1 };
      },
    },
    houseTreasurySnapshot: {
      findUnique: async () => this.snapshot,
    },
    runtimeControl: {
      findUnique: async () => ({ paused: this.paused }),
    },
  } as unknown as Prisma.TransactionClient;

  seedReservation(roundId: string, amount: string, playerWallet: string): void {
    this.reservations.push({
      amount,
      crashRoundId: roundId,
      currency: 'USDC',
      decimals: 6,
      id: `reservation-${roundId}`,
      playerWallet: playerWallet.replace(/^fixture-wallet:/, ''),
      riskRulesHash: RULES.riskRulesHash,
      source: HouseTreasuryReservationSource.CRASH,
      status: HouseTreasuryReservationStatus.RESERVED,
      tier: 1,
      version: 1,
    });
  }
}

const UNSIGNED_RULES = {
  activation: 'fixture-only',
  currency: 'USDC',
  decimals: 6,
  evidenceMaxAgeMs: 60_000,
  maxDurationMs: 300_000,
  maxPotAmount: '10000000',
  maxStage: 3,
  maxTreasuryExposureAmount: '10000000',
  maxWalletExposureAmount: '10000000',
  network: 'solana-devnet',
  policyVersion: CRASH_RISK_POLICY_VERSION,
  poolReference: 'fixture-pool:risk-unit',
  providerReference: 'fixture-provider:risk-unit',
  rulesVersion: 'synthetic-risk-v1',
  schemaVersion: CRASH_RISK_RULES_SCHEMA_VERSION,
} as const satisfies UnsignedCrashRiskRules;
const RULES: CrashRiskRules = {
  ...UNSIGNED_RULES,
  riskRulesHash: hashCrashRiskRules(UNSIGNED_RULES),
};
const HEALTH: CrashRiskHealthFixture = {
  observedAt: NOW.toISOString(),
  poolReference: RULES.poolReference,
  poolStatus: 'healthy',
  providerReference: RULES.providerReference,
  providerStatus: 'healthy',
  riskRulesHash: RULES.riskRulesHash,
  schemaVersion: CRASH_RISK_HEALTH_SCHEMA_VERSION,
};

function binding() {
  return { ...ROUND, riskRulesHash: RULES.riskRulesHash };
}

function usdc(amount: string) {
  return { amount, currency: 'USDC' as const, decimals: 6 as const };
}

function configuredEnvironment(): NodeJS.ProcessEnv {
  return {
    DAILYDRAFT_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO: '100000000',
    DAILYDRAFT_HOUSE_DEVNET_FUNDING_SIGNER: 'E97fUPq9eP69ukeDWvmiKJcvuvKADWpYZfYVyanuH4e2',
    DAILYDRAFT_HOUSE_DEVNET_USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT: 'uBtRQpewxbLPA1ykwB1R2LKyrNFjf9bh29k3yux3Cvc',
    DAILYDRAFT_HOUSE_DEVNET_WALLET: 'E97fUPq9eP69ukeDWvmiKJcvuvKADWpYZfYVyanuH4e2',
    DAILYDRAFT_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY: '66KTYU8iBq36MBX8fG1vR8c1mh5T8LDqcP41wqmg2Zjs',
    DAILYDRAFT_HOUSE_ENABLED: 'true',
    DAILYDRAFT_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO: '10000000',
    DAILYDRAFT_HOUSE_MIN_LIQUIDITY_USDC_MICRO: '1',
    DAILYDRAFT_HOUSE_SNAPSHOT_MAX_AGE_SECONDS: '300',
    DAILYDRAFT_NETWORK: 'solana-devnet',
  };
}
