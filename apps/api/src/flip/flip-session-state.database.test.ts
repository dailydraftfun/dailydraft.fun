import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createDatabaseClient,
  type DatabaseClient,
  FlipSessionStatus,
  FlipSessionTransitionKind,
} from '@dailydraft/db';

import type { Money } from '../domain.js';
import {
  type FlipInventoryCandidate,
  type FlipInventorySnapshotPolicy,
  FlipInventorySnapshotService,
} from './flip-inventory-snapshot.service.js';
import { createFixtureFlipRuleSet, FlipRulesService } from './flip-rules.service.js';
import {
  FLIP_PURCHASE_FIXTURE_VERSION,
  FLIP_RECOVERY_FIXTURE_VERSION,
  FLIP_REVEAL_READY_FIXTURE_VERSION,
  FLIP_SELECTION_FIXTURE_VERSION,
  FLIP_SESSION_STATE_MACHINE_VERSION,
  FLIP_SETTLEMENT_FIXTURE_VERSION,
  FLIP_STAKE_FIXTURE_VERSION,
  FLIP_TRANSFER_FIXTURE_VERSION,
  FlipSessionStateService,
} from './flip-session-state.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.REQUIRE_DB_INTEGRATION === '1' && !databaseUrl) {
  throw new Error('REQUIRE_DB_INTEGRATION=1 but DATABASE_URL is unset');
}
const describeDatabase =
  process.env.REQUIRE_DB_INTEGRATION === '1' && databaseUrl ? describe : describe.skip;
