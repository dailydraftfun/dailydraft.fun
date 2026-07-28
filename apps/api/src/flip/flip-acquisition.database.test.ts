import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDatabaseClient, type DatabaseClient, type Prisma } from '@dailydraft/db';

import type { Money } from '../domain.js';
import {
  canonicalFlipAcquisitionStringify,
  createFixtureFlipAcquisitionPolicy,
} from './flip-acquisition.policy.js';
import {
  DeterministicFlipAcquisitionFixtureProvider,
  FLIP_ACQUISITION_PROVIDER_FIXTURE_VERSION,
  FlipAcquisitionAmbiguousError,
  FlipAcquisitionDefinitelyNotAppliedError,
  FlipAcquisitionProvider,
  type FlipAcquisitionProviderRequest,
  type FlipAcquisitionProviderResult,
} from './flip-acquisition.provider.js';
import { FlipAcquisitionService } from './flip-acquisition.service.js';
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
  FLIP_REVEAL_READY_FIXTURE_VERSION,
  FLIP_STAKE_FIXTURE_VERSION,
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

describeDatabase('Flip acquisition recovery against two real Postgres connections', () => {
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

  test('serializes concurrent purchase and transfer into one acquisition receipt', async () => {
    const fixture = await prepareAcquisitionFixture(databaseA, 'concurrent');
    const provider = new DatabaseTestProvider();
    const serviceA = acquisitionService(databaseA, provider);
    const serviceB = acquisitionService(databaseB, provider);

    const concurrent = await Promise.all([
      serviceA.resumeFixtureAcquisition(fixture.sessionId),
      serviceB.resumeFixtureAcquisition(fixture.sessionId),
    ]);
    const replay = await serviceB.resumeFixtureAcquisition(fixture.sessionId);

    expect([...concurrent, replay].some(({ status }) => status === 'acquired')).toBe(true);
    expect(replay).toMatchObject({
      finalizedOperationCount: 2,
      receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      status: 'acquired',
    });
    expect(provider.executionCount).toBe(2);
    expect(
      await databaseA.flipAcquisitionOperation.count({
        where: { acquisition: { sessionId: fixture.sessionId }, status: 'FINALIZED' },
      }),
    ).toBe(2);
    expect(
      await databaseA.flipSessionTransition.count({
        where: {
          kind: { in: ['PURCHASE_RECORDED', 'TRANSFER_RECORDED'] },
          sessionId: fixture.sessionId,
        },
      }),
    ).toBe(2);
  });

  test('reconciles a lost purchase response after a provider process restart', async () => {
    const fixture = await prepareAcquisitionFixture(databaseA, 'lost-response');
    const firstProvider = new LostResponseFixtureProvider();
    const first = await acquisitionService(databaseA, firstProvider).resumeFixtureAcquisition(
      fixture.sessionId,
    );

    expect(first).toMatchObject({
      operations: [
        expect.objectContaining({
          kind: 'purchase',
          recoveryMode: 'reconcile-only',
          status: 'recovery-required',
        }),
        expect.anything(),
      ],
      status: 'recovery-required',
    });
    const recovered = await acquisitionService(
      databaseB,
      new DeterministicFlipAcquisitionFixtureProvider(),
    ).resumeFixtureAcquisition(fixture.sessionId);
    expect(recovered.status).toBe('acquired');
    expect(firstProvider.purchaseExecutions).toBe(1);
    const operations = await databaseA.flipAcquisitionOperation.findMany({
      orderBy: { sequence: 'asc' },
      where: { acquisition: { sessionId: fixture.sessionId } },
    });
    expect(operations).toMatchObject([
      { kind: 'PURCHASE', status: 'FINALIZED', submissionCount: 1 },
      { kind: 'TRANSFER', status: 'FINALIZED', submissionCount: 1 },
    ]);
  });

  test.each([
    ['PROVIDER_REJECTED', 'refund'],
    ['SELECTED_ASSET_UNAVAILABLE', 'reselection'],
    ['APPROVED_SUBSTITUTE_REQUIRED', 'substitute'],
  ] as const)('prevents a stale concurrent worker from resubmitting %s recovery', async (failureCode, branch) => {
    const fixture = await prepareAcquisitionFixture(databaseA, `concurrent-recovery-${branch}`);
    const provider = new DatabaseTestProvider({
      failKind: 'purchase',
      failureCode,
    });
    const beforeClaim = deferred<void>();
    const releaseClaim = deferred<void>();
    const staleDatabase = delayFirstAcquisitionClaim(databaseB, beforeClaim, releaseClaim);
    const staleAttempt = acquisitionService(staleDatabase, provider).resumeFixtureAcquisition(
      fixture.sessionId,
    );
    await beforeClaim.promise;

    const recovery = await acquisitionService(databaseA, provider).resumeFixtureAcquisition(
      fixture.sessionId,
    );
    releaseClaim.resolve();
    const staleResult = await staleAttempt;

    expect(recovery).toMatchObject({
      recoveryBranch: branch,
      recoveryReason: failureCode,
      status: 'recovery-required',
    });
    expect(staleResult).toEqual(recovery);
    expect(provider.executionsFor('purchase')).toBe(1);
    expect(
      await databaseA.flipSessionTransition.count({
        where: { kind: 'RECOVERY_REQUESTED', sessionId: fixture.sessionId },
      }),
    ).toBe(1);
  });

  test.each([
    ['PROVIDER_REJECTED', 'refund'],
    ['SELECTED_ASSET_UNAVAILABLE', 'reselection'],
    ['APPROVED_SUBSTITUTE_REQUIRED', 'substitute'],
  ] as const)('persists only the reviewed %s recovery branch', async (failureCode, branch) => {
    const fixture = await prepareAcquisitionFixture(databaseA, `branch-${branch}`);
    const provider = new DatabaseTestProvider({ failKind: 'purchase', failureCode });
    const service = acquisitionService(databaseA, provider);

    const first = await service.resumeFixtureAcquisition(fixture.sessionId);
    const replay = await acquisitionService(databaseB, provider).resumeFixtureAcquisition(
      fixture.sessionId,
    );

    expect(first).toMatchObject({
      recoveryBranch: branch,
      recoveryReason: failureCode,
      status: 'recovery-required',
    });
    expect(replay).toEqual(first);
    expect(provider.executionsFor('purchase')).toBe(1);
    expect(
      await databaseA.flipSessionTransition.count({
        where: { kind: 'RECOVERY_REQUESTED', sessionId: fixture.sessionId },
      }),
    ).toBe(1);
  });

  test('binds retained purchase custody and settlement inventory exactly once', async () => {
    const fixture = await prepareAcquisitionFixture(databaseA, 'retained-inventory');
    const provider = new DatabaseTestProvider({
      failKind: 'transfer',
      failureCode: 'PROVIDER_REJECTED',
    });
    const service = acquisitionService(databaseA, provider);

    const first = await service.resumeFixtureAcquisition(fixture.sessionId);
    const replay = await service.resumeFixtureAcquisition(fixture.sessionId);

    expect(first.recoveryBranch).toBe('refund');
    expect(replay).toEqual(first);
    const inventory = await databaseA.houseInventoryAsset.findMany({
      where: { flipSessionId: fixture.sessionId },
    });
    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      assetReference: fixture.selectedAssetReference,
      custodyWallet: 'fixture-wallet:flip-house-inventory',
      flipAcquisitionOperationId: expect.any(String),
    });
    expect(
      await databaseA.houseTreasuryLedgerEntry.count({
        where: { flipSessionId: fixture.sessionId, type: 'FLIP_RECOVERY_INVENTORY' },
      }),
    ).toBe(1);
    const retained = inventory[0];
    if (!retained) throw new Error('Retained inventory fixture is absent');
    await expect(
      Promise.resolve(
        databaseA.houseInventoryAsset.update({
          data: { custodyWallet: 'fixture-wallet:forged-custody' },
          where: { id: retained.id },
        }),
      ),
    ).rejects.toThrow('Flip recovery inventory custody binding is immutable');
    expect(provider.executionsFor('purchase')).toBe(1);
    expect(provider.executionsFor('transfer')).toBe(1);
  });

  test('rejects acquisition proof tampering and deletion in Postgres', async () => {
    const fixture = await prepareAcquisitionFixture(databaseA, 'tamper');
    await acquisitionService(databaseA, new DatabaseTestProvider()).resumeFixtureAcquisition(
      fixture.sessionId,
    );
    const acquisition = await databaseA.flipAcquisition.findUniqueOrThrow({
      include: { operations: { orderBy: { sequence: 'asc' } } },
      where: { sessionId: fixture.sessionId },
    });
    const purchase = acquisition.operations[0];
    if (!purchase) throw new Error('Fixture acquisition purchase operation is absent');

    await expect(
      Promise.resolve(
        databaseA.flipAcquisitionOperation.update({
          data: { requestHash: '0'.repeat(64) },
          where: { id: purchase.id },
        }),
      ),
    ).rejects.toThrow('Flip acquisition operation request or finality is immutable');
    await expect(
      Promise.resolve(databaseA.flipAcquisition.delete({ where: { id: acquisition.id } })),
    ).rejects.toThrow('Flip acquisition evidence is append-only');
  });

  test('rejects null and semantically forged acquisition plans in Postgres', async () => {
    const nullFixture = await prepareAcquisitionFixture(databaseA, 'null-plan');
    await expect(
      createRawAcquisitionPlan(databaseA, nullFixture.sessionId, 'null'),
    ).rejects.toThrow('does not match finalized selection and reviewed policy');

    const forgedFixture = await prepareAcquisitionFixture(databaseB, 'forged-plan');
    await expect(
      createRawAcquisitionPlan(databaseB, forgedFixture.sessionId, 'forged-asset'),
    ).rejects.toThrow();
    expect(
      await databaseA.flipAcquisition.findUnique({
        where: { sessionId: forgedFixture.sessionId },
      }),
    ).toBeNull();
  });

  test('blocks reveal for a sealed-policy session until the acquisition receipt is final', async () => {
    const fixture = await prepareAcquisitionFixture(databaseA, 'reveal-gate');
    const finalizationBlocked = blockAcquisitionFinalization(databaseA);
    await expect(
      acquisitionService(
        finalizationBlocked,
        new DeterministicFlipAcquisitionFixtureProvider(),
      ).resumeFixtureAcquisition(fixture.sessionId),
    ).rejects.toThrow('test blocked acquisition finalization');

    const sessions = new FlipSessionStateService(
      databaseA,
      new DatabaseTestClock(),
      FIXTURE_ENVIRONMENT,
    );
    const session = await sessions.findSession(fixture.sessionId);
    if (!session.purchaseReference || !session.transferReference) {
      throw new Error('Reveal-gate fixture did not reach durable transfer state');
    }
    await expect(
      sessions.transition(fixture.sessionId, {
        evidence: {
          purchaseReference: session.purchaseReference,
          reference: 'fixture-reveal:acquisition-not-final',
          schemaVersion: FLIP_REVEAL_READY_FIXTURE_VERSION,
          status: 'fixture-ready',
          transferReference: session.transferReference,
        },
        expectedVersion: session.version,
        kind: 'mark-reveal-ready',
        transitionKey: 'reveal-before-acquisition-finality',
      }),
    ).rejects.toThrow('Flip reveal requires finalized purchase and transfer acquisition proof');

    expect((await sessions.findSession(fixture.sessionId)).status).toBe('transfer-recorded');
  });
});

