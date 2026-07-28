import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createDatabaseClient,
  type DatabaseClient,
  FlipSessionStatus,
  FlipSessionTransitionKind,
  type Prisma,
} from '@dailydraft/db';

import type { Money } from '../domain.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  type FlipInventoryCandidate,
  type FlipInventorySnapshotPolicy,
  FlipInventorySnapshotService,
} from './flip-inventory-snapshot.service.js';
import {
  FLIP_APPROVED_ENTROPY_SCHEMA_VERSION,
  FlipOutcomeSelectionService,
} from './flip-outcome-selection.service.js';
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
  type FlipSessionSnapshot,
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
  DAILYDRAFT_FLIP_PROVIDER_HEALTH_FIXTURE: JSON.stringify({
    observedAt: '2026-08-03T12:02:30.000Z',
    poolKey: 'fixture-pool-pending',
    provider: 'fixture-marketplace',
    schemaVersion: 'dailydraft.flip-provider-health-fixture.v1',
    status: 'healthy',
  }),
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
    const admitted = await databaseA.flipSession.findUnique({
      include: { admissionDecision: true },
      where: { id: session.id },
    });
    expect(admitted?.admissionDecision).toMatchObject({
      allowed: true,
      poolCommitmentId: fixture.commitmentId,
      reason: null,
      sessionReference: session.id,
      tierKey: 'USDC:6:50000000',
    });
    await expect(
      Promise.resolve(
        databaseA.flipTierAdmissionDecision.updateMany({
          data: { policyHash: '0'.repeat(64) },
          where: { sessionReference: session.id },
        }),
      ),
    ).rejects.toThrow('Flip tier admission decisions are append-only');

    session = await serviceB.transition(session.id, {
      evidence: { poolCommitmentId: fixture.commitmentId },
      expectedVersion: session.version,
      kind: 'commit-pool',
      transitionKey: 'pool-postgres',
    });
    session = await recordDatabaseSelection(
      databaseB,
      serviceB,
      fixture,
      session,
      'selection-postgres',
    );

    const actions = [
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

  test('persists a denied tier suspension and re-enables it on fresh provider recovery', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'tier-suspension');
    const clock = new DatabaseTestClock();
    setProviderHealthFixture(fixture.poolKey, 'outage');
    const service = new FlipSessionStateService(databaseA, clock, FIXTURE_ENVIRONMENT);
    const created = await service.createFixtureSession({
      playerWalletReference: 'fixture-wallet:postgres-suspension',
      sessionReference: fixture.sessionReference,
    });
    const stake = {
      evidence: {
        amount: usdc('50000000'),
        reference: 'fixture-stake:suspension',
        schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
        status: 'fixture-confirmed' as const,
      },
      expectedVersion: created.version,
      kind: 'confirm-stake' as const,
      transitionKey: 'stake-suspension',
    };

    await expect(service.transition(created.id, stake)).rejects.toMatchObject({
      code: 'TIER_SUSPENDED',
      decision: { reason: 'provider_outage' },
    });
    await expect(service.findSession(created.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: 1,
    });
    await expect(
      databaseA.flipTierAdmissionState.findUnique({
        where: { tierKey: 'USDC:6:50000000' },
      }),
    ).resolves.toMatchObject({
      disabled: true,
      reason: 'provider_outage',
      reenableBoundary: 'fresh_provider_health',
    });

    setProviderHealthFixture(fixture.poolKey, 'healthy');
    await expect(service.transition(created.id, stake)).resolves.toMatchObject({
      status: 'stake-confirmed',
      version: 2,
    });
    await expect(
      databaseA.flipTierAdmissionState.findUnique({
        where: { tierKey: 'USDC:6:50000000' },
      }),
    ).resolves.toMatchObject({
      disabled: false,
      reason: null,
    });
    await expect(
      Promise.resolve(
        databaseA.flipTierAdmissionState.updateMany({
          data: {
            evaluatedAt: new Date('2026-08-03T12:02:29.999Z'),
            version: { increment: 1 },
          },
          where: { tierKey: 'USDC:6:50000000' },
        }),
      ),
    ).rejects.toThrow('Flip tier admission state may only advance monotonically');
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
    { label: 'awaiting stake', status: FlipSessionStatus.AWAITING_STAKE },
    { label: 'stake confirmed', status: FlipSessionStatus.STAKE_CONFIRMED },
    { label: 'reveal ready', status: FlipSessionStatus.REVEAL_READY },
    { label: 'recovery required', status: FlipSessionStatus.RECOVERY_REQUIRED },
    { label: 'failed', status: FlipSessionStatus.FAILED },
  ])('rejects a direct $label insert without its initial transition ledger', async (vector) => {
    const data = await directFlipSessionInsertData(
      databaseA,
      `missing-initial-${vector.label.replaceAll(' ', '-')}`,
      vector.status,
    );

    await expect(Promise.resolve(databaseA.flipSession.create({ data }))).rejects.toThrow(
      'insert requires exact session-started evidence',
    );
    await expect(
      Promise.resolve(databaseA.flipSession.findUnique({ where: { id: data.id } })),
    ).resolves.toBeNull();
  });

  test.each([
    { label: 'awaiting stake', status: FlipSessionStatus.AWAITING_STAKE },
    { label: 'stake confirmed', status: FlipSessionStatus.STAKE_CONFIRMED },
    { label: 'reveal ready', status: FlipSessionStatus.REVEAL_READY },
    { label: 'recovery required', status: FlipSessionStatus.RECOVERY_REQUIRED },
    { label: 'failed', status: FlipSessionStatus.FAILED },
  ])('rejects a direct $label insert with mismatched initial transition evidence', async (vector) => {
    const data = await directFlipSessionInsertData(
      databaseA,
      `mismatched-initial-${vector.label.replaceAll(' ', '-')}`,
      vector.status,
    );
    const requestPayload = stableStringify({
      playerWalletReference: data.playerWalletReference,
      sessionReference: data.id,
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });

    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.create({ data });
        await transaction.flipSessionTransition.create({
          data: {
            evidence: {
              playerWalletReference: data.playerWalletReference,
              stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
            },
            fromStatus: null,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.SESSION_STARTED,
            requestHash: hash(requestPayload),
            requestPayload,
            sequence: 1,
            sessionId: data.id,
            toStatus: FlipSessionStatus.AWAITING_STAKE,
            transitionKey: 'mismatched-session-started',
          },
        });
      }),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(databaseA.flipSession.findUnique({ where: { id: data.id } })),
    ).resolves.toBeNull();
  });

  test('accepts an atomic initial aggregate and exact session-started transition', async () => {
    const data = await directFlipSessionInsertData(
      databaseA,
      'valid-atomic-initial',
      FlipSessionStatus.AWAITING_STAKE,
    );
    const requestPayload = stableStringify({
      playerWalletReference: data.playerWalletReference,
      sessionReference: data.id,
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });

    await databaseA.$transaction(async (transaction) => {
      await transaction.flipSession.create({ data });
      await transaction.flipSessionTransition.create({
        data: {
          evidence: {
            playerWalletReference: data.playerWalletReference,
            stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
          },
          fromStatus: null,
          id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
          kind: FlipSessionTransitionKind.SESSION_STARTED,
          requestHash: hash(requestPayload),
          requestPayload,
          sequence: 1,
          sessionId: data.id,
          toStatus: FlipSessionStatus.AWAITING_STAKE,
          transitionKey: 'session-started',
        },
      });
    });

    await expect(
      Promise.resolve(
        databaseA.flipSession.findUnique({
          include: { transitions: true },
          where: { id: data.id },
        }),
      ),
    ).resolves.toMatchObject({
      id: data.id,
      status: FlipSessionStatus.AWAITING_STAKE,
      transitions: [
        {
          kind: FlipSessionTransitionKind.SESSION_STARTED,
          sequence: 1,
          transitionKey: 'session-started',
        },
      ],
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
            evidence: evidence as unknown as Prisma.InputJsonValue,
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
            evidence: evidence as unknown as Prisma.InputJsonValue,
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
            evidence: evidence as unknown as Prisma.InputJsonValue,
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

  test('rejects fractional lexical integers even when their numeric values match', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'fractional-request-version');
    const { service, session } = await createDatabaseSessionAt(
      databaseA,
      fixture,
      'awaiting-stake',
    );
    const evidence = {
      amount: usdc('50000000'),
      reference: 'fixture-stake:fractional-version',
      schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
      status: 'fixture-confirmed' as const,
    };
    const requestPayload =
      `{"action":{"evidence":${stableStringify(evidence)},` +
      `"expectedVersion":${session.version}.0,"kind":"confirm-stake",` +
      '"transitionKey":"fractional-version"},' +
      `"stateMachineVersion":"${FLIP_SESSION_STATE_MACHINE_VERSION}"}`;

    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            stakeAmount: '50000000',
            stakeCurrency: 'USDC',
            stakeDecimals: 6,
            status: FlipSessionStatus.STAKE_CONFIRMED,
            version: { increment: 1 },
          },
          where: { id: session.id },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence: evidence as unknown as Prisma.InputJsonValue,
            fromStatus: FlipSessionStatus.AWAITING_STAKE,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.STAKE_CONFIRMED,
            poolCommitmentHash: null,
            requestHash: hash(requestPayload),
            requestPayload,
            selectedAssetReference: null,
            sequence: session.version + 1,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.STAKE_CONFIRMED,
            transitionKey: 'fractional-version',
          },
        });
      }),
    ).rejects.toThrow('request payload is invalid');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: session.version,
    });
  });

  test('rejects fractional lexical pool counts and selection ordinals in raw JSONB evidence', async () => {
    const poolFixture = await prepareDatabaseFixture(databaseA, 'fractional-pool-count');
    const { service: poolService, session: staked } = await createDatabaseSessionAt(
      databaseA,
      poolFixture,
      'stake-confirmed',
    );
    const commitment = await databaseA.flipSessionPoolCommitment.findUniqueOrThrow({
      where: { id: poolFixture.commitmentId },
    });
    const poolEvidence = stableStringify({
      eligibleOutcomeCount: commitment.eligibleOutcomeCount,
      poolCommitmentHash: commitment.poolCommitmentHash,
      poolCommitmentId: commitment.id,
      rulesHash: commitment.rulesHash,
      snapshotContentHash: commitment.snapshotContentHash,
    }).replace(
      `"eligibleOutcomeCount":${commitment.eligibleOutcomeCount}`,
      `"eligibleOutcomeCount":${commitment.eligibleOutcomeCount}.0`,
    );
    const poolPayload = stableStringify({
      action: {
        evidence: { poolCommitmentId: commitment.id },
        expectedVersion: staked.version,
        kind: 'commit-pool',
        transitionKey: 'fractional-pool-count',
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });
    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            poolCommitmentHash: commitment.poolCommitmentHash,
            poolCommitmentId: commitment.id,
            rulesHash: commitment.rulesHash,
            snapshotContentHash: commitment.snapshotContentHash,
            status: FlipSessionStatus.POOL_COMMITTED,
            version: { increment: 1 },
          },
          where: { id: staked.id },
        });
        await insertRawTransition(transaction, {
          evidence: poolEvidence,
          fromStatus: 'STAKE_CONFIRMED',
          kind: 'POOL_COMMITTED',
          poolCommitmentHash: commitment.poolCommitmentHash,
          requestHash: hash(poolPayload),
          requestPayload: poolPayload,
          selectedAssetReference: null,
          sequence: staked.version + 1,
          sessionId: staked.id,
          terminalReason: null,
          toStatus: 'POOL_COMMITTED',
          transitionKey: 'fractional-pool-count',
        });
      }),
    ).rejects.toThrow('pool transition evidence is invalid');
    await expect(poolService.findSession(staked.id)).resolves.toMatchObject({
      status: 'stake-confirmed',
      version: staked.version,
    });

    const selectionFixture = await prepareDatabaseFixture(databaseA, 'fractional-ordinal');
    const { service: selectionService, session: pooled } = await createDatabaseSessionAt(
      databaseA,
      selectionFixture,
      'pool-committed',
    );
    const selectionEvidence = stableStringify({
      ...selectionFixture.selected,
      reference: 'fixture-selection:fractional-ordinal',
      resultHash: hash('fractional-ordinal'),
      schemaVersion: FLIP_SELECTION_FIXTURE_VERSION,
    }).replace(
      `"ordinal":${selectionFixture.selected.ordinal}`,
      `"ordinal":${selectionFixture.selected.ordinal}.0`,
    );
    const selectionPayload = stableStringify({
      action: {
        evidence: {
          ...selectionFixture.selected,
          reference: 'fixture-selection:fractional-ordinal',
          resultHash: hash('fractional-ordinal'),
          schemaVersion: FLIP_SELECTION_FIXTURE_VERSION,
        },
        expectedVersion: pooled.version,
        kind: 'record-selection',
        transitionKey: 'fractional-ordinal',
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    }).replace(
      `"ordinal":${selectionFixture.selected.ordinal}`,
      `"ordinal":${selectionFixture.selected.ordinal}.0`,
    );
    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            selectedAssetReference: selectionFixture.selected.providerAssetReference,
            selectedBandLabel: selectionFixture.selected.bandLabel,
            selectedListingReference: selectionFixture.selected.providerListingReference,
            selectedOrdinal: selectionFixture.selected.ordinal,
            selectedValueAmount: selectionFixture.selected.listingValueAmount,
            status: FlipSessionStatus.SELECTION_RECORDED,
            version: { increment: 1 },
          },
          where: { id: pooled.id },
        });
        await insertRawTransition(transaction, {
          evidence: selectionEvidence,
          fromStatus: 'POOL_COMMITTED',
          kind: 'SELECTION_RECORDED',
          poolCommitmentHash: pooled.poolCommitment?.poolCommitmentHash ?? null,
          requestHash: hash(selectionPayload),
          requestPayload: selectionPayload,
          selectedAssetReference: selectionFixture.selected.providerAssetReference,
          sequence: pooled.version + 1,
          sessionId: pooled.id,
          terminalReason: null,
          toStatus: 'SELECTION_RECORDED',
          transitionKey: 'fractional-ordinal',
        });
      }),
    ).rejects.toThrow('requires its prepared audit proof');
    await expect(selectionService.findSession(pooled.id)).resolves.toMatchObject({
      status: 'pool-committed',
      version: pooled.version,
    });
  });

  test('rejects Money beyond the service u64 boundary in aggregate and ledger evidence', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'money-u64-boundary');
    const { service, session } = await createDatabaseSessionAt(
      databaseA,
      fixture,
      'awaiting-stake',
    );
    const evidence = {
      amount: usdc('18446744073709551616'),
      reference: 'fixture-stake:over-u64',
      schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
      status: 'fixture-confirmed' as const,
    };
    const requestPayload = stableStringify({
      action: {
        evidence,
        expectedVersion: session.version,
        kind: 'confirm-stake',
        transitionKey: 'stake-over-u64',
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });

    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            stakeAmount: evidence.amount.amount,
            stakeCurrency: evidence.amount.currency,
            stakeDecimals: evidence.amount.decimals,
            status: FlipSessionStatus.STAKE_CONFIRMED,
            version: { increment: 1 },
          },
          where: { id: session.id },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence: evidence as unknown as Prisma.InputJsonValue,
            fromStatus: FlipSessionStatus.AWAITING_STAKE,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.STAKE_CONFIRMED,
            poolCommitmentHash: null,
            requestHash: hash(requestPayload),
            requestPayload,
            selectedAssetReference: null,
            sequence: session.version + 1,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.STAKE_CONFIRMED,
            transitionKey: 'stake-over-u64',
          },
        });
      }),
    ).rejects.toThrow();
    const moneyValidation = await databaseA.$queryRawUnsafe<Array<{ valid: boolean }>>(
      `SELECT "flip_valid_money"(
        '{"amount":"18446744073709551616","currency":"USDC","decimals":6}'::jsonb
      ) AS valid`,
    );
    expect(moneyValidation).toEqual([{ valid: false }]);
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: session.version,
    });
  });

  test('rejects initial and recovery writes that inject future lifecycle milestones', async () => {
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const injectedSessionId = `injected-initial-${suffix}`;
    const startPayload = stableStringify({
      playerWalletReference: 'fixture-wallet:injected-initial',
      sessionReference: injectedSessionId,
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });
    await expect(
      Promise.resolve(
        databaseA.flipSession.create({
          data: {
            activationMode: 'fixture-only',
            id: injectedSessionId,
            playerWalletReference: 'fixture-wallet:injected-initial',
            purchasedAt: new Date('2026-07-28T16:00:00.000Z'),
            purchaseReference: 'fixture-purchase:injected-initial',
            stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
            status: FlipSessionStatus.AWAITING_STAKE,
            transitions: {
              create: {
                evidence: {
                  playerWalletReference: 'fixture-wallet:injected-initial',
                  stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
                },
                fromStatus: null,
                id: `fliptransition_${suffix}`,
                kind: FlipSessionTransitionKind.SESSION_STARTED,
                requestHash: hash(startPayload),
                requestPayload: startPayload,
                sequence: 1,
                toStatus: FlipSessionStatus.AWAITING_STAKE,
                transitionKey: 'session-started',
              },
            },
            updatedAt: new Date('2026-07-28T16:00:00.000Z'),
            version: 1,
          },
        }),
      ),
    ).rejects.toThrow();

    const fixture = await prepareDatabaseFixture(databaseA, 'injected-recovery');
    const { service, session } = await createDatabaseSessionAt(
      databaseA,
      fixture,
      'awaiting-stake',
    );
    const recoveryEvidence = {
      reasonCode: 'FIXTURE_RECOVERY',
      reference: 'fixture-recovery:injected-stake',
      schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
      status: 'fixture-recovery-required' as const,
    };
    const recoveryPayload = stableStringify({
      action: {
        evidence: recoveryEvidence,
        expectedVersion: session.version,
        kind: 'request-recovery',
        transitionKey: 'injected-recovery',
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });
    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            stakeAmount: '50000000',
            stakeCurrency: 'USDC',
            stakeDecimals: 6,
            status: FlipSessionStatus.RECOVERY_REQUIRED,
            version: { increment: 1 },
          },
          where: { id: session.id },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence: recoveryEvidence,
            fromStatus: FlipSessionStatus.AWAITING_STAKE,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.RECOVERY_REQUESTED,
            poolCommitmentHash: null,
            requestHash: hash(recoveryPayload),
            requestPayload: recoveryPayload,
            selectedAssetReference: null,
            sequence: session.version + 1,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.RECOVERY_REQUIRED,
            transitionKey: 'injected-recovery',
          },
        });
      }),
    ).rejects.toThrow('exact lifecycle action');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: session.version,
    });
  });

  test.each([
    {
      label: 'session reference',
      sessionId: 'not a session reference',
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
      transitionKey: 'session-started',
    },
    {
      label: 'state machine version',
      sessionId: `invalid-version-${crypto.randomUUID().replaceAll('-', '')}`,
      stateMachineVersion: 'dailydraft.flip-session-state.v999',
      transitionKey: 'session-started',
    },
    {
      label: 'transition key',
      sessionId: `invalid-transition-${crypto.randomUUID().replaceAll('-', '')}`,
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
      transitionKey: 'not a transition key',
    },
  ])('rejects an invalid initial $label at the database boundary', async (vector) => {
    const requestPayload = stableStringify({
      playerWalletReference: 'fixture-wallet:invalid-initial',
      sessionReference: vector.sessionId,
      stateMachineVersion: vector.stateMachineVersion,
    });
    await expect(
      Promise.resolve(
        databaseA.flipSession.create({
          data: {
            activationMode: 'fixture-only',
            id: vector.sessionId,
            playerWalletReference: 'fixture-wallet:invalid-initial',
            stateMachineVersion: vector.stateMachineVersion,
            status: FlipSessionStatus.AWAITING_STAKE,
            transitions: {
              create: {
                evidence: {
                  playerWalletReference: 'fixture-wallet:invalid-initial',
                  stateMachineVersion: vector.stateMachineVersion,
                },
                fromStatus: null,
                id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
                kind: FlipSessionTransitionKind.SESSION_STARTED,
                requestHash: hash(requestPayload),
                requestPayload,
                sequence: 1,
                toStatus: FlipSessionStatus.AWAITING_STAKE,
                transitionKey: vector.transitionKey,
              },
            },
            updatedAt: new Date('2026-07-28T16:00:00.000Z'),
            version: 1,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  test('rejects an invalid general transition key at the database boundary', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'invalid-general-transition-key');
    const { service, session } = await createDatabaseSessionAt(
      databaseA,
      fixture,
      'awaiting-stake',
    );
    const transitionKey = 'not a transition key';
    const evidence = {
      amount: usdc('50000000'),
      reference: 'fixture-stake:invalid-transition-key',
      schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
      status: 'fixture-confirmed' as const,
    };
    const requestPayload = stableStringify({
      action: {
        evidence,
        expectedVersion: session.version,
        kind: 'confirm-stake',
        transitionKey,
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });
    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            stakeAmount: evidence.amount.amount,
            stakeCurrency: evidence.amount.currency,
            stakeDecimals: evidence.amount.decimals,
            status: FlipSessionStatus.STAKE_CONFIRMED,
            version: { increment: 1 },
          },
          where: { id: session.id },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence: evidence as unknown as Prisma.InputJsonValue,
            fromStatus: FlipSessionStatus.AWAITING_STAKE,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.STAKE_CONFIRMED,
            poolCommitmentHash: null,
            requestHash: hash(requestPayload),
            requestPayload,
            selectedAssetReference: null,
            sequence: session.version + 1,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.STAKE_CONFIRMED,
            transitionKey,
          },
        });
      }),
    ).rejects.toThrow();
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: session.version,
    });
  });

  test.each([
    'hashes',
    'eligible outcome count',
  ] as const)('rejects forged #117 pool commitment %s at the deferred database boundary', async (forgery) => {
    const fixture = await prepareDatabaseFixture(
      databaseA,
      `forged-pool-${forgery.replaceAll(' ', '-')}`,
    );
    const { service, session } = await createDatabaseSessionAt(
      databaseA,
      fixture,
      'stake-confirmed',
    );
    const commitment = await databaseA.flipSessionPoolCommitment.findUniqueOrThrow({
      where: { id: fixture.commitmentId },
    });
    const forgedHash = hash(`forged-pool-${forgery}`);
    const poolCommitmentHash = forgery === 'hashes' ? forgedHash : commitment.poolCommitmentHash;
    const rulesHash = forgery === 'hashes' ? forgedHash : commitment.rulesHash;
    const snapshotContentHash = forgery === 'hashes' ? forgedHash : commitment.snapshotContentHash;
    const evidence = {
      eligibleOutcomeCount:
        forgery === 'eligible outcome count'
          ? commitment.eligibleOutcomeCount + 1
          : commitment.eligibleOutcomeCount,
      poolCommitmentHash,
      poolCommitmentId: commitment.id,
      rulesHash,
      snapshotContentHash,
    };
    const transitionKey = `forged-pool-${forgery.replaceAll(' ', '-')}`;
    const requestPayload = stableStringify({
      action: {
        evidence: { poolCommitmentId: commitment.id },
        expectedVersion: session.version,
        kind: 'commit-pool',
        transitionKey,
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });

    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            poolCommitmentHash,
            poolCommitmentId: commitment.id,
            rulesHash,
            snapshotContentHash,
            status: FlipSessionStatus.POOL_COMMITTED,
            version: { increment: 1 },
          },
          where: { id: session.id },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence,
            fromStatus: FlipSessionStatus.STAKE_CONFIRMED,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.POOL_COMMITTED,
            poolCommitmentHash,
            requestHash: hash(requestPayload),
            requestPayload,
            selectedAssetReference: null,
            sequence: session.version + 1,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.POOL_COMMITTED,
            transitionKey,
          },
        });
      }),
    ).rejects.toThrow('pool transition evidence is invalid');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'stake-confirmed',
      version: session.version,
    });
  });

  test('rejects a selected outcome that is not an exact member of the #117 outcome space', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'forged-selection-membership');
    const { service, session } = await createDatabaseSessionAt(
      databaseA,
      fixture,
      'pool-committed',
    );
    const evidence = {
      bandLabel: 'forged',
      listingValueAmount: '1',
      ordinal: 99,
      providerAssetReference: 'asset_forged',
      providerListingReference: 'listing_forged',
      reference: 'fixture-selection:forged',
      resultHash: hash('forged-selection'),
      schemaVersion: FLIP_SELECTION_FIXTURE_VERSION,
    };
    const transitionKey = 'forged-selection-membership';
    const requestPayload = stableStringify({
      action: {
        evidence,
        expectedVersion: session.version,
        kind: 'record-selection',
        transitionKey,
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });

    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            selectedAssetReference: evidence.providerAssetReference,
            selectedBandLabel: evidence.bandLabel,
            selectedListingReference: evidence.providerListingReference,
            selectedOrdinal: evidence.ordinal,
            selectedValueAmount: evidence.listingValueAmount,
            status: FlipSessionStatus.SELECTION_RECORDED,
            version: { increment: 1 },
          },
          where: { id: session.id },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence,
            fromStatus: FlipSessionStatus.POOL_COMMITTED,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.SELECTION_RECORDED,
            poolCommitmentHash: session.poolCommitment?.poolCommitmentHash ?? null,
            requestHash: hash(requestPayload),
            requestPayload,
            selectedAssetReference: evidence.providerAssetReference,
            sequence: session.version + 1,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.SELECTION_RECORDED,
            transitionKey,
          },
        });
      }),
    ).rejects.toThrow('requires its prepared audit proof');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'pool-committed',
      version: session.version,
    });
  });

  test('rejects semantically equivalent but non-canonical request payloads', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'noncanonical-request');
    const { service, session } = await createDatabaseSessionAt(
      databaseA,
      fixture,
      'awaiting-stake',
    );
    const evidence = {
      amount: usdc('50000000'),
      reference: 'fixture-stake:noncanonical',
      schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
      status: 'fixture-confirmed' as const,
    };
    const requestPayload = JSON.stringify(
      {
        stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
        action: {
          transitionKey: 'noncanonical-request',
          kind: 'confirm-stake',
          expectedVersion: session.version,
          evidence,
        },
      },
      null,
      2,
    );

    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            stakeAmount: '50000000',
            stakeCurrency: 'USDC',
            stakeDecimals: 6,
            status: FlipSessionStatus.STAKE_CONFIRMED,
            version: { increment: 1 },
          },
          where: { id: session.id },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence: evidence as unknown as Prisma.InputJsonValue,
            fromStatus: FlipSessionStatus.AWAITING_STAKE,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: FlipSessionTransitionKind.STAKE_CONFIRMED,
            poolCommitmentHash: null,
            requestHash: hash(requestPayload),
            requestPayload,
            selectedAssetReference: null,
            sequence: session.version + 1,
            sessionId: session.id,
            terminalReason: null,
            toStatus: FlipSessionStatus.STAKE_CONFIRMED,
            transitionKey: 'noncanonical-request',
          },
        });
      }),
    ).rejects.toThrow('request payload is not canonical');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: 'awaiting-stake',
      version: session.version,
    });
  });

  test.each([
    {
      actionKind: 'record-transfer',
      evidence: (fixture: Awaited<ReturnType<typeof prepareDatabaseFixture>>) => ({
        destinationWalletReference: 'fixture-wallet:postgres-player',
        providerAssetReference: fixture.selected.providerAssetReference,
        reference: 'fixture-transfer:invalid-source',
        schemaVersion: FLIP_TRANSFER_FIXTURE_VERSION,
        sourceCustodyReference: 'not-a-fixture-reference',
        status: 'fixture-transferred',
      }),
      fromStatus: FlipSessionStatus.PURCHASE_RECORDED,
      kind: FlipSessionTransitionKind.TRANSFER_RECORDED,
      label: 'transfer source custody reference',
      target: 'purchase-recorded' as const,
      terminalReason: null,
      toStatus: FlipSessionStatus.TRANSFER_RECORDED,
      update: (evidence: Record<string, unknown>) => ({
        transferReference: evidence.reference as string,
        transferredAt: new Date('2026-07-28T16:30:00.000Z'),
      }),
    },
    {
      actionKind: 'settle',
      evidence: (fixture: Awaited<ReturnType<typeof prepareDatabaseFixture>>) => ({
        payout: usdc('0'),
        providerAssetReference: fixture.selected.providerAssetReference,
        reference: 'not-a-fixture-reference',
        resultHash: hash('invalid-settlement-reference'),
        schemaVersion: FLIP_SETTLEMENT_FIXTURE_VERSION,
        status: 'fixture-recorded',
      }),
      fromStatus: FlipSessionStatus.REVEAL_READY,
      kind: FlipSessionTransitionKind.SETTLED,
      label: 'settlement reference',
      target: 'reveal-ready' as const,
      terminalReason: 'FIXTURE_SETTLED',
      toStatus: FlipSessionStatus.SETTLED,
      update: () => ({
        terminalAt: new Date('2026-07-28T16:30:00.000Z'),
        terminalReason: 'FIXTURE_SETTLED',
      }),
    },
    {
      actionKind: 'settle',
      evidence: (fixture: Awaited<ReturnType<typeof prepareDatabaseFixture>>) => ({
        payout: usdc('18446744073709551616'),
        providerAssetReference: fixture.selected.providerAssetReference,
        reference: 'fixture-settlement:over-u64',
        resultHash: hash('invalid-settlement-payout'),
        schemaVersion: FLIP_SETTLEMENT_FIXTURE_VERSION,
        status: 'fixture-recorded',
      }),
      fromStatus: FlipSessionStatus.REVEAL_READY,
      kind: FlipSessionTransitionKind.SETTLED,
      label: 'settlement payout above u64',
      target: 'reveal-ready' as const,
      terminalReason: 'FIXTURE_SETTLED',
      toStatus: FlipSessionStatus.SETTLED,
      update: () => ({
        terminalAt: new Date('2026-07-28T16:30:00.000Z'),
        terminalReason: 'FIXTURE_SETTLED',
      }),
    },
    {
      actionKind: 'request-recovery',
      evidence: () => ({
        reasonCode: 'FIXTURE_RECOVERY',
        reference: 'not-a-fixture-reference',
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovery-required',
      }),
      fromStatus: FlipSessionStatus.AWAITING_STAKE,
      kind: FlipSessionTransitionKind.RECOVERY_REQUESTED,
      label: 'recovery request reference',
      target: 'awaiting-stake' as const,
      terminalReason: null,
      toStatus: FlipSessionStatus.RECOVERY_REQUIRED,
      update: () => ({}),
    },
    {
      actionKind: 'complete-recovery',
      evidence: () => ({
        payout: usdc('0'),
        reference: 'not-a-fixture-reference',
        resultHash: hash('invalid-recovery-completion-reference'),
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovered',
      }),
      fromStatus: FlipSessionStatus.RECOVERY_REQUIRED,
      kind: FlipSessionTransitionKind.RECOVERY_COMPLETED,
      label: 'recovery completion reference',
      target: 'recovery-required' as const,
      terminalReason: 'FIXTURE_RECOVERY_COMPLETED',
      toStatus: FlipSessionStatus.RECOVERED,
      update: () => ({
        terminalAt: new Date('2026-07-28T16:30:00.000Z'),
        terminalReason: 'FIXTURE_RECOVERY_COMPLETED',
      }),
    },
    {
      actionKind: 'complete-recovery',
      evidence: () => ({
        payout: usdc('18446744073709551616'),
        reference: 'fixture-recovery:over-u64',
        resultHash: hash('invalid-recovery-payout'),
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovered',
      }),
      fromStatus: FlipSessionStatus.RECOVERY_REQUIRED,
      kind: FlipSessionTransitionKind.RECOVERY_COMPLETED,
      label: 'recovery payout above u64',
      target: 'recovery-required' as const,
      terminalReason: 'FIXTURE_RECOVERY_COMPLETED',
      toStatus: FlipSessionStatus.RECOVERED,
      update: () => ({
        terminalAt: new Date('2026-07-28T16:30:00.000Z'),
        terminalReason: 'FIXTURE_RECOVERY_COMPLETED',
      }),
    },
    {
      actionKind: 'terminate',
      evidence: () => ({
        reasonCode: 'PROVIDER_DOWN',
        reference: 'not-a-fixture-reference',
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-failed',
      }),
      fromStatus: FlipSessionStatus.RECOVERY_REQUIRED,
      kind: FlipSessionTransitionKind.TERMINATED,
      label: 'termination reference',
      target: 'recovery-required' as const,
      terminalReason: 'FIXTURE_TERMINATED:PROVIDER_DOWN',
      toStatus: FlipSessionStatus.FAILED,
      update: () => ({
        terminalAt: new Date('2026-07-28T16:30:00.000Z'),
        terminalReason: 'FIXTURE_TERMINATED:PROVIDER_DOWN',
      }),
    },
  ])('rejects an invalid $label at the deferred database boundary', async (vector) => {
    const fixture = await prepareDatabaseFixture(
      databaseA,
      `invalid-${vector.label.replaceAll(' ', '-')}`,
    );
    const { service, session } = await createDatabaseSessionAt(databaseA, fixture, vector.target);
    const evidence = vector.evidence(fixture);
    const transitionKey = `invalid-${vector.label.replaceAll(' ', '-')}`;
    const requestPayload = stableStringify({
      action: {
        evidence,
        expectedVersion: session.version,
        kind: vector.actionKind,
        transitionKey,
      },
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });

    await expect(
      databaseA.$transaction(async (transaction) => {
        await transaction.flipSession.update({
          data: {
            ...vector.update(evidence),
            status: vector.toStatus,
            version: { increment: 1 },
          },
          where: { id: session.id },
        });
        await transaction.flipSessionTransition.create({
          data: {
            evidence: evidence as unknown as Prisma.InputJsonValue,
            fromStatus: vector.fromStatus,
            id: `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
            kind: vector.kind,
            poolCommitmentHash: session.poolCommitment?.poolCommitmentHash ?? null,
            requestHash: hash(requestPayload),
            requestPayload,
            selectedAssetReference: session.selectedOutcome?.providerAssetReference ?? null,
            sequence: session.version + 1,
            sessionId: session.id,
            terminalReason: vector.terminalReason,
            toStatus: vector.toStatus,
            transitionKey,
          },
        });
      }),
    ).rejects.toThrow('transition evidence is invalid');
    await expect(service.findSession(session.id)).resolves.toMatchObject({
      status: session.status,
      version: session.version,
    });
  });
});

async function directFlipSessionInsertData(
  database: DatabaseClient,
  label: string,
  status: FlipSessionStatus,
): Promise<Prisma.FlipSessionUncheckedCreateInput> {
  const now = new Date('2026-07-28T16:00:00.000Z');
  const base = {
    activationMode: 'fixture-only',
    id: `raw-flip-session-${label}-${crypto.randomUUID().replaceAll('-', '')}`,
    playerWalletReference: 'fixture-wallet:raw-insert',
    stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    status,
    updatedAt: now,
  } satisfies Omit<Prisma.FlipSessionUncheckedCreateInput, 'version'>;

  switch (status) {
    case FlipSessionStatus.AWAITING_STAKE:
      return { ...base, version: 1 };
    case FlipSessionStatus.STAKE_CONFIRMED:
      return {
        ...base,
        stakeAmount: '50000000',
        stakeCurrency: 'USDC',
        stakeDecimals: 6,
        version: 2,
      };
    case FlipSessionStatus.RECOVERY_REQUIRED:
      return { ...base, version: 2 };
    case FlipSessionStatus.FAILED:
      return {
        ...base,
        terminalAt: now,
        terminalReason: 'FIXTURE_TERMINATED:RAW_INSERT',
        version: 3,
      };
    case FlipSessionStatus.REVEAL_READY: {
      const fixture = await prepareDatabaseFixture(database, label);
      const commitment = await database.flipSessionPoolCommitment.findUniqueOrThrow({
        where: { id: fixture.commitmentId },
      });
      return {
        ...base,
        id: fixture.sessionReference,
        poolCommitmentHash: commitment.poolCommitmentHash,
        poolCommitmentId: commitment.id,
        purchaseReference: 'fixture-purchase:raw-insert',
        purchasedAt: now,
        revealReadyAt: now,
        revealReadyReference: 'fixture-reveal:raw-insert',
        rulesHash: commitment.rulesHash,
        selectedAssetReference: fixture.selected.providerAssetReference,
        selectedBandLabel: fixture.selected.bandLabel,
        selectedListingReference: fixture.selected.providerListingReference,
        selectedOrdinal: fixture.selected.ordinal,
        selectedValueAmount: fixture.selected.listingValueAmount,
        snapshotContentHash: commitment.snapshotContentHash,
        stakeAmount: '50000000',
        stakeCurrency: 'USDC',
        stakeDecimals: 6,
        transferredAt: now,
        transferReference: 'fixture-transfer:raw-insert',
        version: 7,
      };
    }
    default:
      throw new Error(`unsupported raw Flip session status ${status}`);
  }
}

async function prepareDatabaseFixture(database: DatabaseClient, label: string) {
  const suffix = `${label}-${crypto.randomUUID().replaceAll('-', '')}`;
  const sessionReference = `dbtest-flip-session-${suffix}`;
  const poolKey = `dbtest-flip-pool-${suffix}`;
  const policyVersion = `dbtest-flip-policy-${suffix}`;
  const rulesKey = `dbtest-flip-rules-${suffix}`;
  FIXTURE_ENVIRONMENT.DAILYDRAFT_FLIP_PROVIDER_HEALTH_FIXTURE = JSON.stringify({
    observedAt: '2026-08-03T12:02:30.000Z',
    poolKey,
    provider: 'fixture-marketplace',
    schemaVersion: 'dailydraft.flip-provider-health-fixture.v1',
    status: 'healthy',
  });
  const inventory = new FlipInventorySnapshotService(database);
  const snapshot = await inventory.createFixtureSnapshot({
    candidates: [
      candidate('base', '20000000'),
      candidate('plus', '30000000'),
      candidate('chase', '60000000'),
    ],
    evaluatedAt: new Date('2026-08-03T12:02:00.000Z'),
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
    poolKey,
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

function setProviderHealthFixture(poolKey: string, status: 'healthy' | 'outage'): void {
  FIXTURE_ENVIRONMENT.DAILYDRAFT_FLIP_PROVIDER_HEALTH_FIXTURE = JSON.stringify({
    observedAt: '2026-08-03T12:02:30.000Z',
    poolKey,
    provider: 'fixture-marketplace',
    schemaVersion: 'dailydraft.flip-provider-health-fixture.v1',
    status,
  });
}

type DatabaseFixture = Awaited<ReturnType<typeof prepareDatabaseFixture>>;
type DatabaseSessionTarget =
  | 'awaiting-stake'
  | 'stake-confirmed'
  | 'pool-committed'
  | 'selection-recorded'
  | 'purchase-recorded'
  | 'transfer-recorded'
  | 'reveal-ready'
  | 'recovery-required';

async function createDatabaseSessionAt(
  database: DatabaseClient,
  fixture: DatabaseFixture,
  target: DatabaseSessionTarget,
): Promise<{ service: FlipSessionStateService; session: FlipSessionSnapshot }> {
  const service = new FlipSessionStateService(
    database,
    new DatabaseTestClock(),
    FIXTURE_ENVIRONMENT,
  );
  let session = await service.createFixtureSession({
    playerWalletReference: 'fixture-wallet:postgres-player',
    sessionReference: fixture.sessionReference,
  });
  if (target === 'awaiting-stake') return { service, session };
  if (target === 'recovery-required') {
    session = await service.transition(session.id, {
      evidence: {
        reasonCode: 'FIXTURE_RECOVERY',
        reference: 'fixture-recovery:postgres-request',
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovery-required',
      },
      expectedVersion: session.version,
      kind: 'request-recovery',
      transitionKey: 'recovery-postgres-request',
    });
    return { service, session };
  }

  const actions = [
    {
      evidence: {
        amount: usdc('50000000'),
        reference: 'fixture-stake:postgres',
        schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
        status: 'fixture-confirmed' as const,
      },
      kind: 'confirm-stake' as const,
      transitionKey: 'stake-postgres',
    },
    {
      evidence: { poolCommitmentId: fixture.commitmentId },
      kind: 'commit-pool' as const,
      transitionKey: 'pool-postgres',
    },
  ];

  for (const action of actions) {
    session = await service.transition(session.id, {
      ...action,
      expectedVersion: session.version,
    });
    if (session.status === target) return { service, session };
  }

  session = await recordDatabaseSelection(
    database,
    service,
    fixture,
    session,
    'selection-postgres',
  );
  if (session.status === target) return { service, session };

  const postSelectionActions = [
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
        sourceCustodyReference: 'fixture-custody:postgres-house',
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

  for (const action of postSelectionActions) {
    session = await service.transition(session.id, {
      ...action,
      expectedVersion: session.version,
    });
    if (session.status === target) return { service, session };
  }
  throw new Error(`unsupported database session target ${target}`);
}

async function recordDatabaseSelection(
  database: DatabaseClient,
  sessions: FlipSessionStateService,
  fixture: DatabaseFixture,
  session: FlipSessionSnapshot,
  transitionKey: string,
): Promise<FlipSessionSnapshot> {
  const selected = await new FlipOutcomeSelectionService(
    database,
    sessions,
    FIXTURE_ENVIRONMENT,
  ).selectFixtureOutcome({
    approvedEntropy: {
      approvedAt: '2026-08-03T12:03:00.000Z',
      payload: `database-state-fixture:${fixture.sessionReference}`,
      reference: `fixture-entropy:${fixture.sessionReference}`,
      schemaVersion: FLIP_APPROVED_ENTROPY_SCHEMA_VERSION,
      sessionReference: fixture.sessionReference,
      source: 'fixture-approved',
    },
    expectedVersion: session.version,
    sessionReference: fixture.sessionReference,
    transitionKey,
  });
  fixture.selected = selected.selectedOutcome;
  return selected.session;
}

async function insertRawTransition(
  transaction: Prisma.TransactionClient,
  input: {
    evidence: string;
    fromStatus: string;
    kind: string;
    poolCommitmentHash: string | null;
    requestHash: string;
    requestPayload: string;
    selectedAssetReference: string | null;
    sequence: number;
    sessionId: string;
    terminalReason: string | null;
    toStatus: string;
    transitionKey: string;
  },
): Promise<void> {
  await transaction.$executeRawUnsafe(
    `INSERT INTO "FlipSessionTransition" (
      "id",
      "sessionId",
      "sequence",
      "transitionKey",
      "requestHash",
      "requestPayload",
      "kind",
      "fromStatus",
      "toStatus",
      "evidence",
      "poolCommitmentHash",
      "selectedAssetReference",
      "terminalReason"
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7::"FlipSessionTransitionKind",
      $8::"FlipSessionStatus",
      $9::"FlipSessionStatus",
      $10::jsonb,
      $11,
      $12,
      $13
    )`,
    `fliptransition_${crypto.randomUUID().replaceAll('-', '')}`,
    input.sessionId,
    input.sequence,
    input.transitionKey,
    input.requestHash,
    input.requestPayload,
    input.kind,
    input.fromStatus,
    input.toStatus,
    input.evidence,
    input.poolCommitmentHash,
    input.selectedAssetReference,
    input.terminalReason,
  );
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
  const sourceTimestamp = new Date('2026-08-03T12:01:30.000Z');
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
  #current = new Date('2026-08-03T12:02:30.000Z');

  advance(milliseconds: number): void {
    this.#current = new Date(this.#current.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.#current);
  }
}