const FIXTURE_ENVIRONMENT = {
  DAILYDRAFT_FLIP_FIXTURE_MODE: 'true',
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;

describeDatabase('Flip session state machine against two real Postgres connections', () => {
  let databaseA: DatabaseClient;
  let databaseB: DatabaseClient;
  const originalEnvironment = {
    fixture: process.env.DAILYDRAFT_FLIP_FIXTURE_MODE,
    node: process.env.NODE_ENV,
    vercel: process.env.VERCEL_ENV,
  };

  beforeAll(() => {
    databaseA = createDatabaseClient(databaseUrl ?? '');
    databaseB = createDatabaseClient(databaseUrl ?? '');
    process.env.DAILYDRAFT_FLIP_FIXTURE_MODE = 'true';
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
  });

  afterAll(async () => {
    await Promise.all([databaseA.$disconnect(), databaseB.$disconnect()]);
    restoreEnvironment('DAILYDRAFT_FLIP_FIXTURE_MODE', originalEnvironment.fixture);
    restoreEnvironment('NODE_ENV', originalEnvironment.node);
    restoreEnvironment('VERCEL_ENV', originalEnvironment.vercel);
  });

  test('resumes every non-terminal state and collapses concurrent side-effect retries', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'resume');
    const clock = new DatabaseTestClock();
    const serviceA = new FlipSessionStateService(databaseA, clock, FIXTURE_ENVIRONMENT);
    const serviceB = new FlipSessionStateService(databaseB, clock, FIXTURE_ENVIRONMENT);
    let session = await serviceA.createFixtureSession({
      playerWalletReference: 'fixture-wallet:postgres-player',
      sessionReference: fixture.sessionReference,
    });
    await expect(serviceB.findSession(session.id)).resolves.toEqual(session);

    const stake = {
      evidence: {
        amount: usdc('50000000'),
        reference: 'fixture-stake:postgres',
        schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
        status: 'fixture-confirmed' as const,
      },
      expectedVersion: session.version,
      kind: 'confirm-stake' as const,
      transitionKey: 'stake-postgres',
    };
    const concurrent = await Promise.all([
      serviceA.transition(session.id, stake),
      serviceB.transition(session.id, stake),
    ]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    const staked = concurrent[0];
    if (!staked) throw new Error('concurrent stake transition returned no session');
    session = staked;
    expect(session).toMatchObject({ status: 'stake-confirmed', version: 2 });

    const actions = [
      {
        evidence: { poolCommitmentId: fixture.commitmentId },
        kind: 'commit-pool' as const,
        transitionKey: 'pool-postgres',
      },
      {
        evidence: {
          ...fixture.selected,
          reference: 'fixture-selection:postgres',
          resultHash: hash('selection:postgres'),
          schemaVersion: FLIP_SELECTION_FIXTURE_VERSION,
        },
        kind: 'record-selection' as const,
        transitionKey: 'selection-postgres',
      },
      {
        evidence: {
          amount: usdc(fixture.selected.listingValueAmount),
          provider: 'fixture-marketplace' as const,
          providerAssetReference: fixture.selected.providerAssetReference,
          providerListingReference: fixture.selected.providerListingReference,
          reference: 'fixture-purchase:postgres',
          schemaVersion: FLIP_PURCHASE_FIXTURE_VERSION,
          status: 'fixture-acquired' as const,
        },
        kind: 'record-purchase' as const,
        transitionKey: 'purchase-postgres',
      },
      {
        evidence: {
          destinationWalletReference: 'fixture-wallet:postgres-player',
          providerAssetReference: fixture.selected.providerAssetReference,
          reference: 'fixture-transfer:postgres',
          schemaVersion: FLIP_TRANSFER_FIXTURE_VERSION,
          sourceCustodyReference: 'fixture-custody:postgres',
          status: 'fixture-transferred' as const,
        },
        kind: 'record-transfer' as const,
        transitionKey: 'transfer-postgres',
      },
      {
        evidence: {
          purchaseReference: 'fixture-purchase:postgres',
          reference: 'fixture-reveal:postgres',
          schemaVersion: FLIP_REVEAL_READY_FIXTURE_VERSION,
          status: 'fixture-ready' as const,
          transferReference: 'fixture-transfer:postgres',
        },
        kind: 'mark-reveal-ready' as const,
        transitionKey: 'reveal-postgres',
      },
    ];

    for (const action of actions) {
      clock.advance(1_000);
      session = await serviceB.transition(session.id, {
        ...action,
        expectedVersion: session.version,
      });
      const restarted = new FlipSessionStateService(databaseA, clock, FIXTURE_ENVIRONMENT);
      await expect(restarted.findSession(session.id)).resolves.toEqual(session);
    }

    const settled = await serviceA.transition(session.id, {
      evidence: {
        payout: usdc('0'),
        providerAssetReference: fixture.selected.providerAssetReference,
        reference: 'fixture-settlement:postgres',
        resultHash: hash('settlement:postgres'),
        schemaVersion: FLIP_SETTLEMENT_FIXTURE_VERSION,
        status: 'fixture-recorded',
      },
      expectedVersion: session.version,
      kind: 'settle',
      transitionKey: 'settlement-postgres',
    });
    expect(settled).toMatchObject({
      status: 'settled',
      terminalReason: 'FIXTURE_SETTLED',
      version: 8,
    });
    expect(settled.transitions).toHaveLength(8);
    expect(
      await databaseA.flipSessionTransition.count({
        where: { sessionId: session.id },
      }),
    ).toBe(8);

    await expect(
      Promise.resolve(
        databaseA.flipSessionTransition.updateMany({
          data: { terminalReason: 'TAMPERED' },
          where: { sessionId: session.id },
        }),
      ),
    ).rejects.toThrow('Flip session transitions are append-only');
  });

  test('database and service both prevent reveal finality before acquisition and transfer', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'reveal-guard');
    const clock = new DatabaseTestClock();
    const service = new FlipSessionStateService(databaseA, clock, FIXTURE_ENVIRONMENT);
    let session = await service.createFixtureSession({
      playerWalletReference: 'fixture-wallet:postgres-guard',
      sessionReference: fixture.sessionReference,
    });
    session = await service.transition(session.id, {
      evidence: {
        amount: usdc('50000000'),
        reference: 'fixture-stake:guard',
        schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
        status: 'fixture-confirmed',
      },
      expectedVersion: session.version,
      kind: 'confirm-stake',
      transitionKey: 'stake-guard',
    });
    session = await service.transition(session.id, {
      evidence: { poolCommitmentId: fixture.commitmentId },
      expectedVersion: session.version,
      kind: 'commit-pool',
      transitionKey: 'pool-guard',
    });

    await expect(
      service.transition(session.id, {
        evidence: {
          purchaseReference: 'fixture-purchase:not-durable',
          reference: 'fixture-reveal:too-early',
          schemaVersion: FLIP_REVEAL_READY_FIXTURE_VERSION,
          status: 'fixture-ready',
          transferReference: 'fixture-transfer:not-durable',
        },
        expectedVersion: session.version,
        kind: 'mark-reveal-ready',
        transitionKey: 'reveal-too-early',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    await expect(
      Promise.resolve(
        databaseA.flipSession.updateMany({
          data: {
            revealReadyAt: clock.now(),
            revealReadyReference: 'fixture-reveal:database-bypass',
            status: 'REVEAL_READY',
            version: { increment: 1 },
          },
          where: { id: session.id, version: session.version },
        }),
      ),
    ).rejects.toThrow();
    expect((await service.findSession(session.id)).status).toBe('pool-committed');
  });

  test('persists recovery and terminal reason across a service restart', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'recovery');
    const clock = new DatabaseTestClock();
    const service = new FlipSessionStateService(databaseA, clock, FIXTURE_ENVIRONMENT);
    const created = await service.createFixtureSession({
      playerWalletReference: 'fixture-wallet:postgres-recovery',
      sessionReference: fixture.sessionReference,
    });
    const recovery = await service.transition(created.id, {
      evidence: {
        reasonCode: 'FIXTURE_PROVIDER_TIMEOUT',
        reference: 'fixture-recovery:postgres-request',
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovery-required',
      },
      expectedVersion: created.version,
      kind: 'request-recovery',
      transitionKey: 'recovery-postgres',
    });

    const restarted = new FlipSessionStateService(databaseB, clock, FIXTURE_ENVIRONMENT);
    const terminal = await restarted.transition(recovery.id, {
      evidence: {
        payout: usdc('0'),
        reference: 'fixture-recovery:postgres-complete',
        resultHash: hash('recovery:postgres'),
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovered',
      },
      expectedVersion: recovery.version,
      kind: 'complete-recovery',
      transitionKey: 'recovery-complete-postgres',
    });
    expect(terminal).toMatchObject({
      status: 'recovered',
      terminalReason: 'FIXTURE_RECOVERY_COMPLETED',
      version: 3,
    });
  });

  test('rejects aggregate advancement without its matching append-only transition', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'missing-ledger');
    const service = new FlipSessionStateService(
      databaseA,
      new DatabaseTestClock(),
      FIXTURE_ENVIRONMENT,
    );
    const session = await service.createFixtureSession({
      playerWalletReference: 'fixture-wallet:postgres-missing-ledger',
      sessionReference: fixture.sessionReference,
    });

    await expect(
      databaseA.$transaction((transaction) =>
        transaction.flipSession.updateMany({
          data: {
            stakeAmount: '50000000',
            stakeCurrency: 'USDC',
            stakeDecimals: 6,
            status: FlipSessionStatus.STAKE_CONFIRMED,
            version: { increment: 1 },
          },
          where: {
            id: session.id,
            status: FlipSessionStatus.AWAITING_STAKE,
            version: session.version,
          },
        }),
      ),
    ).rejects.toThrow('requires matching append-only evidence');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: 1,
    });
  });

  test.each([
    {
      evidence: { secret: 'forged' },
      kind: FlipSessionTransitionKind.SETTLED,
      label: 'wrong transition kind and arbitrary evidence',
    },
    {
      evidence: {
        amount: { amount: '1', currency: 'USDC', decimals: 6, secret: 'forged' },
        reference: 'fixture-stake:forged',
        schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
        status: 'fixture-confirmed',
      },
      kind: FlipSessionTransitionKind.STAKE_CONFIRMED,
      label: 'milestone mismatch and nested secret evidence',
    },
  ])('rejects $label at the deferred database boundary', async ({ evidence, kind }) => {
    const fixture = await prepareDatabaseFixture(
      databaseA,
      `forged-${kind.toLowerCase().replaceAll('_', '-')}`,
    );
    const service = new FlipSessionStateService(
      databaseA,
      new DatabaseTestClock(),
      FIXTURE_ENVIRONMENT,
    );
    const session = await service.createFixtureSession({
      playerWalletReference: 'fixture-wallet:postgres-forged',
      sessionReference: fixture.sessionReference,
    });
    const transitionKey = `forged-${kind.toLowerCase()}`;
    const requestPayload = JSON.stringify({
      action: {
        evidence,
        expectedVersion: 1,
        kind: kind === FlipSessionTransitionKind.SETTLED ? 'settle' : 'confirm-stake',
        transitionKey,
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });

    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.updateMany({
          data: {
            stakeAmount: '50000000',
            stakeCurrency: 'USDC',
            stakeDecimals: 6,
            status: FlipSessionStatus.STAKE_CONFIRMED,
            version: { increment: 1 },
          },
          where: {
            id: session.id,
            status: FlipSessionStatus.AWAITING_STAKE,
            version: session.version,
          },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence,
            fromStatus: FlipSessionStatus.AWAITING_STAKE,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind,
            poolCommitmentHash: null,
            requestHash: hash(requestPayload),
            requestPayload,
            selectedAssetReference: null,
            sequence: 2,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.STAKE_CONFIRMED,
            transitionKey,
          },
        });
      }),
    ).rejects.toThrow('transition evidence is invalid');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: 1,
    });
  });

  test('rejects a forged ledger append without aggregate advancement', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'forged-ledger-only');
    const service = new FlipSessionStateService(
      databaseA,
      new DatabaseTestClock(),
      FIXTURE_ENVIRONMENT,
    );
    const session = await service.createFixtureSession({
      playerWalletReference: 'fixture-wallet:postgres-ledger-only',
      sessionReference: fixture.sessionReference,
    });
    const evidence = {
      amount: { amount: '50000000', currency: 'USDC', decimals: 6 },
      reference: 'fixture-stake:ledger-only',
      schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
      status: 'fixture-confirmed',
    };
    const requestPayload = JSON.stringify({
      action: {
        evidence,
        expectedVersion: 1,
        kind: 'confirm-stake',
        transitionKey: 'forged-ledger-only',
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });

    await expect(
      Promise.resolve(
        databaseA.flipSessionTransition.create({
          data: {
            evidence,
            fromStatus: FlipSessionStatus.AWAITING_STAKE,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.STAKE_CONFIRMED,
            poolCommitmentHash: null,
            requestHash: hash(requestPayload),
            requestPayload,
            selectedAssetReference: null,
            sequence: 2,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.STAKE_CONFIRMED,
            transitionKey: 'forged-ledger-only',
          },
        }),
      ),
    ).rejects.toThrow('does not match the durable aggregate');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: 1,
    });
  });

  test('rejects a transition whose request payload does not match its hash', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'forged-request-hash');
    const service = new FlipSessionStateService(
      databaseA,
      new DatabaseTestClock(),
      FIXTURE_ENVIRONMENT,
    );
    const session = await service.createFixtureSession({
      playerWalletReference: 'fixture-wallet:postgres-request-hash',
      sessionReference: fixture.sessionReference,
    });
    const evidence = {
      amount: { amount: '50000000', currency: 'USDC', decimals: 6 },
      reference: 'fixture-stake:request-hash',
      schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
      status: 'fixture-confirmed',
    };
    const requestPayload = JSON.stringify({
      action: {
        evidence,
        expectedVersion: 1,
        kind: 'confirm-stake',
        transitionKey: 'forged-request-hash',
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });

    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.updateMany({
          data: {
            stakeAmount: '50000000',
            stakeCurrency: 'USDC',
            stakeDecimals: 6,
            status: FlipSessionStatus.STAKE_CONFIRMED,
            version: { increment: 1 },
          },
          where: {
            id: session.id,
            status: FlipSessionStatus.AWAITING_STAKE,
            version: session.version,
          },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence,
            fromStatus: FlipSessionStatus.AWAITING_STAKE,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.STAKE_CONFIRMED,
            poolCommitmentHash: null,
            requestHash: hash(`${requestPayload}:tampered`),
            requestPayload,
            selectedAssetReference: null,
            sequence: 2,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.STAKE_CONFIRMED,
            transitionKey: 'forged-request-hash',
          },
        });
      }),
    ).rejects.toThrow('request hash is invalid');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: 1,
    });
  });
});

