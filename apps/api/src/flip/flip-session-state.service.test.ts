import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { DatabaseClient, FlipSessionStatus, FlipSessionTransitionKind } from '@dailydraft/db';

import type { Money } from '../domain.js';
import {
  FLIP_PURCHASE_FIXTURE_VERSION,
  FLIP_RECOVERY_FIXTURE_VERSION,
  FLIP_REVEAL_READY_FIXTURE_VERSION,
  FLIP_SELECTION_FIXTURE_VERSION,
  FLIP_SESSION_STATE_MACHINE_VERSION,
  FLIP_SETTLEMENT_FIXTURE_VERSION,
  FLIP_STAKE_FIXTURE_VERSION,
  FLIP_TRANSFER_FIXTURE_VERSION,
  type FlipSessionAction,
  FlipSessionStateService,
  flipSessionStateCapability,
} from './flip-session-state.service.js';

const FIXTURE_ENVIRONMENT = {
  DAILYDRAFT_FLIP_FIXTURE_MODE: 'true',
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;
const START = new Date('2026-07-28T16:00:00.000Z');
const PLAYER = 'fixture-wallet:flip-player';

describe('durable fixture-only Flip session state machine', () => {
  test('resumes at every non-terminal lifecycle boundary and settles exactly once', async () => {
    const fixture = harness('flip-session-resume');
    let session = await fixture.create();

    expect(session).toMatchObject({
      id: fixture.sessionId,
      playerWalletReference: PLAYER,
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
      status: 'awaiting-stake',
      version: 1,
    });
    expect(session.transitions.map(({ kind }) => kind)).toEqual(['session-started']);
    await expect(fixture.restart().findSession(session.id)).resolves.toEqual(session);

    for (const action of lifecycleActions(fixture)) {
      fixture.clock.advance(1_000);
      session = await fixture.restart().transition(session.id, {
        ...action,
        expectedVersion: session.version,
      } as FlipSessionAction);
      await expect(fixture.restart().findSession(session.id)).resolves.toEqual(session);
    }

    expect(session).toMatchObject({
      poolCommitment: {
        id: fixture.commitment.id,
        poolCommitmentHash: fixture.commitment.poolCommitmentHash,
        rulesHash: fixture.commitment.rulesHash,
        snapshotContentHash: fixture.commitment.snapshotContentHash,
      },
      purchaseReference: 'fixture-purchase:resume',
      revealReadyReference: 'fixture-reveal:resume',
      selectedOutcome: fixture.commitment.outcomeSpace[1],
      status: 'settled',
      terminalReason: 'FIXTURE_SETTLED',
      transferReference: 'fixture-transfer:resume',
      version: 8,
    });
    expect(session.transitions.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(session.transitions.map(({ kind }) => kind)).toEqual([
      'session-started',
      'stake-confirmed',
      'pool-committed',
      'selection-recorded',
      'purchase-recorded',
      'transfer-recorded',
      'reveal-ready',
      'settled',
    ]);
    expect(session.transitions[4]?.evidence).toMatchObject({
      provider: 'fixture-marketplace',
      schemaVersion: FLIP_PURCHASE_FIXTURE_VERSION,
      status: 'fixture-acquired',
    });

    const settlement = {
      ...settleAction(fixture),
      expectedVersion: 7,
    } satisfies FlipSessionAction;
    await expect(fixture.restart().transition(session.id, settlement)).resolves.toEqual(session);
    expect(fixture.database.transitionCount(session.id)).toBe(8);
  });

  test('collapses concurrent retries and rejects reuse with different evidence', async () => {
    const fixture = harness('flip-session-retry');
    const created = await fixture.create();
    const action = {
      ...stakeAction(),
      expectedVersion: created.version,
    } satisfies FlipSessionAction;

    const [left, right, third] = await Promise.all([
      fixture.service.transition(created.id, action),
      fixture.restart().transition(created.id, action),
      fixture.restart().transition(created.id, action),
    ]);
    expect(left).toEqual(right);
    expect(right).toEqual(third);
    expect(left).toMatchObject({ status: 'stake-confirmed', version: 2 });
    expect(fixture.database.transitionCount(created.id)).toBe(2);

    await expect(
      fixture.service.transition(created.id, {
        ...action,
        evidence: {
          ...action.evidence,
          amount: usdc('49000000'),
        },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  });

  test.each([
    {
      action: (fixture: ReturnType<typeof harness>) => selectionAction(fixture),
      state: 'awaiting-stake',
    },
    {
      action: (fixture: ReturnType<typeof harness>) => purchaseAction(fixture),
      state: 'stake-confirmed',
    },
    {
      action: (fixture: ReturnType<typeof harness>) => transferAction(fixture),
      state: 'pool-committed',
    },
    {
      action: (_fixture: ReturnType<typeof harness>) => revealAction(),
      state: 'selection-recorded',
    },
    {
      action: (fixture: ReturnType<typeof harness>) => settleAction(fixture),
      state: 'purchase-recorded',
    },
  ])('rejects $action.kind from the $state boundary', async ({ action, state }) => {
    const fixture = harness(`flip-invalid-${state}`);
    const session = await fixture.advanceTo(state);
    await expect(
      fixture.service.transition(session.id, {
        ...action(fixture),
        expectedVersion: session.version,
      } as FlipSessionAction),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  test('refuses reveal readiness until the exact acquisition and transfer receipts are durable', async () => {
    const fixture = harness('flip-reveal-guard');
    const transferred = await fixture.advanceTo('transfer-recorded');

    await expect(
      fixture.service.transition(transferred.id, {
        ...revealAction(),
        evidence: {
          ...revealAction().evidence,
          purchaseReference: 'fixture-purchase:different',
        },
        expectedVersion: transferred.version,
      }),
    ).rejects.toThrow(
      'Flip reveal finality requires the durable acquisition and transfer receipts',
    );

    fixture.database.corruptSession(transferred.id, { purchasedAt: null });
    await expect(
      fixture.service.transition(transferred.id, {
        ...revealAction(),
        expectedVersion: transferred.version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
    expect(fixture.database.transitionCount(transferred.id)).toBe(6);
  });

  test.each([
    'awaiting-stake',
    'stake-confirmed',
    'pool-committed',
    'selection-recorded',
    'purchase-recorded',
    'transfer-recorded',
    'reveal-ready',
  ] as const)('durably recovers from the %s state without replaying prior side effects', async (status) => {
    const fixture = harness(`flip-recovery-${status}`);
    const beforeRecovery = await fixture.advanceTo(status);
    const requested = await fixture.restart().transition(beforeRecovery.id, {
      evidence: {
        reasonCode: `FIXTURE_${status.replaceAll('-', '_').toUpperCase()}`,
        reference: `fixture-recovery:request-${status}`,
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovery-required',
      },
      expectedVersion: beforeRecovery.version,
      kind: 'request-recovery',
      transitionKey: `recovery-request-${status}`,
    });
    expect(requested).toMatchObject({
      status: 'recovery-required',
      version: beforeRecovery.version + 1,
    });

    const recovered = await fixture.restart().transition(requested.id, {
      evidence: {
        payout: usdc('50000000'),
        reference: `fixture-recovery:completed-${status}`,
        resultHash: hash(`recovery:${status}`),
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovered',
      },
      expectedVersion: requested.version,
      kind: 'complete-recovery',
      transitionKey: `recovery-complete-${status}`,
    });
    expect(recovered).toMatchObject({
      status: 'recovered',
      terminalReason: 'FIXTURE_RECOVERY_COMPLETED',
      version: beforeRecovery.version + 2,
    });
    await expect(fixture.restart().findSession(recovered.id)).resolves.toEqual(recovered);
  });

  test('records a terminal failure only through the durable recovery boundary', async () => {
    const fixture = harness('flip-terminal-failure');
    const created = await fixture.create();
    await expect(
      fixture.service.transition(created.id, {
        evidence: {
          reasonCode: 'PROVIDER_DOWN',
          reference: 'fixture-recovery:failed',
          schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
          status: 'fixture-failed',
        },
        expectedVersion: created.version,
        kind: 'terminate',
        transitionKey: 'terminate-too-early',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const recovery = await fixture.service.transition(created.id, recoveryAction(created.version));
    const failed = await fixture.restart().transition(recovery.id, {
      evidence: {
        reasonCode: 'PROVIDER_DOWN',
        reference: 'fixture-recovery:failed',
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-failed',
      },
      expectedVersion: recovery.version,
      kind: 'terminate',
      transitionKey: 'terminate-after-recovery',
    });
    expect(failed).toMatchObject({
      status: 'failed',
      terminalReason: 'FIXTURE_TERMINATED:PROVIDER_DOWN',
    });
    expect(failed.transitions.at(-1)).toMatchObject({
      kind: 'terminated',
      terminalReason: 'FIXTURE_TERMINATED:PROVIDER_DOWN',
    });
  });

  test('rejects selections, purchases, and transfers that do not match durable evidence', async () => {
    const fixture = harness('flip-evidence-mismatch');
    let session = await fixture.advanceTo('pool-committed');
    await expect(
      fixture.service.transition(session.id, {
        ...selectionAction(fixture),
        evidence: {
          ...selectionAction(fixture).evidence,
          providerAssetReference: 'asset_not_committed',
        },
        expectedVersion: session.version,
      }),
    ).rejects.toThrow('not an exact member of the committed outcome space');

    session = await fixture.service.transition(session.id, {
      ...selectionAction(fixture),
      expectedVersion: session.version,
    });
    await expect(
      fixture.service.transition(session.id, {
        ...purchaseAction(fixture),
        evidence: {
          ...purchaseAction(fixture).evidence,
          providerListingReference: 'listing_not_selected',
        },
        expectedVersion: session.version,
      }),
    ).rejects.toThrow('does not match the durable selected outcome');
    await expect(
      fixture.service.transition(session.id, {
        ...purchaseAction(fixture),
        evidence: {
          ...purchaseAction(fixture).evidence,
          amount: usdc('1'),
        },
        expectedVersion: session.version,
      }),
    ).rejects.toThrow('does not match the durable selected outcome');

    session = await fixture.service.transition(session.id, {
      ...purchaseAction(fixture),
      expectedVersion: session.version,
    });
    await expect(
      fixture.service.transition(session.id, {
        ...transferAction(fixture),
        evidence: {
          ...transferAction(fixture).evidence,
          destinationWalletReference: 'fixture-wallet:somebody-else',
        },
        expectedVersion: session.version,
      }),
    ).rejects.toThrow('does not match the acquired outcome and player fixture wallet');
  });

  test('fails closed outside explicit fixture mode and never advertises live play', async () => {
    const disabled = harness('flip-disabled', { NODE_ENV: 'production' });
    await expect(disabled.create()).rejects.toMatchObject({ code: 'DISABLED' });
    expect(flipSessionStateCapability({ NODE_ENV: 'production' })).toEqual({
      fixtureReady: false,
      playable: false,
      reason: 'Marketplace Flip lifecycle is disabled outside explicit fixture or preview mode.',
    });
    expect(flipSessionStateCapability(FIXTURE_ENVIRONMENT)).toMatchObject({
      fixtureReady: true,
      playable: false,
    });
    expect(
      flipSessionStateCapability({
        DAILYDRAFT_FLIP_FIXTURE_MODE: 'true',
        NODE_ENV: 'development',
        VERCEL_ENV: 'production',
      }),
    ).toMatchObject({ fixtureReady: false, playable: false });
  });

  test('rejects unsupported fixture fields, malformed money, and corrupted ledgers', async () => {
    const fixture = harness('flip-invalid-evidence');
    const created = await fixture.create();
    await expect(
      fixture.service.transition(created.id, {
        ...stakeAction(),
        evidence: {
          ...stakeAction().evidence,
          secret: 'not-allowed',
        } as never,
        expectedVersion: created.version,
      }),
    ).rejects.toThrow('fixture has unsupported fields');
    await expect(
      fixture.service.transition(created.id, {
        ...stakeAction(),
        evidence: {
          ...stakeAction().evidence,
          amount: { amount: '050000000', currency: 'USDC', decimals: 6 },
        },
        expectedVersion: created.version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
    await expect(
      fixture.service.transition(created.id, {
        ...stakeAction(),
        evidence: {
          ...stakeAction().evidence,
          amount: { ...stakeAction().evidence.amount, secret: 'not-allowed' },
        } as never,
        expectedVersion: created.version,
      }),
    ).rejects.toThrow('fixture has unsupported fields');

    fixture.database.corruptSession(created.id, { version: 2 });
    await expect(fixture.service.findSession(created.id)).rejects.toMatchObject({
      code: 'DISABLED',
    });
  });

  test('rejects nested secret fields in every money-bearing fixture', async () => {
    const purchaseFixture = harness('flip-nested-purchase');
    const selection = await purchaseFixture.advanceTo('selection-recorded');
    const purchase = purchaseAction(purchaseFixture);
    await expect(
      purchaseFixture.service.transition(selection.id, {
        ...purchase,
        evidence: {
          ...purchase.evidence,
          amount: { ...purchase.evidence.amount, secret: 'not-allowed' },
        } as never,
        expectedVersion: selection.version,
      }),
    ).rejects.toThrow('fixture has unsupported fields');

    const settlementFixture = harness('flip-nested-settlement');
    const revealReady = await settlementFixture.advanceTo('reveal-ready');
    const settlement = settleAction(settlementFixture);
    await expect(
      settlementFixture.service.transition(revealReady.id, {
        ...settlement,
        evidence: {
          ...settlement.evidence,
          payout: { ...settlement.evidence.payout, secret: 'not-allowed' },
        } as never,
        expectedVersion: revealReady.version,
      }),
    ).rejects.toThrow('fixture has unsupported fields');

    const recoveryFixture = harness('flip-nested-recovery');
    const created = await recoveryFixture.create();
    const recovery = await recoveryFixture.service.transition(
      created.id,
      recoveryAction(created.version),
    );
    await expect(
      recoveryFixture.service.transition(recovery.id, {
        evidence: {
          payout: { ...usdc('0'), secret: 'not-allowed' },
          reference: 'fixture-recovery:nested-secret',
          resultHash: hash('recovery:nested-secret'),
          schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
          status: 'fixture-recovered',
        } as never,
        expectedVersion: recovery.version,
        kind: 'complete-recovery',
        transitionKey: 'recovery-nested-secret',
      }),
    ).rejects.toThrow('fixture has unsupported fields');
  });

  test.each([
    {
      label: 'request hash',
      patch: { requestHash: hash('tampered-request') },
    },
    {
      label: 'transition kind',
      patch: { kind: 'SETTLED' as FlipSessionTransitionKind },
    },
    {
      label: 'milestone evidence',
      patch: {
        evidence: {
          amount: usdc('1'),
          reference: 'fixture-stake:resume',
          schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
          status: 'fixture-confirmed',
        },
      },
    },
  ])('fails closed when stored $label does not match the aggregate', async ({ patch }) => {
    const fixture = harness(`flip-corrupt-${hash(JSON.stringify(patch)).slice(0, 8)}`);
    const staked = await fixture.advanceTo('stake-confirmed');
    fixture.database.corruptTransition(staked.id, 2, patch);
    await expect(fixture.service.findSession(staked.id)).rejects.toMatchObject({
      code: 'DISABLED',
    });
  });

  test('migration keeps the ledger append-only and reveal finality database-enforced', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/prisma/migrations/20260728160000_flip_session_state_machine/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(migration).toContain('FlipSessionTransition_append_only');
    expect(migration).toContain('FlipSessionTransition_validate_contract');
    expect(migration).toContain('FlipSession_require_transition_append');
    expect(migration).toContain('Flip session transitions are append-only');
    expect(migration).toContain(
      'Flip session aggregate update requires matching append-only evidence',
    );
    expect(migration).toContain('"purchaseReference" IS NOT NULL');
    expect(migration).toContain('"transferReference" IS NOT NULL');
    expect(migration).toContain('"revealReadyReference" IS NOT NULL');
    expect(migration).toContain('Flip session transition is invalid');
  });
});

function lifecycleActions(fixture: ReturnType<typeof harness>) {
  return [
    stakeAction(),
    poolAction(fixture),
    selectionAction(fixture),
    purchaseAction(fixture),
    transferAction(fixture),
    revealAction(),
    settleAction(fixture),
  ];
}

function stakeAction() {
  return {
    evidence: {
      amount: usdc('50000000'),
      reference: 'fixture-stake:resume',
      schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
      status: 'fixture-confirmed' as const,
    },
    kind: 'confirm-stake' as const,
    transitionKey: 'confirm-stake',
  };
}

function poolAction(fixture: ReturnType<typeof harness>) {
  return {
    evidence: { poolCommitmentId: fixture.commitment.id },
    kind: 'commit-pool' as const,
    transitionKey: 'commit-pool',
  };
}

function selectionAction(fixture: ReturnType<typeof harness>) {
  const selected = selectedOutcome(fixture);
  return {
    evidence: {
      ...selected,
      reference: 'fixture-selection:resume',
      resultHash: hash('selection:resume'),
      schemaVersion: FLIP_SELECTION_FIXTURE_VERSION,
    },
    kind: 'record-selection' as const,
    transitionKey: 'record-selection',
  };
}

function purchaseAction(fixture: ReturnType<typeof harness>) {
  const selected = selectedOutcome(fixture);
  return {
    evidence: {
      amount: usdc(selected.listingValueAmount),
      provider: 'fixture-marketplace' as const,
      providerAssetReference: selected.providerAssetReference,
      providerListingReference: selected.providerListingReference,
      reference: 'fixture-purchase:resume',
      schemaVersion: FLIP_PURCHASE_FIXTURE_VERSION,
      status: 'fixture-acquired' as const,
    },
    kind: 'record-purchase' as const,
    transitionKey: 'record-purchase',
  };
}

function transferAction(fixture: ReturnType<typeof harness>) {
  const selected = selectedOutcome(fixture);
  return {
    evidence: {
      destinationWalletReference: PLAYER,
      providerAssetReference: selected.providerAssetReference,
      reference: 'fixture-transfer:resume',
      schemaVersion: FLIP_TRANSFER_FIXTURE_VERSION,
      sourceCustodyReference: 'fixture-custody:house',
      status: 'fixture-transferred' as const,
    },
    kind: 'record-transfer' as const,
    transitionKey: 'record-transfer',
  };
}

function revealAction() {
  return {
    evidence: {
      purchaseReference: 'fixture-purchase:resume',
      reference: 'fixture-reveal:resume',
      schemaVersion: FLIP_REVEAL_READY_FIXTURE_VERSION,
      status: 'fixture-ready' as const,
      transferReference: 'fixture-transfer:resume',
    },
    kind: 'mark-reveal-ready' as const,
    transitionKey: 'mark-reveal-ready',
  };
}

function settleAction(fixture: ReturnType<typeof harness>) {
  const selected = selectedOutcome(fixture);
  return {
    evidence: {
      payout: usdc('0'),
      providerAssetReference: selected.providerAssetReference,
      reference: 'fixture-settlement:resume',
      resultHash: hash('settlement:resume'),
      schemaVersion: FLIP_SETTLEMENT_FIXTURE_VERSION,
      status: 'fixture-recorded' as const,
    },
    kind: 'settle' as const,
    transitionKey: 'settle',
  };
}

function recoveryAction(expectedVersion: number): FlipSessionAction {
  return {
    evidence: {
      reasonCode: 'FIXTURE_RECOVERY',
      reference: 'fixture-recovery:request',
      schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
      status: 'fixture-recovery-required',
    },
    expectedVersion,
    kind: 'request-recovery',
    transitionKey: 'request-recovery',
  };
}

function selectedOutcome(fixture: ReturnType<typeof harness>) {
  const selected = fixture.commitment.outcomeSpace[1];
  if (!selected) throw new Error('fixture commitment has no selected outcome');
  return selected;
}

function harness(sessionId: string, environment: NodeJS.ProcessEnv = FIXTURE_ENVIRONMENT) {
  const clock = new MutableClock(START);
  const commitment = fixtureCommitment(sessionId);
  const database = new MemoryFlipDatabase(commitment);
  const service = new FlipSessionStateService(
    database as unknown as DatabaseClient,
    clock,
    environment,
  );
  const restart = () =>
    new FlipSessionStateService(database as unknown as DatabaseClient, clock, environment);
  const create = () =>
    service.createFixtureSession({
      playerWalletReference: PLAYER,
      sessionReference: sessionId,
    });

  async function advanceTo(status: string) {
    let session = await create();
    if (status === 'awaiting-stake') return session;
    for (const action of lifecycleActions({
      commitment,
    } as ReturnType<typeof harness>)) {
      session = await restart().transition(session.id, {
        ...action,
        expectedVersion: session.version,
      } as FlipSessionAction);
      if (session.status === status) return session;
    }
    throw new Error(`unsupported target state ${status}`);
  }

  return {
    advanceTo,
    clock,
    commitment,
    create,
    database,
    restart,
    service,
    sessionId,
  };
}

function fixtureCommitment(sessionReference: string): MemoryCommitment {
  return {
    eligibleOutcomeCount: 3,
    id: `flipcommit_${hash(sessionReference).slice(0, 24)}`,
    outcomeSpace: [
      {
        bandLabel: 'base',
        listingValueAmount: '20000000',
        ordinal: 0,
        providerAssetReference: 'asset_base',
        providerListingReference: 'listing_base',
      },
      {
        bandLabel: 'plus',
        listingValueAmount: '30000000',
        ordinal: 1,
        providerAssetReference: 'asset_plus',
        providerListingReference: 'listing_plus',
      },
      {
        bandLabel: 'chase',
        listingValueAmount: '60000000',
        ordinal: 2,
        providerAssetReference: 'asset_chase',
        providerListingReference: 'listing_chase',
      },
    ],
    poolCommitmentHash: hash(`pool:${sessionReference}`),
    rulesHash: hash(`rules:${sessionReference}`),
    ruleset: {
      activation: 'fixture-only',
      currency: 'USDC',
      decimals: 6,
      rulesHash: hash(`rules:${sessionReference}`),
      sealedAt: new Date('2026-07-28T15:58:00.000Z'),
      stakeAmount: '50000000',
    },
    sealedAt: new Date('2026-07-28T15:59:00.000Z'),
    sessionReference,
    snapshotContentHash: hash(`snapshot:${sessionReference}`),
  };
}

function usdc(amount: string): Money {
  return { amount, currency: 'USDC', decimals: 6 };
}

function hash(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

class MutableClock {
  #current: Date;

  constructor(value: Date) {
    this.#current = new Date(value);
  }

  advance(milliseconds: number): void {
    this.#current = new Date(this.#current.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.#current);
  }
}

interface MemoryCommitment {
  eligibleOutcomeCount: number;
  id: string;
  outcomeSpace: Array<{
    bandLabel: string;
    listingValueAmount: string;
    ordinal: number;
    providerAssetReference: string;
    providerListingReference: string;
  }>;
  poolCommitmentHash: string;
  rulesHash: string;
  ruleset: {
    activation: string;
    currency: string;
    decimals: number;
    rulesHash: string;
    sealedAt: Date | null;
    stakeAmount: string;
  };
  sealedAt: Date | null;
  sessionReference: string;
  snapshotContentHash: string;
}

type MemorySession = {
  activationMode: string;
  createdAt: Date;
  id: string;
  playerWalletReference: string;
  poolCommitmentHash: string | null;
  poolCommitmentId: string | null;
  purchaseReference: string | null;
  purchasedAt: Date | null;
  revealReadyAt: Date | null;
  revealReadyReference: string | null;
  rulesHash: string | null;
  selectedAssetReference: string | null;
  selectedBandLabel: string | null;
  selectedListingReference: string | null;
  selectedOrdinal: number | null;
  selectedValueAmount: string | null;
  snapshotContentHash: string | null;
  stakeAmount: string | null;
  stakeCurrency: string | null;
  stakeDecimals: number | null;
  stateMachineVersion: string;
  status: FlipSessionStatus;
  terminalAt: Date | null;
  terminalReason: string | null;
  transferReference: string | null;
  transferredAt: Date | null;
  updatedAt: Date;
  version: number;
};

type MemoryTransition = {
  createdAt: Date;
  evidence: unknown;
  fromStatus: FlipSessionStatus | null;
  id: string;
  kind: FlipSessionTransitionKind;
  poolCommitmentHash: string | null;
  requestHash: string;
  requestPayload: string;
  selectedAssetReference: string | null;
  sequence: number;
  sessionId: string;
  terminalReason: string | null;
  toStatus: FlipSessionStatus;
  transitionKey: string;
};

class MemoryFlipDatabase {
  readonly #commitment: MemoryCommitment;
  readonly #sessions = new Map<string, MemorySession>();
  readonly #transitions: MemoryTransition[] = [];

  constructor(commitment: MemoryCommitment) {
    this.#commitment = commitment;
  }

  readonly flipSession = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const input = data as unknown as MemorySessionCreateInput;
      if (this.#sessions.has(input.id)) throw new Error('unique Flip session');
      const now = input.updatedAt;
      const session: MemorySession = {
        activationMode: input.activationMode,
        createdAt: now,
        id: input.id,
        playerWalletReference: input.playerWalletReference,
        poolCommitmentHash: null,
        poolCommitmentId: null,
        purchaseReference: null,
        purchasedAt: null,
        revealReadyAt: null,
        revealReadyReference: null,
        rulesHash: null,
        selectedAssetReference: null,
        selectedBandLabel: null,
        selectedListingReference: null,
        selectedOrdinal: null,
        selectedValueAmount: null,
        snapshotContentHash: null,
        stakeAmount: null,
        stakeCurrency: null,
        stakeDecimals: null,
        stateMachineVersion: input.stateMachineVersion,
        status: input.status,
        terminalAt: null,
        terminalReason: null,
        transferReference: null,
        transferredAt: null,
        updatedAt: now,
        version: input.version,
      };
      this.#sessions.set(session.id, session);
      this.#transitions.push({
        ...input.transitions.create,
        createdAt: now,
        evidence: structuredClone(input.transitions.create.evidence),
        poolCommitmentHash: null,
        selectedAssetReference: null,
        sessionId: session.id,
        terminalReason: null,
      });
      return this.withTransitions(session);
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const session = this.#sessions.get(where.id);
      return session ? this.withTransitions(session) : null;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const session = this.#sessions.get(where.id);
      if (!session) throw new Error('not found');
      return this.withTransitions(session);
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: Record<string, unknown> & {
        status: FlipSessionStatus;
        version: { increment: number };
      };
      where: { id: string; status: FlipSessionStatus; version: number };
    }) => {
      const session = this.#sessions.get(where.id);
      if (!session || session.status !== where.status || session.version !== where.version) {
        return { count: 0 };
      }
      for (const [key, value] of Object.entries(data)) {
        if (key === 'version') continue;
        (session as unknown as Record<string, unknown>)[key] = structuredClone(value);
      }
      session.version += data.version.increment;
      session.updatedAt = new Date();
      return { count: 1 };
    },
  };

  readonly flipSessionTransition = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const input = data as unknown as Omit<MemoryTransition, 'createdAt'>;
      if (
        this.#transitions.some(
          (transition) =>
            transition.sessionId === input.sessionId &&
            (transition.sequence === input.sequence ||
              transition.transitionKey === input.transitionKey),
        )
      ) {
        throw new Error('unique Flip transition');
      }
      const transition: MemoryTransition = {
        ...structuredClone(input),
        createdAt: new Date(),
      };
      this.#transitions.push(transition);
      return structuredClone(transition);
    },
    findUnique: async ({
      where,
    }: {
      where: {
        sessionId_transitionKey: { sessionId: string; transitionKey: string };
      };
    }) => {
      const key = where.sessionId_transitionKey;
      const transition = this.#transitions.find(
        (candidate) =>
          candidate.sessionId === key.sessionId && candidate.transitionKey === key.transitionKey,
      );
      return transition ? structuredClone(transition) : null;
    },
  };

  readonly flipSessionPoolCommitment = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === this.#commitment.id ? structuredClone(this.#commitment) : null,
  };

  async $transaction<T>(operation: (transaction: this) => Promise<T>): Promise<T> {
    return operation(this);
  }

  corruptSession(id: string, patch: Partial<MemorySession>): void {
    const session = this.#sessions.get(id);
    if (!session) throw new Error('session not found');
    Object.assign(session, patch);
  }

  corruptTransition(sessionId: string, sequence: number, patch: Partial<MemoryTransition>): void {
    const transition = this.#transitions.find(
      (candidate) => candidate.sessionId === sessionId && candidate.sequence === sequence,
    );
    if (!transition) throw new Error('transition not found');
    Object.assign(transition, structuredClone(patch));
  }

  transitionCount(sessionId: string): number {
    return this.#transitions.filter((transition) => transition.sessionId === sessionId).length;
  }

  private withTransitions(session: MemorySession) {
    return {
      ...structuredClone(session),
      transitions: this.#transitions
        .filter((transition) => transition.sessionId === session.id)
        .sort((left, right) => left.sequence - right.sequence)
        .map((transition) => structuredClone(transition)),
    };
  }
}

interface MemorySessionCreateInput {
  activationMode: string;
  id: string;
  playerWalletReference: string;
  stateMachineVersion: string;
  status: FlipSessionStatus;
  transitions: {
    create: Omit<
      MemoryTransition,
      'createdAt' | 'poolCommitmentHash' | 'selectedAssetReference' | 'sessionId' | 'terminalReason'
    >;
  };
  updatedAt: Date;
  version: number;
}
