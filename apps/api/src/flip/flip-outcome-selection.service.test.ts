import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { DatabaseClient } from '@dailydraft/db';
import {
  FLIP_APPROVED_ENTROPY_SCHEMA_VERSION,
  type FlipApprovedEntropyInput,
  FlipOutcomeSelectionService,
  FlipSelectionError,
  flipBandForRoll,
  selectFlipOutcomeReproducibly,
  verifyFlipSelectionAuditProof,
} from './flip-outcome-selection.service.js';
import { createFixtureFlipRuleSet } from './flip-rules.service.js';
import type {
  FLIP_SELECTION_FIXTURE_VERSION,
  FlipSessionSnapshot,
  FlipSessionStateService,
} from './flip-session-state.service.js';

const SESSION = 'flip-selection-unit-session';
const COMMITTED_AT = new Date('2026-08-03T12:02:00.000Z');
const RULES = createFixtureFlipRuleSet();
const OUTCOMES = Object.freeze([
  outcome(0, 'base', '10000000'),
  outcome(1, 'base', '20000000'),
  outcome(2, 'plus', '30000000'),
  outcome(3, 'plus', '40000000'),
  outcome(4, 'chase', '60000000'),
]);
const COMMITTED = Object.freeze({
  committedAt: COMMITTED_AT,
  outcomeSpace: OUTCOMES,
  poolCommitmentHash: hash('selection-pool'),
  rules: RULES,
  rulesHash: RULES.rulesHash,
  sessionReference: SESSION,
  snapshotContentHash: hash('selection-snapshot'),
});

describe('deterministic Flip outcome selection', () => {
  test.each([
    { band: 'base', ordinal: 0, payload: 'vector-0' },
    { band: 'plus', ordinal: 2, payload: 'vector-9' },
    { band: 'chase', ordinal: 4, payload: 'vector-6' },
  ])('reproduces the committed $band fixture vector', ({ band, ordinal, payload }) => {
    const first = selectFlipOutcomeReproducibly(COMMITTED, entropy(payload));
    const replay = selectFlipOutcomeReproducibly(COMMITTED, entropy(payload));
    const expected = OUTCOMES.find((candidate) => candidate.ordinal === ordinal);
    expect(expected).toBeDefined();
    if (!expected) throw new Error('Fixture vector has no committed outcome');

    expect(replay).toEqual(first);
    expect(first.selectedOutcome).toEqual(expected);
    expect(first.proof).toMatchObject({
      selectedBandLabel: band,
      selectedOrdinal: ordinal,
      sessionReference: SESSION,
    });
    expect(JSON.stringify(first.proof)).not.toContain(payload);
    expect(JSON.stringify(first.proof)).not.toContain('providerAssetReference');
    expect(JSON.stringify(first.proof)).not.toContain('providerListingReference');
    expect(
      verifyFlipSelectionAuditProof({
        approvedEntropy: entropy(payload),
        committed: COMMITTED,
        proof: first.proof,
      }),
    ).toEqual(first.selectedOutcome);
  });

  test('maps every exact PPM boundary to the reviewed band', () => {
    expect(flipBandForRoll(RULES.bands, 0).label).toBe('base');
    expect(flipBandForRoll(RULES.bands, 699_999).label).toBe('base');
    expect(flipBandForRoll(RULES.bands, 700_000).label).toBe('plus');
    expect(flipBandForRoll(RULES.bands, 949_999).label).toBe('plus');
    expect(flipBandForRoll(RULES.bands, 950_000).label).toBe('chase');
    expect(flipBandForRoll(RULES.bands, 999_999).label).toBe('chase');
    expectSelectionError(() => flipBandForRoll(RULES.bands, -1), 'INVALID_PROOF');
    expectSelectionError(() => flipBandForRoll(RULES.bands, 1_000_000), 'INVALID_PROOF');
  });

  test('property: every selected asset belongs to the immutable committed pool and band', () => {
    const committedOrdinals = new Set(OUTCOMES.map(({ ordinal }) => ordinal));
    for (let index = 0; index < 1_000; index += 1) {
      const selected = selectFlipOutcomeReproducibly(COMMITTED, entropy(`property-${index}`));
      expect(committedOrdinals.has(selected.selectedOutcome.ordinal)).toBe(true);
      expect(selected.selectedOutcome.bandLabel).toBe(selected.proof.selectedBandLabel);
      expect(selected.selectedOutcome.ordinal).toBe(selected.proof.selectedOrdinal);
    }
  });

  test('does not read excluded or post-commit inventory candidates', () => {
    const selected = selectFlipOutcomeReproducibly(COMMITTED, entropy('exclusion-vector'));
    expect(
      OUTCOMES.some((candidate) => candidate.ordinal === selected.selectedOutcome.ordinal),
    ).toBe(true);
    expect(selected.selectedOutcome.providerAssetReference).not.toBe('asset_excluded');
    expect(selected.selectedOutcome.providerListingReference).not.toBe('listing_post_commit');
  });

  test('rejects missing-band pools, duplicate outcomes, and unsupported outcome payloads', () => {
    const cases = [
      { ...COMMITTED, outcomeSpace: OUTCOMES.filter(({ bandLabel }) => bandLabel !== 'chase') },
      { ...COMMITTED, outcomeSpace: [...OUTCOMES, OUTCOMES[0]] },
      {
        ...COMMITTED,
        outcomeSpace: OUTCOMES.map((candidate, index) =>
          index === 0 ? { ...candidate, providerPayload: { secret: true } } : candidate,
        ),
      },
    ];
    for (const candidate of cases) {
      expectSelectionError(
        () => selectFlipOutcomeReproducibly(candidate, entropy('invalid-pool')),
        'INVALID_PROOF',
      );
    }
  });

  test('rejects entropy before commitment and malformed approval envelopes', () => {
    expectSelectionError(
      () =>
        selectFlipOutcomeReproducibly(COMMITTED, {
          ...entropy('too-early'),
          approvedAt: '2026-08-03T12:01:59.999Z',
        }),
      'INVALID_ENTROPY',
    );
    for (const candidate of [
      { ...entropy('bad-source'), source: 'provider-live' },
      { ...entropy('bad-session'), sessionReference: 'other-session' },
      { ...entropy('bad-reference'), reference: 'live-entropy' },
      { ...entropy('bad-payload'), payload: ' line-break\n' },
      { ...entropy('bad-extra'), unsupported: true },
    ]) {
      expectSelectionError(
        () => selectFlipOutcomeReproducibly(COMMITTED, candidate as FlipApprovedEntropyInput),
        'INVALID_ENTROPY',
      );
    }
  });

  test('rejects every audit proof tamper independently', () => {
    const approvedEntropy = entropy('proof-tamper');
    const selected = selectFlipOutcomeReproducibly(COMMITTED, approvedEntropy);
    for (const proof of [
      { ...selected.proof, rollPpm: (selected.proof.rollPpm + 1) % 1_000_000 },
      {
        ...selected.proof,
        selectedOrdinal: (selected.proof.selectedOrdinal + 1) % OUTCOMES.length,
      },
      { ...selected.proof, entropyHash: '0'.repeat(64) },
      { ...selected.proof, resultHash: 'f'.repeat(64) },
    ]) {
      expectSelectionError(
        () => verifyFlipSelectionAuditProof({ approvedEntropy, committed: COMMITTED, proof }),
        'INVALID_PROOF',
      );
    }
  });
});