function acquisitionService(
  database: DatabaseClient,
  provider: FlipAcquisitionProvider,
): FlipAcquisitionService {
  return new FlipAcquisitionService(
    database,
    provider,
    new FlipSessionStateService(database, new DatabaseTestClock(), FIXTURE_ENVIRONMENT),
    FIXTURE_ENVIRONMENT,
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface RawAcquisitionOperation {
  amount: string;
  assetReference: string;
  destinationReference: string;
  expectedSessionVersion: number;
  kind: 'PURCHASE' | 'TRANSFER';
  listingReference: string;
  operationKey: string;
  providerRequestKey: string;
  requestHash: string;
  sequence: number;
  sourceReference: string;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function delayFirstAcquisitionClaim(
  database: DatabaseClient,
  beforeClaim: Deferred<void>,
  releaseClaim: Deferred<void>,
): DatabaseClient {
  let delayed = false;
  return database.$extends({
    query: {
      flipAcquisition: {
        async updateMany({ args, query }) {
          if (!delayed && typeof args.data.leaseOwner === 'string') {
            delayed = true;
            beforeClaim.resolve();
            await releaseClaim.promise;
          }
          return query(args);
        },
      },
    },
  }) as unknown as DatabaseClient;
}

function blockAcquisitionFinalization(database: DatabaseClient): DatabaseClient {
  return database.$extends({
    query: {
      flipAcquisition: {
        async update({ args, query }) {
          if (args.data.status === 'ACQUIRED') {
            throw new Error('test blocked acquisition finalization');
          }
          return query(args);
        },
      },
    },
  }) as unknown as DatabaseClient;
}

async function createRawAcquisitionPlan(
  database: DatabaseClient,
  sessionId: string,
  mode: 'forged-asset' | 'null',
): Promise<void> {
  const session = await database.flipSession.findUniqueOrThrow({
    include: {
      poolCommitment: {
        include: { ruleset: { include: { acquisitionPolicy: true } } },
      },
      selectionProof: true,
    },
    where: { id: sessionId },
  });
  const commitment = session.poolCommitment;
  const policy = commitment?.ruleset.acquisitionPolicy;
  const proof = session.selectionProof;
  if (
    !commitment ||
    !policy ||
    !proof ||
    session.selectedOrdinal === null ||
    !session.selectedBandLabel ||
    !session.selectedAssetReference ||
    !session.selectedListingReference ||
    !session.selectedValueAmount
  ) {
    throw new Error('Raw acquisition fixture binding is incomplete');
  }

  const selected = {
    amount: session.selectedValueAmount,
    assetReference: session.selectedAssetReference,
    listingReference: session.selectedListingReference,
  };
  const operations =
    mode === 'null'
      ? []
      : [
          rawAcquisitionOperation({
            ...selected,
            assetReference: 'fixture-asset-forged-plan',
            destinationReference: policy.houseInventoryCustodyReference,
            expectedSessionVersion: session.version,
            kind: 'PURCHASE',
            sequence: 1,
            sessionId,
            sourceReference: policy.providerSourceCustodyReference,
          }),
          rawAcquisitionOperation({
            ...selected,
            destinationReference: session.playerWalletReference,
            expectedSessionVersion: session.version + 1,
            kind: 'TRANSFER',
            sequence: 2,
            sessionId,
            sourceReference: policy.houseInventoryCustodyReference,
          }),
        ];
  const requestKey = `flip-acquisition:${proof.resultHash.slice(0, 40)}`;
  const requestHash = hash(
    canonicalFlipAcquisitionStringify({
      operations: mode === 'null' ? null : operations,
      policyHash: policy.policyHash,
      poolCommitmentHash: session.poolCommitmentHash,
      requestKey,
      rulesHash: session.rulesHash,
      selectionProofId: proof.id,
      selectionResultHash: proof.resultHash,
      sessionReference: session.id,
      snapshotContentHash: session.snapshotContentHash,
    }),
  );
  const data = {
    activationMode: 'fixture-only',
    expectedOperationCount: 2,
    houseInventoryCustodyReference: policy.houseInventoryCustodyReference,
    id: `flipacquisition_${crypto.randomUUID().replaceAll('-', '')}`,
    network: policy.network,
    ...(operations.length > 0
      ? {
          operations: {
            create: operations.map((operation) => ({
              ...operation,
              currency: 'USDC',
              decimals: 6,
              id: `flipacqop_${crypto.randomUUID().replaceAll('-', '')}`,
            })),
          },
        }
      : {}),
    playerWalletReference: session.playerWalletReference,
    policyId: policy.id,
    provider: policy.provider,
    requestHash,
    requestKey,
    rulesHash: commitment.rulesHash,
    rulesVersion: commitment.rulesVersion,
    schemaVersion: 'dailydraft.flip-acquisition.v1',
    selectedAssetReference: session.selectedAssetReference,
    selectedBandLabel: session.selectedBandLabel,
    selectedListingReference: session.selectedListingReference,
    selectedOrdinal: session.selectedOrdinal,
    selectedValueAmount: session.selectedValueAmount,
    selectionProofId: proof.id,
    sessionId,
    sourceCustodyReference: policy.providerSourceCustodyReference,
  } satisfies Prisma.FlipAcquisitionCreateArgs['data'];
  await database.flipAcquisition.create({ data });
}

function rawAcquisitionOperation(input: {
  amount: string;
  assetReference: string;
  destinationReference: string;
  expectedSessionVersion: number;
  kind: 'PURCHASE' | 'TRANSFER';
  listingReference: string;
  sequence: number;
  sessionId: string;
  sourceReference: string;
}): RawAcquisitionOperation {
  const operationKey = `flip-acquisition:${input.sequence}:${input.kind.toLowerCase()}`;
  const providerRequestKey = `fixture-acquisition:${hash(
    canonicalFlipAcquisitionStringify({
      operationKey,
      sessionReference: input.sessionId,
    }),
  ).slice(0, 40)}`;
  const requestHash = hash(
    canonicalFlipAcquisitionStringify({
      amount: input.amount,
      assetReference: input.assetReference,
      currency: 'USDC',
      decimals: 6,
      destinationReference: input.destinationReference,
      kind: input.kind.toLowerCase(),
      listingReference: input.listingReference,
      operationKey,
      providerRequestKey,
      sessionReference: input.sessionId,
      sourceReference: input.sourceReference,
    }),
  );
  return {
    amount: input.amount,
    assetReference: input.assetReference,
    destinationReference: input.destinationReference,
    expectedSessionVersion: input.expectedSessionVersion,
    kind: input.kind,
    listingReference: input.listingReference,
    operationKey,
    providerRequestKey,
    requestHash,
    sequence: input.sequence,
    sourceReference: input.sourceReference,
  };
}

async function prepareAcquisitionFixture(database: DatabaseClient, label: string) {
  const suffix = `${label}-${crypto.randomUUID().replaceAll('-', '')}`;
  const sessionReference = `dbtest-flip-acquisition-${suffix}`;
  const poolKey = `dbtest-flip-acquisition-pool-${suffix}`;
  const policyVersion = `dbtest-flip-acquisition-inventory-${suffix}`;
  const rulesKey = `dbtest-flip-acquisition-rules-${suffix}`;
  const inventory = new FlipInventorySnapshotService(database);
  const snapshot = await inventory.createFixtureSnapshot({
    candidates: [
      candidate(`${suffix}-base-secondary`, '15000000'),
      candidate(`${suffix}-base`, '20000000'),
      candidate(`${suffix}-plus`, '30000000'),
      candidate(`${suffix}-chase`, '60000000'),
    ],
    evaluatedAt: new Date('2026-08-03T12:00:00.000Z'),
    policy: snapshotPolicy(poolKey, policyVersion),
  });
  const rulesService = new FlipRulesService(database);
  const rules = createFixtureFlipRuleSet({
    inventoryPolicyVersion: policyVersion,
    poolKey,
    rulesKey,
  });
  await rulesService.createFixtureRuleSet(rules);
  await acquisitionService(database, new DatabaseTestProvider()).createFixturePolicy({
    policy: createFixtureFlipAcquisitionPolicy({
      rulesHash: rules.rulesHash,
      rulesVersion: rules.version,
    }),
    rulesKey,
    rulesVersion: rules.version,
  });
  const commitment = await rulesService.createFixtureSessionPoolCommitment({
    committedAt: new Date('2026-08-03T12:02:00.000Z'),
    rulesKey,
    rulesVersion: rules.version,
    sessionReference,
    snapshotId: snapshot.id,
  });
  const sessions = new FlipSessionStateService(
    database,
    new DatabaseTestClock(),
    FIXTURE_ENVIRONMENT,
  );
  let session = await sessions.createFixtureSession({
    playerWalletReference: 'fixture-wallet:acquisition-player',
    sessionReference,
  });
  session = await sessions.transition(session.id, {
    evidence: {
      amount: usdc('50000000'),
      reference: `fixture-stake:${label}`,
      schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
      status: 'fixture-confirmed',
    },
    expectedVersion: session.version,
    kind: 'confirm-stake',
    transitionKey: `confirm-stake-${label}`,
  });
  session = await sessions.transition(session.id, {
    evidence: { poolCommitmentId: commitment.id },
    expectedVersion: session.version,
    kind: 'commit-pool',
    transitionKey: `commit-pool-${label}`,
  });
  const selected = await new FlipOutcomeSelectionService(
    database,
    sessions,
    FIXTURE_ENVIRONMENT,
  ).selectFixtureOutcome({
    approvedEntropy: {
      approvedAt: '2026-08-03T12:03:00.000Z',
      payload: `approved-entropy-${label}`,
      reference: `fixture-entropy:${label}`,
      schemaVersion: FLIP_APPROVED_ENTROPY_SCHEMA_VERSION,
      sessionReference,
      source: 'fixture-approved',
    },
    expectedVersion: session.version,
    sessionReference,
    transitionKey: `select-outcome-${label}`,
  });
  return {
    selectedAssetReference: selected.selectedOutcome.providerAssetReference,
    sessionId: sessionReference,
  };
}

class LostResponseFixtureProvider extends FlipAcquisitionProvider {
  readonly #delegate = new DeterministicFlipAcquisitionFixtureProvider();
  #responseLost = false;
  purchaseExecutions = 0;

  async execute(request: FlipAcquisitionProviderRequest): Promise<FlipAcquisitionProviderResult> {
    const result = await this.#delegate.execute(request);
    if (request.kind === 'purchase') {
      this.purchaseExecutions += 1;
      if (!this.#responseLost) {
        this.#responseLost = true;
        throw new FlipAcquisitionAmbiguousError(
          'PROVIDER_RESPONSE_AMBIGUOUS',
          result.providerReference,
        );
      }
    }
    return result;
  }

  async reconcile(
    _request: FlipAcquisitionProviderRequest,
    _knownProviderReference: string | null,
  ): Promise<FlipAcquisitionProviderResult | null> {
    return null;
  }
}

class DatabaseTestProvider extends FlipAcquisitionProvider {
  readonly #ambiguousOnce: 'purchase' | 'transfer' | undefined;
  readonly #executions: FlipAcquisitionProviderRequest[] = [];
  readonly #failKind: 'purchase' | 'transfer' | undefined;
  readonly #failureCode: string | undefined;
  readonly #results = new Map<string, FlipAcquisitionProviderResult>();
  #ambiguousThrown = false;

  constructor(options?: {
    ambiguousOnce?: 'purchase' | 'transfer';
    failKind?: 'purchase' | 'transfer';
    failureCode?: string;
  }) {
    super();
    this.#ambiguousOnce = options?.ambiguousOnce;
    this.#failKind = options?.failKind;
    this.#failureCode = options?.failureCode;
  }

  get executionCount(): number {
    return this.#executions.length;
  }

  executionsFor(kind: 'purchase' | 'transfer'): number {
    return this.#executions.filter((request) => request.kind === kind).length;
  }

  async execute(request: FlipAcquisitionProviderRequest): Promise<FlipAcquisitionProviderResult> {
    const existing = this.#results.get(request.providerRequestKey);
    if (existing) return existing;
    this.#executions.push(request);
    if (request.kind === this.#failKind && this.#failureCode) {
      throw new FlipAcquisitionDefinitelyNotAppliedError(this.#failureCode);
    }
    const providerReference = `fixture-provider:${hash(request.providerRequestKey).slice(0, 40)}`;
    const result = {
      evidence: {
        providerRequestKey: request.providerRequestKey,
        schemaVersion: FLIP_ACQUISITION_PROVIDER_FIXTURE_VERSION,
      },
      finalized: true as const,
      providerReference,
      resultHash: hash(`${request.requestHash}:${providerReference}`),
    };
    this.#results.set(request.providerRequestKey, result);
    if (request.kind === this.#ambiguousOnce && !this.#ambiguousThrown) {
      this.#ambiguousThrown = true;
      throw new FlipAcquisitionAmbiguousError('PROVIDER_RESPONSE_AMBIGUOUS', providerReference);
    }
    return result;
  }

  async reconcile(
    request: FlipAcquisitionProviderRequest,
    _knownProviderReference: string | null,
  ): Promise<FlipAcquisitionProviderResult | null> {
    return this.#results.get(request.providerRequestKey) ?? null;
  }
}

function snapshotPolicy(poolKey: string, policyVersion: string): FlipInventorySnapshotPolicy {
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
  now(): Date {
    return new Date('2026-08-03T12:03:00.000Z');
  }
}
