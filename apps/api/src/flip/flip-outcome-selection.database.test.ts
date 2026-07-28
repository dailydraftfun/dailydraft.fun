import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDatabaseClient, type DatabaseClient } from '@dailydraft/db';

import type { Money } from '../domain.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  type FlipInventoryCandidate,
  type FlipInventorySnapshotPolicy,
  FlipInventorySnapshotService,
} from './flip-inventory-snapshot.service.js';
import {
  FLIP_APPROVED_ENTROPY_SCHEMA_VERSION,
  type FlipApprovedEntropyInput,
  FlipOutcomeSelectionService,
  type FlipSelectionAuditProof,
  selectFlipOutcomeReproducibly,
} from './flip-outcome-selection.service.js';
import {
  createFixtureFlipRuleSet,
  type FlipEligibleOutcome,
  FlipRulesService,
} from './flip-rules.service.js';
import {
  FLIP_PURCHASE_FIXTURE_VERSION,
  FLIP_RECOVERY_FIXTURE_VERSION,
  FLIP_SELECTION_FIXTURE_VERSION,
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

describeDatabase('deterministic Flip selection against two real Postgres connections', () => {
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

  test('collapses concurrent deterministic selection into one proof and transition', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'concurrent');
    const serviceA = selectionService(databaseA);
    const serviceB = selectionService(databaseB);
    const approvedEntropy = entropy(fixture.session.id, 'concurrent');
    const request = {
      approvedEntropy,
      expectedVersion: fixture.session.version,
      sessionReference: fixture.session.id,
      transitionKey: 'deterministic-selection-concurrent',
    };

    const [left, right] = await Promise.all([
      serviceA.selectFixtureOutcome(request),
      serviceB.selectFixtureOutcome(request),
    ]);

    expect(right).toEqual(left);
    expect(
      await databaseA.flipOutcomeSelectionProof.count({
        where: { sessionId: fixture.session.id },
      }),
    ).toBe(1);
    expect(
      await databaseA.flipSessionTransition.count({
        where: { kind: 'SELECTION_RECORDED', sessionId: fixture.session.id },
      }),
    ).toBe(1);
    const proof = await databaseA.flipOutcomeSelectionProof.findUniqueOrThrow({
      where: { sessionId: fixture.session.id },
    });
    expect(proof).toMatchObject({
      entropyHash: left.proof.entropyHash,
      finalizedAt: expect.any(Date),
      resultHash: left.proof.resultHash,
      selectedOrdinal: left.selectedOutcome.ordinal,
      terminalTransitionId: expect.any(String),
    });
    expect(JSON.stringify(proof)).not.toContain(approvedEntropy.payload);
  });

  test('recovers a lost response after service restart without another selection', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'restart');
    const request = {
      approvedEntropy: entropy(fixture.session.id, 'restart'),
      expectedVersion: fixture.session.version,
      sessionReference: fixture.session.id,
      transitionKey: 'deterministic-selection-restart',
    };
    const first = await selectionService(databaseA).selectFixtureOutcome(request);
    const replay = await selectionService(databaseB).selectFixtureOutcome(request);

    expect(replay).toEqual(first);
    expect(
      await databaseA.flipOutcomeSelectionProof.count({
        where: { sessionId: fixture.session.id },
      }),
    ).toBe(1);
    expect(
      await databaseA.flipSessionTransition.count({
        where: { kind: 'SELECTION_RECORDED', sessionId: fixture.session.id },
      }),
    ).toBe(1);
  });

  test('rejects changed entropy replay and database proof tampering', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'tamper');
    const service = selectionService(databaseA);
    const request = {
      approvedEntropy: entropy(fixture.session.id, 'tamper'),
      expectedVersion: fixture.session.version,
      sessionReference: fixture.session.id,
      transitionKey: 'deterministic-selection-tamper',
    };
    await service.selectFixtureOutcome(request);

    await expect(
      service.selectFixtureOutcome({
        ...request,
        approvedEntropy: { ...request.approvedEntropy, payload: 'changed-entropy' },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
    const proof = await databaseA.flipOutcomeSelectionProof.findUniqueOrThrow({
      where: { sessionId: fixture.session.id },
    });
    await expect(
      Promise.resolve(
        databaseA.flipOutcomeSelectionProof.update({
          data: { entropyHash: '0'.repeat(64) },
          where: { id: proof.id },
        }),
      ),
    ).rejects.toThrow('Flip deterministic selection proof is immutable or terminal');
    await expect(
      Promise.resolve(databaseA.flipOutcomeSelectionProof.delete({ where: { id: proof.id } })),
    ).rejects.toThrow('Flip deterministic selection proof is append-only');
  });

  test('rejects stale versions and reused ledger keys without leaving a prepared proof', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'non-poisoning-boundary');
    const service = selectionService(databaseA);
    const request = {
      approvedEntropy: entropy(fixture.session.id, 'non-poisoning-boundary'),
      expectedVersion: fixture.session.version,
      sessionReference: fixture.session.id,
      transitionKey: 'deterministic-selection-corrected',
    };

    await expect(
      service.selectFixtureOutcome({
        ...request,
        expectedVersion: fixture.session.version - 1,
        transitionKey: 'deterministic-selection-stale',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(
      service.selectFixtureOutcome({
        ...request,
        transitionKey: 'commit-pool-non-poisoning-boundary',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
    expect(
      await databaseA.flipOutcomeSelectionProof.count({
        where: { sessionId: fixture.session.id },
      }),
    ).toBe(0);

    await expect(service.selectFixtureOutcome(request)).resolves.toMatchObject({
      session: { status: 'selection-recorded' },
    });
  });

  test('blocks post-selection lifecycle until crash recovery finalizes the exact proof', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'finalization-gate');
    const approvedEntropy = entropy(fixture.session.id, 'finalization-gate');
    const request = {
      approvedEntropy,
      expectedVersion: fixture.session.version,
      sessionReference: fixture.session.id,
      transitionKey: 'deterministic-selection-finalization-gate',
    };
    const computed = selectFlipOutcomeReproducibly(committedSelection(fixture), approvedEntropy);
    const proofId = `fixture-selection-proof:${computed.proof.resultHash.slice(0, 48)}`;
    await databaseA.flipOutcomeSelectionProof.create({
      data: proofCreateData(fixture, computed.proof, request),
    });
    const state = new FlipSessionStateService(
      databaseA,
      new DatabaseTestClock(),
      FIXTURE_ENVIRONMENT,
    );
    await expect(
      state.transition(fixture.session.id, {
        evidence: {
          reasonCode: 'FIXTURE_RECOVERY',
          reference: 'fixture-recovery:prepared-proof',
          schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
          status: 'fixture-recovery-required',
        },
        expectedVersion: fixture.session.version,
        kind: 'request-recovery',
        transitionKey: 'recovery-with-prepared-selection',
      }),
    ).rejects.toThrow('prepared selection requires its finalized audit proof');
    const selected = await state.transition(fixture.session.id, {
      evidence: {
        ...computed.selectedOutcome,
        reference: proofId,
        resultHash: computed.proof.resultHash,
        schemaVersion: FLIP_SELECTION_FIXTURE_VERSION,
      },
      expectedVersion: fixture.session.version,
      kind: 'record-selection',
      transitionKey: request.transitionKey,
    });
    const purchase = {
      evidence: {
        amount: usdc(computed.selectedOutcome.listingValueAmount),
        provider: 'fixture-marketplace' as const,
        providerAssetReference: computed.selectedOutcome.providerAssetReference,
        providerListingReference: computed.selectedOutcome.providerListingReference,
        reference: 'fixture-purchase:finalization-gate',
        schemaVersion: FLIP_PURCHASE_FIXTURE_VERSION,
        status: 'fixture-acquired' as const,
      },
      expectedVersion: selected.version,
      kind: 'record-purchase' as const,
      transitionKey: 'purchase-finalization-gate',
    };

    await expect(state.transition(selected.id, purchase)).rejects.toThrow(
      'prepared selection requires its finalized audit proof',
    );
    const recovered = await selectionService(databaseB).selectFixtureOutcome(request);
    expect(recovered.session.status).toBe('selection-recorded');
    await expect(state.transition(selected.id, purchase)).resolves.toMatchObject({
      status: 'purchase-recorded',
    });
  });

  test('rejects a forged within-band index and a transition without its prepared proof', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'invalid-proof-binding');
    let approvedEntropy = entropy(fixture.session.id, 'invalid-proof-index-0');
    let computed = selectFlipOutcomeReproducibly(
      {
        committedAt: fixture.commitment.committedAt,
        outcomeSpace: fixture.commitment.outcomeSpace,
        poolCommitmentHash: fixture.commitment.poolCommitmentHash,
        rules: fixture.rules,
        rulesHash: fixture.commitment.rulesHash,
        sessionReference: fixture.session.id,
        snapshotContentHash: fixture.commitment.snapshotContentHash,
      },
      approvedEntropy,
    );
    for (let index = 1; computed.proof.selectedBandOutcomeCount < 2; index += 1) {
      approvedEntropy = entropy(fixture.session.id, `invalid-proof-index-${index}`);
      computed = selectFlipOutcomeReproducibly(
        {
          committedAt: fixture.commitment.committedAt,
          outcomeSpace: fixture.commitment.outcomeSpace,
          poolCommitmentHash: fixture.commitment.poolCommitmentHash,
          rules: fixture.rules,
          rulesHash: fixture.commitment.rulesHash,
          sessionReference: fixture.session.id,
          snapshotContentHash: fixture.commitment.snapshotContentHash,
        },
        approvedEntropy,
      );
    }
    await expect(
      Promise.resolve(
        databaseA.flipOutcomeSelectionProof.create({
          data: {
            algorithmVersion: computed.proof.algorithmVersion,
            entropyApprovedAt: new Date(computed.proof.entropyApprovedAt),
            entropyHash: computed.proof.entropyHash,
            entropyReference: computed.proof.entropyReference,
            entropySchemaVersion: computed.proof.entropySchemaVersion,
            entropySource: computed.proof.entropySource,
            id: `fixture-selection-proof:${computed.proof.resultHash.slice(0, 48)}`,
            poolCommitmentHash: computed.proof.poolCommitmentHash,
            poolCommitmentId: fixture.commitment.id,
            requestHash: hash('forged-within-band-index-request'),
            resultHash: computed.proof.resultHash,
            rollPpm: computed.proof.rollPpm,
            rulesHash: computed.proof.rulesHash,
            schemaVersion: computed.proof.schemaVersion,
            selectedBandLabel: computed.proof.selectedBandLabel,
            selectedBandOutcomeCount: computed.proof.selectedBandOutcomeCount,
            selectedBandOutcomeIndex:
              (computed.proof.selectedBandOutcomeIndex + 1) %
              computed.proof.selectedBandOutcomeCount,
            selectedOrdinal: computed.proof.selectedOrdinal,
            sessionId: fixture.session.id,
            snapshotContentHash: computed.proof.snapshotContentHash,
            transitionKey: 'forged-within-band-index',
          },
        }),
      ),
    ).rejects.toThrow('does not match canonical deterministic derivation');

    const selectedOutcome = (
      fixture.commitment.outcomeSpace as unknown as FlipEligibleOutcome[]
    )[0];
    if (!selectedOutcome) throw new Error('Committed fixture has no selectable outcome');
    await expect(
      new FlipSessionStateService(
        databaseA,
        new DatabaseTestClock(),
        FIXTURE_ENVIRONMENT,
      ).transition(fixture.session.id, {
        evidence: {
          ...selectedOutcome,
          reference: `fixture-selection-proof:${'a'.repeat(48)}`,
          resultHash: hash('unprepared-selection-transition'),
          schemaVersion: FLIP_SELECTION_FIXTURE_VERSION,
        },
        expectedVersion: fixture.session.version,
        kind: 'record-selection',
        transitionKey: 'selection-without-prepared-proof',
      }),
    ).rejects.toThrow('does not match its prepared audit proof');
  });

  test('database rejects a canonically hashed proof that forges another eligible outcome', async () => {
    const fixture = await prepareDatabaseFixture(databaseA, 'forged-canonical-outcome');
    const approvedEntropy = entropy(fixture.session.id, 'forged-canonical-outcome');
    const computed = selectFlipOutcomeReproducibly(committedSelection(fixture), approvedEntropy);
    const outcomes = fixture.commitment.outcomeSpace as unknown as FlipEligibleOutcome[];
    const forgedOutcome = outcomes.find(
      (candidate) => candidate.ordinal !== computed.selectedOutcome.ordinal,
    );
    if (!forgedOutcome) throw new Error('Committed fixture needs another forge candidate');
    const bandOutcomes = outcomes.filter(
      (candidate) => candidate.bandLabel === forgedOutcome.bandLabel,
    );
    const unsignedForgery = {
      ...computed.proof,
      selectedBandLabel: forgedOutcome.bandLabel,
      selectedBandOutcomeCount: bandOutcomes.length,
      selectedBandOutcomeIndex: bandOutcomes.findIndex(
        (candidate) => candidate.ordinal === forgedOutcome.ordinal,
      ),
      selectedOrdinal: forgedOutcome.ordinal,
    };
    const { resultHash: _canonicalResultHash, ...unsignedProof } = unsignedForgery;
    const forgedProof = {
      ...unsignedProof,
      resultHash: hash(stableStringify(unsignedProof)),
    } satisfies FlipSelectionAuditProof;
    const request = {
      approvedEntropy,
      expectedVersion: fixture.session.version,
      sessionReference: fixture.session.id,
      transitionKey: 'forged-canonical-outcome',
    };

    await expect(
      Promise.resolve(
        databaseA.flipOutcomeSelectionProof.create({
          data: proofCreateData(fixture, forgedProof, request),
        }),
      ),
    ).rejects.toThrow('does not match canonical deterministic derivation');
    expect(
      await databaseA.flipOutcomeSelectionProof.count({
        where: { sessionId: fixture.session.id },
      }),
    ).toBe(0);
  });
});

