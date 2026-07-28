import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createDatabaseClient,
  type DatabaseClient,
  HouseTreasuryLedgerType,
  HouseTreasuryReservationStatus,
} from '@dailydraft/db';

import type { Money } from '../domain.js';
import {
  CRASH_CALCULATOR_VERSION,
  CRASH_RULES_SCHEMA_VERSION,
  type CrashCalculatorRuleSet,
  hashCrashCalculatorRuleSet,
  type UnsignedCrashCalculatorRuleSet,
} from './crash-calculators.js';
import {
  CRASH_RISK_HEALTH_SCHEMA_VERSION,
  CRASH_RISK_POLICY_VERSION,
  CRASH_RISK_RULES_SCHEMA_VERSION,
  type CrashRiskHealthFixture,
  CrashRiskPolicyService,
  type CrashRiskRules,
  hashCrashRiskRules,
  type UnsignedCrashRiskRules,
} from './crash-risk.policy.js';
import {
  CRASH_CUSTODY_FIXTURE_VERSION,
  CRASH_PAYMENT_FIXTURE_VERSION,
  CRASH_PROVIDER_FIXTURE_VERSION,
  CRASH_STATE_MACHINE_VERSION,
  CRASH_STATE_RULES_SCHEMA_VERSION,
  CrashStageStateService,
  type CrashStateRules,
  hashCrashStateRules,
  type UnsignedCrashStateRules,
} from './crash-stage-state.js';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.REQUIRE_DB_INTEGRATION === '1' && !databaseUrl) {
  throw new Error('REQUIRE_DB_INTEGRATION=1 but DATABASE_URL is unset');
}
const describeDatabase =
  process.env.REQUIRE_DB_INTEGRATION === '1' && databaseUrl ? describe : describe.skip;