describe('fixture-only deterministic Flip selection persistence', () => {
  test('prepares, binds, finalizes, and replays one redacted proof', async () => {
    const fixture = serviceHarness();
    const request = {
      approvedEntropy: entropy('private-entropy-payload-987'),
      expectedVersion: 3,
      sessionReference: SESSION,
      transitionKey: 'selection-service-happy',
    };

    const first = await fixture.service.selectFixtureOutcome(request);
    const replay = await fixture.service.selectFixtureOutcome(request);

    expect(replay).toEqual(first);
    expect(fixture.createdProofs).toBe(1);
    expect(fixture.proof).toMatchObject({
      entropyHash: first.proof.entropyHash,
      finalizedAt: expect.any(Date),
      id: `fixture-selection-proof:${first.proof.resultHash.slice(0, 48)}`,
      terminalTransitionId: 'selection-transition-1',
    });
    expect(JSON.stringify(fixture.proof)).not.toContain(request.approvedEntropy.payload);
    expect(fixture.transitionCalls).toBe(2);
  });

  test('rejects a changed entropy replay before another state transition', async () => {
    const fixture = serviceHarness();
    const request = {
      approvedEntropy: entropy('service-original'),
      expectedVersion: 3,
      sessionReference: SESSION,
      transitionKey: 'selection-service-replay',
    };
    await fixture.service.selectFixtureOutcome(request);

    await expect(
      fixture.service.selectFixtureOutcome({
        ...request,
        approvedEntropy: entropy('service-changed'),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
    expect(fixture.transitionCalls).toBe(1);
  });

  test('fails closed outside fixture mode and for a non-committed session', async () => {
    await expect(
      serviceHarness({ environment: { NODE_ENV: 'production' } }).service.selectFixtureOutcome({
        approvedEntropy: entropy('disabled'),
        expectedVersion: 3,
        sessionReference: SESSION,
        transitionKey: 'selection-service-disabled',
      }),
    ).rejects.toMatchObject({ code: 'DISABLED' });
    await expect(
      serviceHarness({ status: 'STAKE_CONFIRMED' }).service.selectFixtureOutcome({
        approvedEntropy: entropy('invalid-state'),
        expectedVersion: 3,
        sessionReference: SESSION,
        transitionKey: 'selection-service-invalid-state',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  test('migration binds prepared proofs to exact append-only selection transitions', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/prisma/migrations/20260728230000_flip_deterministic_selection/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration).toContain('"FlipOutcomeSelectionProof_fixture_contract_check"');
    expect(migration).toContain('"selectedBandOutcomeIndex"');
    expect(migration).toContain('"FlipSessionTransition_selection_proof_contract"');
    expect(migration).toContain('does not match its prepared audit proof');
    expect(migration).toContain('"FlipOutcomeSelectionProof_append_only"');
  });
});

function entropy(payload: string): FlipApprovedEntropyInput {
  return {
    approvedAt: '2026-08-03T12:03:00.000Z',
    payload,
    reference: 'fixture-entropy:unit-approved',
    schemaVersion: FLIP_APPROVED_ENTROPY_SCHEMA_VERSION,
    sessionReference: SESSION,
    source: 'fixture-approved',
  };
}

function outcome(ordinal: number, bandLabel: string, listingValueAmount: string) {
  return Object.freeze({
    bandLabel,
    listingValueAmount,
    ordinal,
    providerAssetReference: `asset_${bandLabel}_${ordinal}`,
    providerListingReference: `listing_${bandLabel}_${ordinal}`,
  });
}

function hash(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function expectSelectionError(operation: () => unknown, code: FlipSelectionError['code']): void {
  try {
    operation();
    throw new Error('Expected FlipSelectionError');
  } catch (error) {
    expect(error).toBeInstanceOf(FlipSelectionError);
    expect((error as FlipSelectionError).code).toBe(code);
  }
}

function serviceHarness(options: { environment?: NodeJS.ProcessEnv; status?: string } = {}) {
  let proof: Record<string, unknown> | null = null;
  let transition: Record<string, unknown> | null = null;
  let selectedSession: FlipSessionSnapshot | null = null;
  let createdProofs = 0;
  let transitionCalls = 0;
  const ruleset = {
    ...RULES,
    reviewedAt: new Date(RULES.reviewedAt),
  };
  const commitment = {
    committedAt: COMMITTED_AT,
    id: 'selection-commitment-1',
    outcomeSpace: OUTCOMES,
    poolCommitmentHash: COMMITTED.poolCommitmentHash,
    rulesHash: COMMITTED.rulesHash,
    ruleset,
    snapshotContentHash: COMMITTED.snapshotContentHash,
  };
  const database = {
    flipOutcomeSelectionProof: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdProofs += 1;
        proof = {
          ...data,
          createdAt: new Date('2026-08-03T12:03:00.000Z'),
          finalizedAt: null,
          terminalTransitionId: null,
        };
        return proof;
      },
      findUnique: async () => proof,
      findUniqueOrThrow: async () => {
        if (!proof) throw new Error('missing proof');
        return proof;
      },
      updateMany: async ({
        data,
      }: {
        data: { finalizedAt: Date; terminalTransitionId: string };
      }) => {
        if (!proof || proof.terminalTransitionId !== null) return { count: 0 };
        proof = { ...proof, ...data };
        return { count: 1 };
      },
    },
    flipSession: {
      findUnique: async () => ({
        id: SESSION,
        poolCommitment: commitment,
        status: options.status ?? 'POOL_COMMITTED',
      }),
    },
    flipSessionTransition: {
      findUnique: async () => transition,
    },
  };
  const sessions = {
    findSession: async () => {
      if (!selectedSession) throw new Error('missing selected session');
      return selectedSession;
    },
    transition: async (
      _sessionReference: string,
      action: {
        evidence: {
          bandLabel: string;
          listingValueAmount: string;
          ordinal: number;
          providerAssetReference: string;
          providerListingReference: string;
          reference: string;
          resultHash: string;
          schemaVersion: typeof FLIP_SELECTION_FIXTURE_VERSION;
        };
        transitionKey: string;
      },
    ) => {
      transitionCalls += 1;
      transition = {
        evidence: action.evidence,
        id: 'selection-transition-1',
        kind: 'SELECTION_RECORDED',
        transitionKey: action.transitionKey,
      };
      selectedSession ??= selectedSessionSnapshot(action.evidence);
      return selectedSession;
    },
  };
  const harness = {
    get createdProofs() {
      return createdProofs;
    },
    get proof() {
      return proof;
    },
    service: new FlipOutcomeSelectionService(
      database as unknown as DatabaseClient,
      sessions as unknown as FlipSessionStateService,
      options.environment ?? {
        DAILYDRAFT_FLIP_FIXTURE_MODE: 'true',
        NODE_ENV: 'test',
      },
    ),
    get transitionCalls() {
      return transitionCalls;
    },
  };
  return harness;
}

function selectedSessionSnapshot(selectedOutcome: {
  bandLabel: string;
  listingValueAmount: string;
  ordinal: number;
  providerAssetReference: string;
  providerListingReference: string;
}): FlipSessionSnapshot {
  return {
    id: SESSION,
    playerWalletReference: 'fixture-wallet:selection-player',
    poolCommitment: {
      id: 'selection-commitment-1',
      poolCommitmentHash: COMMITTED.poolCommitmentHash,
      rulesHash: COMMITTED.rulesHash,
      snapshotContentHash: COMMITTED.snapshotContentHash,
    },
    purchaseReference: null,
    purchasedAt: null,
    revealReadyAt: null,
    revealReadyReference: null,
    selectedOutcome,
    stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
    stateMachineVersion: 'dailydraft.flip-session-state.v1',
    status: 'selection-recorded',
    terminalAt: null,
    terminalReason: null,
    transferReference: null,
    transferredAt: null,
    transitions: [],
    version: 4,
  };
}