function selectionService(database: DatabaseClient): FlipOutcomeSelectionService {
  return new FlipOutcomeSelectionService(
    database,
    new FlipSessionStateService(database, new DatabaseTestClock(), FIXTURE_ENVIRONMENT),
    FIXTURE_ENVIRONMENT,
  );
}

async function prepareDatabaseFixture(database: DatabaseClient, label: string) {
  const suffix = `${label}-${crypto.randomUUID().replaceAll('-', '')}`;
  const sessionReference = `dbtest-flip-selection-${suffix}`;
  const poolKey = `dbtest-flip-selection-pool-${suffix}`;
  const policyVersion = `dbtest-flip-selection-policy-${suffix}`;
  const rulesKey = `dbtest-flip-selection-rules-${suffix}`;
  const inventory = new FlipInventorySnapshotService(database);
  const snapshot = await inventory.createFixtureSnapshot({
    candidates: [
      candidate('base-secondary', '15000000'),
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
  const storedCommitment = await database.flipSessionPoolCommitment.findUniqueOrThrow({
    where: { id: commitment.id },
  });
  const state = new FlipSessionStateService(database, new DatabaseTestClock(), FIXTURE_ENVIRONMENT);
  let session = await state.createFixtureSession({
    playerWalletReference: 'fixture-wallet:selection-player',
    sessionReference,
  });
  session = await state.transition(session.id, {
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
  session = await state.transition(session.id, {
    evidence: { poolCommitmentId: commitment.id },
    expectedVersion: session.version,
    kind: 'commit-pool',
    transitionKey: `commit-pool-${label}`,
  });
  return { commitment: storedCommitment, rules, session };
}

type SelectionDatabaseFixture = Awaited<ReturnType<typeof prepareDatabaseFixture>>;

function committedSelection(fixture: SelectionDatabaseFixture) {
  return {
    committedAt: fixture.commitment.committedAt,
    outcomeSpace: fixture.commitment.outcomeSpace,
    poolCommitmentHash: fixture.commitment.poolCommitmentHash,
    rules: fixture.rules,
    rulesHash: fixture.commitment.rulesHash,
    sessionReference: fixture.session.id,
    snapshotContentHash: fixture.commitment.snapshotContentHash,
  };
}

function proofCreateData(
  fixture: SelectionDatabaseFixture,
  proof: FlipSelectionAuditProof,
  request: {
    expectedVersion: number;
    sessionReference: string;
    transitionKey: string;
  },
) {
  return {
    algorithmVersion: proof.algorithmVersion,
    entropyApprovedAt: new Date(proof.entropyApprovedAt),
    entropyHash: proof.entropyHash,
    entropyReference: proof.entropyReference,
    entropySchemaVersion: proof.entropySchemaVersion,
    entropySource: proof.entropySource,
    id: `fixture-selection-proof:${proof.resultHash.slice(0, 48)}`,
    poolCommitmentHash: proof.poolCommitmentHash,
    poolCommitmentId: fixture.commitment.id,
    requestHash: hash(
      stableStringify({
        entropyHash: proof.entropyHash,
        expectedVersion: request.expectedVersion,
        proofResultHash: proof.resultHash,
        sessionReference: request.sessionReference,
        transitionKey: request.transitionKey,
      }),
    ),
    resultHash: proof.resultHash,
    rollPpm: proof.rollPpm,
    rulesHash: proof.rulesHash,
    schemaVersion: proof.schemaVersion,
    selectedBandLabel: proof.selectedBandLabel,
    selectedBandOutcomeCount: proof.selectedBandOutcomeCount,
    selectedBandOutcomeIndex: proof.selectedBandOutcomeIndex,
    selectedOrdinal: proof.selectedOrdinal,
    sessionId: request.sessionReference,
    snapshotContentHash: proof.snapshotContentHash,
    transitionKey: request.transitionKey,
  };
}

function entropy(sessionReference: string, label: string): FlipApprovedEntropyInput {
  return {
    approvedAt: '2026-08-03T12:03:00.000Z',
    payload: `approved-entropy-${label}`,
    reference: `fixture-entropy:${label}`,
    schemaVersion: FLIP_APPROVED_ENTROPY_SCHEMA_VERSION,
    sessionReference,
    source: 'fixture-approved',
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
  now(): Date {
    return new Date('2026-08-03T12:03:00.000Z');
  }
}