const NOW = new Date('2026-07-28T21:00:00.000Z');
const PREFIX = `crash-risk-db-${crypto.randomUUID().replaceAll('-', '')}`;
const FIXTURE_ENVIRONMENT = {
  DAILYDRAFT_CRASH_FIXTURE_MODE: 'true',
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;

describeDatabase('Crash risk admission against the canonical Postgres treasury ledger', () => {
  let database: DatabaseClient;

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl ?? '');
    await database.runtimeControl.upsert({
      create: { key: 'global_exposure', paused: false },
      update: { paused: false },
      where: { key: 'global_exposure' },
    });
    await database.houseTreasurySnapshot.upsert({
      create: {
        balanceAmount: '100000000',
        balanceDecimals: 6,
        delegate: FUNDING,
        delegatedAmount: '20000000',
        id: 'solana-devnet-usdc',
        mint: MINT,
        tokenAccount: TOKEN_ACCOUNT,
        verifiedAt: NOW,
        wallet: WITHDRAWAL,
      },
      update: {
        balanceAmount: '100000000',
        balanceDecimals: 6,
        delegate: FUNDING,
        delegatedAmount: '20000000',
        mint: MINT,
        tokenAccount: TOKEN_ACCOUNT,
        verifiedAt: NOW,
        wallet: WITHDRAWAL,
      },
      where: { id: 'solana-devnet-usdc' },
    });
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  test('serializes concurrent per-wallet admission and never oversubscribes', async () => {
    const service = stateService(database, riskEnvironment('20000000'));
    const rules = stateRules(riskRules('10000000', '20000000'));
    const health = riskHealth(rules.riskRules);
    const results = await Promise.allSettled([
      service.createFixtureRound({
        initialPot: usdc('6000000'),
        playerWalletReference: 'fixture-wallet:postgres-risk-player',
        riskHealth: health,
        roundId: `${PREFIX}-wallet-a`,
        rules,
      }),
      service.createFixtureRound({
        initialPot: usdc('6000000'),
        playerWalletReference: 'fixture-wallet:postgres-risk-player',
        riskHealth: health,
        roundId: `${PREFIX}-wallet-b`,
        rules,
      }),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    const reservations = await database.houseTreasuryReservation.findMany({
      where: { crashRoundId: { startsWith: `${PREFIX}-wallet-` } },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.amount).toBe('6000000');
  });

  test('serializes aggregate exposure across wallets and exact request retries', async () => {
    const service = stateService(database, riskEnvironment('20000000'));
    const rules = stateRules(riskRules('10000000', '10000000'));
    const health = riskHealth(rules.riskRules);
    const retryInput = {
      initialPot: usdc('4000000'),
      playerWalletReference: 'fixture-wallet:postgres-risk-retry',
      riskHealth: health,
      roundId: `${PREFIX}-retry`,
      rules,
    };
    const retries = await Promise.all([
      service.createFixtureRound(retryInput),
      service.createFixtureRound(retryInput),
    ]);
    expect(retries[0]).toEqual(retries[1]);

    const results = await Promise.allSettled([
      service.createFixtureRound({
        ...retryInput,
        initialPot: usdc('7000000'),
        playerWalletReference: 'fixture-wallet:postgres-risk-other-a',
        roundId: `${PREFIX}-treasury-a`,
      }),
      service.createFixtureRound({
        ...retryInput,
        initialPot: usdc('7000000'),
        playerWalletReference: 'fixture-wallet:postgres-risk-other-b',
        roundId: `${PREFIX}-treasury-b`,
      }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(0);

    const retryReservations = await database.houseTreasuryReservation.count({
      where: { crashRoundId: retryInput.roundId },
    });
    const retryLedger = await database.houseTreasuryLedgerEntry.count({
      where: {
        crashRoundId: retryInput.roundId,
        type: HouseTreasuryLedgerType.RESERVATION_CREATED,
      },
    });
    expect({ retryLedger, retryReservations }).toEqual({ retryLedger: 1, retryReservations: 1 });
  });

  test('rejects a continuation before payment evidence and releases terminal risk once', async () => {
    const service = stateService(database, riskEnvironment('20000000'));
    const rules = stateRules(riskRules('20000000', '20000000', '6000000'));
    const health = riskHealth(rules.riskRules);
    const round = await service.createFixtureRound({
      initialPot: usdc('6000000'),
      playerWalletReference: 'fixture-wallet:postgres-risk-transition',
      riskHealth: health,
      roundId: `${PREFIX}-transition`,
      rules,
    });

    await expect(
      service.decide(round.id, rules, {
        custody: {
          assetReference: 'fixture-asset:postgres-risk',
          reference: 'fixture-custody:postgres-risk',
          schemaVersion: CRASH_CUSTODY_FIXTURE_VERSION,
        },
        decision: 'continue',
        expectedStage: 1,
        expectedVersion: 1,
        payment: {
          amount: usdc('1000000'),
          reference: 'fixture-payment:postgres-risk',
          schemaVersion: CRASH_PAYMENT_FIXTURE_VERSION,
          status: 'fixture-confirmed',
        },
        providerOutcome: {
          reference: 'fixture-provider:postgres-risk',
          resultHash: hash('provider:postgres-risk'),
          rollPpm: 900_000,
          schemaVersion: CRASH_PROVIDER_FIXTURE_VERSION,
          stage: 1,
          stageValue: usdc('1000000'),
        },
        riskHealth: health,
        transitionKey: 'continue-risk-rejected',
      }),
    ).rejects.toMatchObject({ code: 'RISK_REJECTED' });

    const rejected = await service.findRound(round.id);
    expect(rejected).toMatchObject({ pot: usdc('6000000'), stage: 1, version: 1 });
    expect(rejected.transitions).toHaveLength(1);
    const beforeRelease = await database.houseTreasuryReservation.findUniqueOrThrow({
      where: { crashRoundId: round.id },
    });
    expect(beforeRelease).toMatchObject({
      amount: '6000000',
      status: HouseTreasuryReservationStatus.RESERVED,
      version: 1,
    });

    const risk = new CrashRiskPolicyService(riskEnvironment('20000000'));
    await database.$transaction((transaction) =>
      risk.releaseTerminal(transaction, {
        now: NOW,
        round: {
          id: round.id,
          playerWalletReference: round.playerWalletReference,
          riskExpiresAt: new Date(round.riskExpiresAt),
          riskRulesHash: round.riskRulesHash,
          riskRulesVersion: round.riskRulesVersion,
        },
        stage: round.stage,
      }),
    );
    await database.$transaction((transaction) =>
      risk.releaseTerminal(transaction, {
        now: NOW,
        round: {
          id: round.id,
          playerWalletReference: round.playerWalletReference,
          riskExpiresAt: new Date(round.riskExpiresAt),
          riskRulesHash: round.riskRulesHash,
          riskRulesVersion: round.riskRulesVersion,
        },
        stage: round.stage,
      }),
    );
    expect(
      await database.houseTreasuryLedgerEntry.count({
        where: {
          crashRoundId: round.id,
          type: HouseTreasuryLedgerType.RESERVATION_RELEASED,
        },
      }),
    ).toBe(1);
    await expect(
      Promise.resolve(
        database.houseTreasuryReservation.update({
          data: { riskRulesHash: '0'.repeat(64), version: { increment: 1 } },
          where: { crashRoundId: round.id },
        }),
      ),
    ).rejects.toThrow('Crash treasury reservation binding is immutable');
    await expect(
      Promise.resolve(
        database.houseTreasuryLedgerEntry.updateMany({
          data: { metadata: { tampered: true } },
          where: { crashRoundId: round.id },
        }),
      ),
    ).rejects.toThrow('HouseTreasuryLedgerEntry is append-only');
  });
});

const FUNDING = 'E97fUPq9eP69ukeDWvmiKJcvuvKADWpYZfYVyanuH4e2';
const WITHDRAWAL = '66KTYU8iBq36MBX8fG1vR8c1mh5T8LDqcP41wqmg2Zjs';
const TOKEN_ACCOUNT = 'uBtRQpewxbLPA1ykwB1R2LKyrNFjf9bh29k3yux3Cvc';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const UNSIGNED_CALCULATOR_RULES = {
  activation: 'fixture-only',
  calculatorVersion: CRASH_CALCULATOR_VERSION,
  constraints: {
    bustThresholdPpm: 'nondecreasing',
    maxPotAmount: 'nondecreasing',
    potContributionBps: 'nondecreasing',
  },
  currency: 'USDC',
  decimals: 6,
  rounding: 'floor',
  rulesVersion: 'synthetic-risk-db-calculator-v1',
  schemaVersion: CRASH_RULES_SCHEMA_VERSION,
  stages: [
    {
      bustThresholdPpm: 0,
      maxPotAmount: '10000000',
      potContributionBps: 10_000,
      stage: 1,
    },
    {
      bustThresholdPpm: 0,
      maxPotAmount: '10000000',
      potContributionBps: 10_000,
      stage: 2,
    },
  ],
} as const satisfies UnsignedCrashCalculatorRuleSet;
const CALCULATOR_RULES: CrashCalculatorRuleSet = {
  ...UNSIGNED_CALCULATOR_RULES,
  rulesHash: hashCrashCalculatorRuleSet(UNSIGNED_CALCULATOR_RULES),
};

function riskRules(maxWallet: string, maxTreasury: string, maxPot = '10000000'): CrashRiskRules {
  const unsigned = {
    activation: 'fixture-only',
    currency: 'USDC',
    decimals: 6,
    evidenceMaxAgeMs: 60_000,
    maxDurationMs: 300_000,
    maxPotAmount: maxPot,
    maxStage: 2,
    maxTreasuryExposureAmount: maxTreasury,
    maxWalletExposureAmount: maxWallet,
    network: 'solana-devnet',
    policyVersion: CRASH_RISK_POLICY_VERSION,
    poolReference: 'fixture-pool:risk-db',
    providerReference: 'fixture-provider:risk-db',
    rulesVersion: `synthetic-risk-db-${maxWallet}-${maxTreasury}-${maxPot}`,
    schemaVersion: CRASH_RISK_RULES_SCHEMA_VERSION,
  } as const satisfies UnsignedCrashRiskRules;
  return { ...unsigned, riskRulesHash: hashCrashRiskRules(unsigned) };
}

function stateRules(risk: CrashRiskRules): CrashStateRules {
  const unsigned = {
    activation: 'fixture-only',
    architectureVersion: 'synthetic-risk-db-architecture-v1',
    calculatorRules: CALCULATOR_RULES,
    decisionTimeoutMs: 30_000,
    defaultAction: 'forfeit',
    riskRules: risk,
    schemaVersion: CRASH_STATE_RULES_SCHEMA_VERSION,
    stateMachineVersion: CRASH_STATE_MACHINE_VERSION,
  } as const satisfies UnsignedCrashStateRules;
  return { ...unsigned, stateMachineRulesHash: hashCrashStateRules(unsigned) };
}

function riskHealth(rules: CrashRiskRules): CrashRiskHealthFixture {
  return {
    observedAt: NOW.toISOString(),
    poolReference: rules.poolReference,
    poolStatus: 'healthy',
    providerReference: rules.providerReference,
    providerStatus: 'healthy',
    riskRulesHash: rules.riskRulesHash,
    schemaVersion: CRASH_RISK_HEALTH_SCHEMA_VERSION,
  };
}

function stateService(database: DatabaseClient, environment: NodeJS.ProcessEnv) {
  return new CrashStageStateService(
    database,
    { now: () => NOW },
    FIXTURE_ENVIRONMENT,
    new CrashRiskPolicyService(environment),
  );
}

function riskEnvironment(maxTotal: string): NodeJS.ProcessEnv {
  return {
    DAILYDRAFT_HOUSE_DAILY_LOSS_LIMIT_USDC_MICRO: '100000000',
    DAILYDRAFT_HOUSE_DEVNET_FUNDING_SIGNER: FUNDING,
    DAILYDRAFT_HOUSE_DEVNET_USDC_MINT: MINT,
    DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT: TOKEN_ACCOUNT,
    DAILYDRAFT_HOUSE_DEVNET_WALLET: FUNDING,
    DAILYDRAFT_HOUSE_DEVNET_WITHDRAWAL_AUTHORITY: WITHDRAWAL,
    DAILYDRAFT_HOUSE_ENABLED: 'true',
    DAILYDRAFT_HOUSE_MAX_TOTAL_EXPOSURE_USDC_MICRO: maxTotal,
    DAILYDRAFT_HOUSE_MIN_LIQUIDITY_USDC_MICRO: '1',
    DAILYDRAFT_HOUSE_SNAPSHOT_MAX_AGE_SECONDS: '300',
    DAILYDRAFT_NETWORK: 'solana-devnet',
  };
}

function usdc(amount: string): Money {
  return { amount, currency: 'USDC', decimals: 6 };
}

function hash(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