async function prepareDatabaseFixture(database: DatabaseClient, label: string) {
  const suffix = `${label}-${crypto.randomUUID().replaceAll('-', '')}`;
  const sessionReference = `dbtest-flip-session-${suffix}`;
  const poolKey = `dbtest-flip-pool-${suffix}`;
  const policyVersion = `dbtest-flip-policy-${suffix}`;
  const rulesKey = `dbtest-flip-rules-${suffix}`;
  const inventory = new FlipInventorySnapshotService(database);
  const snapshot = await inventory.createFixtureSnapshot({
    candidates: [
      candidate('base', '20000000'),
      candidate('plus', '30000000'),
      candidate('chase', '60000000'),
    ],
    evaluatedAt: new Date('2026-08-03T12:00:00.000Z'),
    policy: policy(poolKey, policyVersion),
  });
  const rulesService = new FlipRulesService(database);
  const rules = createFixtureFlipRuleSet({
    inventoryPolicyVersion: policyVersion,
    poolKey,
    rulesKey,
  });
  await rulesService.createFixtureRuleSet(rules);
  const commitment = await rulesService.createFixtureSessionPoolCommitment({
    committedAt: new Date('2026-08-03T12:02:00.000Z'),
    rulesKey,
    rulesVersion: 1,
    sessionReference,
    snapshotId: snapshot.id,
  });
  return {
    commitmentId: commitment.id,
    selected: {
      bandLabel: 'plus',
      listingValueAmount: '30000000',
      ordinal: 2,
      providerAssetReference: 'asset_plus',
      providerListingReference: 'listing_plus',
    },
    sessionReference,
  };
}

function policy(poolKey: string, policyVersion: string): FlipInventorySnapshotPolicy {
  return {
    allowedCollections: ['pokemon-graded'],
    allowedGraders: ['psa'],
    excludedProviderAssetReferences: [],
    excludedProviderListingReferences: [],
    maximumEligibleItems: 10,
    maximumExposure: moneyPolicy('200000000'),
    maximumFutureSkewMs: 1_000,
    maximumListingValue: moneyPolicy('100000000'),
    maximumSourceAgeMs: 60_000,
    minimumEligibleItems: 3,
    minimumLiquidityBasisPoints: 5_000,
    minimumListingValue: moneyPolicy('10000000'),
    policyVersion,
    poolKey,
    provider: 'fixture-marketplace',
    stake: moneyPolicy('50000000'),
  };
}

function candidate(reference: string, amount: string): FlipInventoryCandidate {
  const sourceTimestamp = new Date('2026-08-03T11:59:30.000Z');
  return {
    buybackValue: null,
    displayedValue: null,
    insuredValue: null,
    inventorySourceTimestamp: sourceTimestamp,
    liquidityBasisPoints: 8_000,
    listingValue: {
      amount,
      currency: 'USDC',
      decimals: 6,
      providerReference: `value_${reference}`,
      sourceTimestamp,
    },
    normalizedCollection: 'pokemon-graded',
    normalizedGrader: 'psa',
    providerAssetReference: `asset_${reference}`,
    providerCollectionReference: 'collection_pokemon',
    providerGraderReference: 'grader_psa',
    providerListingReference: `listing_${reference}`,
  };
}

function moneyPolicy(amount: string) {
  return { amount, currency: 'USDC', decimals: 6 };
}

function usdc(amount: string): Money {
  return { amount, currency: 'USDC', decimals: 6 };
}

function hash(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

class DatabaseTestClock {
  #current = new Date('2026-07-28T16:00:00.000Z');

  advance(milliseconds: number): void {
    this.#current = new Date(this.#current.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.#current);
  }
}
