import { describe, expect, test } from 'bun:test';
import type { DatabaseClient, Prisma } from '@dailydraft/db';

import {
  canonicalFlipAcquisitionStringify,
  createFixtureFlipAcquisitionPolicy,
} from './flip-acquisition.policy.js';
import {
  FlipAcquisitionAmbiguousError,
  FlipAcquisitionDefinitelyNotAppliedError,
  type FlipAcquisitionProvider,
  type FlipAcquisitionProviderRequest,
  type FlipAcquisitionProviderResult,
} from './flip-acquisition.provider.js';
import { FlipAcquisitionService } from './flip-acquisition.service.js';
import {
  FLIP_RECOVERY_FIXTURE_VERSION,
  type FlipSessionStateService,
} from './flip-session-state.service.js';

const RULES_HASH = '1'.repeat(64);
const PROOF_HASH = '2'.repeat(64);
const SESSION_ID = 'flip-acquisition-unit-session';
const FIXTURE_ENVIRONMENT = {
  DAILYDRAFT_FLIP_FIXTURE_MODE: 'true',
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;

describe('fixture Flip acquisition recovery', () => {
  test('seals and idempotently replays the reviewed acquisition policy', async () => {
    const policy = createFixtureFlipAcquisitionPolicy({
      rulesHash: RULES_HASH,
      rulesVersion: 1,
    });
    const fixture = policyHarness();

    const created = await fixture.service.createFixturePolicy({
      policy,
      rulesKey: 'flip-rules-unit',
      rulesVersion: 1,
    });
    const replay = await fixture.service.createFixturePolicy({
      policy,
      rulesKey: 'flip-rules-unit',
      rulesVersion: 1,
    });

    expect(created).toMatchObject({ created: true, policyHash: policy.policyHash });
    expect(replay).toEqual({ ...created, created: false });
    expect(fixture.createdPolicies).toHaveLength(1);
  });

  test('fails closed for invalid, unsealed, conflicting, or unsealable policies', async () => {
    const policy = createFixtureFlipAcquisitionPolicy({
      rulesHash: RULES_HASH,
      rulesVersion: 1,
    });
    await expect(
      policyHarness().service.createFixturePolicy({
        policy,
        rulesKey: 'flip-rules-unit',
        rulesVersion: 0,
      }),
    ).rejects.toThrow('version is invalid');
    await expect(
      policyHarness({ rulesSealed: false }).service.createFixturePolicy({
        policy,
        rulesKey: 'flip-rules-unit',
        rulesVersion: 1,
      }),
    ).rejects.toThrow('sealed reviewed ruleset');
    await expect(
      policyHarness({ conflictingPolicy: true }).service.createFixturePolicy({
        policy,
        rulesKey: 'flip-rules-unit',
        rulesVersion: 1,
      }),
    ).rejects.toThrow('already bound');
    await expect(
      policyHarness({ sealSucceeds: false }).service.createFixturePolicy({
        policy,
        rulesKey: 'flip-rules-unit',
        rulesVersion: 1,
      }),
    ).rejects.toThrow('could not be sealed');
  });

  test('serializes success, records exact purchase/transfer evidence, and replays receipt', async () => {
    const fixture = harness();
    const concurrent = await Promise.all([
      fixture.service.resumeFixtureAcquisition(SESSION_ID),
      fixture.service.resumeFixtureAcquisition(SESSION_ID),
    ]);
    const acquired = await fixture.service.resumeFixtureAcquisition(SESSION_ID);

    expect(concurrent.some(({ status }) => status === 'acquired')).toBe(true);
    expect(acquired).toMatchObject({
      finalizedOperationCount: 2,
      receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      status: 'acquired',
    });
    expect(fixture.provider.executions).toBe(2);
    expect(fixture.transitions.map(({ kind }) => kind)).toEqual([
      'record-purchase',
      'record-transfer',
    ]);
  });

  test('reconciles a lost purchase response after restart without another execution', async () => {
    const provider = new ScriptedProvider({ ambiguousOnce: 'purchase' });
    const first = harness({ provider });
    const recovery = await first.service.resumeFixtureAcquisition(SESSION_ID);
    expect(recovery).toMatchObject({
      operations: [expect.objectContaining({ recoveryMode: 'reconcile-only' }), expect.anything()],
      status: 'recovery-required',
    });
    expect(provider.executions).toBe(1);

    const restarted = new FlipAcquisitionService(
      first.database,
      provider,
      first.sessions,
      FIXTURE_ENVIRONMENT,
    );
    const acquired = await restarted.resumeFixtureAcquisition(SESSION_ID);
    expect(acquired.status).toBe('acquired');
    expect(provider.executions).toBe(2);
    expect(provider.reconciliations).toBeGreaterThanOrEqual(3);
  });

  test('keeps an unresolved provider timeout reconcile-only without resubmission', async () => {
    const provider = new ScriptedProvider({ timeoutOnce: 'purchase' });
    const fixture = harness({ provider });
    const timeout = await fixture.service.resumeFixtureAcquisition(SESSION_ID);
    const replay = await fixture.service.resumeFixtureAcquisition(SESSION_ID);

    expect(timeout).toMatchObject({
      operations: [
        expect.objectContaining({
          failureCode: 'PROVIDER_TIMEOUT',
          recoveryMode: 'reconcile-only',
        }),
        expect.anything(),
      ],
      status: 'recovery-required',
    });
    expect(replay).toEqual(timeout);
    expect(provider.executions).toBe(1);
  });

  test.each([
    ['PROVIDER_REJECTED', 'refund'],
    ['SELECTED_ASSET_UNAVAILABLE', 'reselection'],
    ['APPROVED_SUBSTITUTE_REQUIRED', 'substitute'],
  ] as const)('enters only reviewed %s recovery', async (failureCode, branch) => {
    const fixture = harness({
      provider: new ScriptedProvider({ failureCode, failKind: 'purchase' }),
    });
    const recovery = await fixture.service.resumeFixtureAcquisition(SESSION_ID);
    expect(recovery).toMatchObject({
      recoveryBranch: branch,
      recoveryReason: failureCode,
      status: 'recovery-required',
    });
    expect(fixture.transitions.at(-1)?.kind).toBe('request-recovery');
    expect(fixture.inventory).toHaveLength(0);
  });

  test('reconciles a fail-once recovery transition after restart without provider replay', async () => {
    const fixture = harness({
      failRecoveryTransitionOnce: true,
      provider: new ScriptedProvider({
        failureCode: 'PROVIDER_REJECTED',
        failKind: 'purchase',
      }),
    });

    await expect(fixture.service.resumeFixtureAcquisition(SESSION_ID)).rejects.toThrow(
      'test interrupted recovery transition',
    );
    const restarted = new FlipAcquisitionService(
      fixture.database,
      fixture.provider,
      fixture.sessions,
      FIXTURE_ENVIRONMENT,
    );
    const recovered = await restarted.resumeFixtureAcquisition(SESSION_ID);
    const replay = await restarted.resumeFixtureAcquisition(SESSION_ID);

    expect(recovered).toMatchObject({
      recoveryBranch: 'refund',
      recoveryReason: 'PROVIDER_REJECTED',
      status: 'recovery-required',
    });
    expect(replay).toEqual(recovered);
    expect(fixture.provider.executions).toBe(1);
    expect(fixture.transitions.filter(({ kind }) => kind === 'request-recovery')).toHaveLength(1);
  });

  test('reconciles reviewed recovery that wins the acquisition lease race', async () => {
    const fixture = harness({ recoverDuringLeaseClaim: true });

    const recovered = await fixture.service.resumeFixtureAcquisition(SESSION_ID);

    expect(recovered).toMatchObject({
      recoveryBranch: 'refund',
      recoveryReason: 'PROVIDER_REJECTED',
      status: 'recovery-required',
    });
    expect(fixture.provider.executions).toBe(0);
    expect(fixture.transitions.filter(({ kind }) => kind === 'request-recovery')).toHaveLength(1);
  });

  test.each([
    'claim',
    'owner',
  ] as const)('reconciles reviewed recovery after losing the acquisition lease %s', async (loss) => {
    const fixture = harness({
      loseClaimToRecovery: loss === 'claim',
      loseLeaseToRecovery: loss === 'owner',
    });

    const recovered = await fixture.service.resumeFixtureAcquisition(SESSION_ID);

    expect(recovered).toMatchObject({
      recoveryBranch: 'refund',
      recoveryReason: 'PROVIDER_REJECTED',
      status: 'recovery-required',
    });
    expect(fixture.provider.executions).toBe(0);
    expect(fixture.transitions.filter(({ kind }) => kind === 'request-recovery')).toHaveLength(1);
  });

  test('does not accept an unrelated aggregate recovery state as the acquisition transition', async () => {
    const fixture = harness({
      failRecoveryTransitionOnce: true,
      provider: new ScriptedProvider({
        failureCode: 'PROVIDER_REJECTED',
        failKind: 'purchase',
      }),
    });
    await expect(fixture.service.resumeFixtureAcquisition(SESSION_ID)).rejects.toThrow(
      'test interrupted recovery transition',
    );
    const session = await fixture.sessions.findSession(SESSION_ID);
    await fixture.sessions.transition(SESSION_ID, {
      evidence: {
        reasonCode: 'UNRELATED_RECOVERY',
        reference: 'fixture-recovery:unrelated',
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovery-required',
      },
      expectedVersion: session.version,
      kind: 'request-recovery',
      transitionKey: 'unrelated-recovery',
    });

    await expect(fixture.service.resumeFixtureAcquisition(SESSION_ID)).rejects.toThrow(
      'cannot append recovery from recovery-required',
    );
    expect(
      fixture.transitions.some(
        ({ transitionKey }) =>
          transitionKey.startsWith('flip-acquisition-recovery:') &&
          transitionKey !== 'unrelated-recovery',
      ),
    ).toBe(false);
  });

  test('rejects a canonical acquisition recovery transition with mismatched evidence', async () => {
    const fixture = harness({
      provider: new ScriptedProvider({
        failureCode: 'PROVIDER_REJECTED',
        failKind: 'purchase',
      }),
    });
    await fixture.service.resumeFixtureAcquisition(SESSION_ID);
    const recovery = fixture.transitions.find(({ kind }) => kind === 'request-recovery');
    if (!recovery) throw new Error('canonical recovery transition is absent');
    recovery.evidence = {
      reasonCode: 'PROVIDER_REJECTED:SUBSTITUTE',
      reference: 'fixture-recovery:mismatch',
      schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
      status: 'fixture-recovery-required',
    };

    await expect(fixture.service.resumeFixtureAcquisition(SESSION_ID)).rejects.toThrow(
      'changed its exact reviewed evidence',
    );
  });

  test('replays acquisition recovery after its canonical transition was completed', async () => {
    const fixture = harness({
      provider: new ScriptedProvider({
        failureCode: 'PROVIDER_REJECTED',
        failKind: 'purchase',
      }),
    });
    const recovery = await fixture.service.resumeFixtureAcquisition(SESSION_ID);
    const session = await fixture.sessions.findSession(SESSION_ID);
    await fixture.sessions.transition(SESSION_ID, {
      evidence: {
        payout: { amount: '50000000', currency: 'USDC', decimals: 6 },
        reference: 'fixture-recovery:completed',
        resultHash: '9'.repeat(64),
        schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
        status: 'fixture-recovered',
      },
      expectedVersion: session.version,
      kind: 'complete-recovery',
      transitionKey: 'complete-acquisition-recovery',
    });
    const transitionCount = fixture.transitions.length;

    await expect(fixture.service.resumeFixtureAcquisition(SESSION_ID)).resolves.toEqual(recovery);
    expect(fixture.transitions).toHaveLength(transitionCount);
  });

  test('fails closed when durable recovery evidence loses its reviewed reason', async () => {
    const fixture = harness({
      provider: new ScriptedProvider({
        failureCode: 'PROVIDER_REJECTED',
        failKind: 'purchase',
      }),
    });
    await fixture.service.resumeFixtureAcquisition(SESSION_ID);
    if (!fixture.acquisition) throw new Error('Recovery fixture acquisition is absent');
    fixture.acquisition.failureCode = null;

    await expect(fixture.service.resumeFixtureAcquisition(SESSION_ID)).rejects.toThrow(
      'requires exact durable recovery evidence',
    );
    expect(fixture.provider.executions).toBe(1);
  });

  test('ledgers a purchased asset once when reviewed transfer recovery retains it', async () => {
    const fixture = harness({
      provider: new ScriptedProvider({
        failureCode: 'PROVIDER_REJECTED',
        failKind: 'transfer',
      }),
    });
    const first = await fixture.service.resumeFixtureAcquisition(SESSION_ID);
    const replay = await fixture.service.resumeFixtureAcquisition(SESSION_ID);
    expect(first.recoveryBranch).toBe('refund');
    expect(replay).toEqual(first);
    expect(fixture.inventory).toHaveLength(1);
    expect(fixture.ledger).toHaveLength(1);
    expect(fixture.ledger[0]).toMatchObject({
      idempotencyKey: expect.stringContaining('flip-recovery-inventory:'),
      type: 'FLIP_RECOVERY_INVENTORY',
    });
  });

  test('fails closed outside fixture mode and without precommitted policy', async () => {
    const disabled = harness({ environment: { NODE_ENV: 'production' } });
    await expect(disabled.service.resumeFixtureAcquisition(SESSION_ID)).rejects.toThrow(
      'disabled outside',
    );
    const absent = harness({ policyAbsent: true });
    await expect(absent.service.resumeFixtureAcquisition(SESSION_ID)).rejects.toThrow(
      'precommitted reviewed',
    );
  });

  test('rejects an unreviewed provider failure without selecting a fallback', async () => {
    const fixture = harness({
      provider: new ScriptedProvider({ failureCode: 'UNREVIEWED_FAILURE', failKind: 'purchase' }),
    });
    await expect(fixture.service.resumeFixtureAcquisition(SESSION_ID)).rejects.toThrow(
      'no pre-reviewed',
    );
    expect(fixture.acquisition?.recoveryBranch).toBeNull();
  });
});

interface HarnessOptions {
  environment?: NodeJS.ProcessEnv;
  failRecoveryTransitionOnce?: boolean;
  loseClaimToRecovery?: boolean;
  loseLeaseToRecovery?: boolean;
  policyAbsent?: boolean;
  provider?: ScriptedProvider;
  recoverDuringLeaseClaim?: boolean;
}

function policyHarness(
  options: { conflictingPolicy?: boolean; rulesSealed?: boolean; sealSucceeds?: boolean } = {},
) {
  const createdPolicies: Array<Record<string, unknown>> = [];
  const ruleset = {
    id: 'flip-ruleset-unit',
    rulesHash: RULES_HASH,
    sealedAt: options.rulesSealed === false ? null : new Date(),
    version: 1,
  };
  const policyApi = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createdPolicies.push({ ...data, sealedAt: null });
      return createdPolicies[0];
    },
    findUnique: async () => {
      if (options.conflictingPolicy) {
        return {
          id: 'conflicting-policy',
          policyHash: 'f'.repeat(64),
          sealedAt: new Date(),
        };
      }
      return createdPolicies[0] ?? null;
    },
    updateMany: async ({ data }: { data: Record<string, unknown> }) => {
      const policy = createdPolicies[0];
      if (policy && options.sealSucceeds !== false) {
        Object.assign(policy, data);
        return { count: 1 };
      }
      return { count: 0 };
    },
  };
  const databaseObject = {
    $executeRaw: async () => 1,
    $transaction: async (action: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      action(databaseObject as unknown as Prisma.TransactionClient),
    flipAcquisitionPolicy: policyApi,
    flipRuleSet: { findUnique: async () => ruleset },
  };
  const service = new FlipAcquisitionService(
    databaseObject as unknown as DatabaseClient,
    new ScriptedProvider(),
    {} as FlipSessionStateService,
    FIXTURE_ENVIRONMENT,
  );
  return { createdPolicies, service };
}

function harness(options: HarnessOptions = {}) {
  const policy = createFixtureFlipAcquisitionPolicy({ rulesHash: RULES_HASH, rulesVersion: 1 });
  const policyRow = {
    ...policy,
    createdAt: new Date('2026-08-03T12:01:40.000Z'),
    failureBranches: policy.failureBranches,
    id: 'flip-acquisition-policy-unit',
    policyCanonicalPreimage: JSON.stringify(policy),
    reviewedAt: new Date(policy.reviewedAt),
    rulesetId: 'flip-rules-unit',
    sealedAt: new Date('2026-08-03T12:01:45.000Z'),
  };
  let acquisition: Record<string, unknown> | null = null;
  let sessionStatus = 'SELECTION_RECORDED';
  let sessionVersion = 4;
  const inventory: Array<Record<string, unknown>> = [];
  const ledger: Array<Record<string, unknown>> = [];
  const transitions: Array<{
    evidence: unknown;
    fromStatus: string;
    kind: string;
    toStatus: string;
    transitionKey: string;
  }> = [];
  let leaseBusy = false;
  let recoveryTransitionFailed = false;

  const sessionRow = () => ({
    id: SESSION_ID,
    playerWalletReference: 'fixture-wallet:flip-player',
    poolCommitmentHash: '3'.repeat(64),
    rulesHash: RULES_HASH,
    selectedAssetReference: 'fixture-asset-selected',
    selectedBandLabel: 'plus',
    selectedListingReference: 'fixture-listing-selected',
    selectedOrdinal: 2,
    selectedValueAmount: '30000000',
    selectionProof: {
      finalizedAt: new Date('2026-08-03T12:03:00.000Z'),
      id: 'fixture-selection-proof:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resultHash: PROOF_HASH,
      terminalTransitionId: 'flip-selection-transition-unit',
    },
    snapshotContentHash: '4'.repeat(64),
    status: sessionStatus,
    version: sessionVersion,
    poolCommitment: {
      committedAt: new Date('2026-08-03T12:02:00.000Z'),
      rulesHash: RULES_HASH,
      rulesVersion: 1,
      ruleset: {
        acquisitionPolicy: options.policyAbsent ? null : policyRow,
      },
    },
  });

  const operationApi = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      operations().find(
        (row) =>
          (!where.acquisitionId || row.acquisitionId === where.acquisitionId) &&
          (!where.kind || row.kind === where.kind) &&
          (!where.status || row.status === where.status),
      ) ?? null,
    findUnique: async ({ where }: { where: { id: string } }) =>
      operations().find((row) => row.id === where.id) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const row = operations().find((candidate) => candidate.id === where.id);
      if (!row) throw new Error('missing operation');
      return row;
    },
    update: async ({ data, where }: { data: Record<string, unknown>; where: { id: string } }) => {
      const row = operations().find((candidate) => candidate.id === where.id);
      if (!row) throw new Error('missing operation');
      applyData(row, data);
      return row;
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: Record<string, unknown>;
      where: { id: string };
    }) => {
      const row = operations().find((candidate) => candidate.id === where.id);
      if (!row || row.status === 'FINALIZED') return { count: 0 };
      applyData(row, data);
      return { count: 1 };
    },
  };

  const acquisitionApi = {
    create: async ({
      data,
    }: {
      data: Record<string, unknown> & {
        operations: { create: Array<Record<string, unknown>> };
      };
    }) => {
      if (acquisition) return acquisition;
      acquisition = {
        ...data,
        acquiredAt: null,
        createdAt: new Date(),
        failureCode: null,
        finalizedOperationCount: 0,
        leaseExpiresAt: null,
        leaseOwner: null,
        operations: data.operations.create.map((operation) => ({
          ...operation,
          acquisitionId: data.id,
          createdAt: new Date(),
          failureCode: null,
          finalizedAt: null,
          lastAttemptedAt: null,
          providerEvidence: null,
          providerReference: null,
          providerResultHash: null,
          recoveryMode: 'NONE',
          status: 'PREPARED',
          submissionCount: 0,
          updatedAt: new Date(),
        })),
        policy: policyRow,
        receipt: null,
        receiptHash: null,
        recoveryBranch: null,
        status: 'PENDING',
        updatedAt: new Date(),
        version: 1,
      };
      return acquisition;
    },
    findUnique: async () => acquisition,
    findUniqueOrThrow: async () => {
      if (!acquisition) throw new Error('missing acquisition');
      return acquisition;
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      if (!acquisition) throw new Error('missing acquisition');
      applyData(acquisition, data);
      if (data.leaseOwner === null) leaseBusy = false;
      return acquisition;
    },
    updateMany: async ({ data }: { data: Record<string, unknown> }) => {
      if (!acquisition) return { count: 0 };
      if (typeof data.leaseOwner === 'string') {
        if (leaseBusy || acquisition.status === 'ACQUIRED') return { count: 0 };
        leaseBusy = true;
      }
      applyData(acquisition, data);
      if (
        typeof data.leaseOwner === 'string' &&
        (options.loseClaimToRecovery ||
          options.loseLeaseToRecovery ||
          options.recoverDuringLeaseClaim)
      ) {
        const operation = operations()[0];
        if (!operation) throw new Error('missing operation for lease-race recovery');
        applyData(operation, {
          failureCode: 'PROVIDER_REJECTED',
          recoveryMode: 'RETRYABLE',
          status: 'RECOVERY_REQUIRED',
        });
        applyData(acquisition, {
          failureCode: 'PROVIDER_REJECTED',
          recoveryBranch: 'REFUND',
          status: 'RECOVERY_REQUIRED',
        });
        if (options.loseClaimToRecovery) {
          applyData(acquisition, { leaseExpiresAt: null, leaseOwner: null });
          leaseBusy = false;
          return { count: 0 };
        }
        if (options.loseLeaseToRecovery) {
          applyData(acquisition, { leaseOwner: 'concurrent-recovery-worker' });
        }
      }
      return { count: 1 };
    },
  };

  const databaseObject = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    $transaction: async (action: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
      action(databaseObject as unknown as Prisma.TransactionClient),
    flipAcquisition: acquisitionApi,
    flipAcquisitionOperation: operationApi,
    flipSession: { findUnique: async () => sessionRow() },
    houseInventoryAsset: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        inventory.push(data);
        return data;
      },
      findUnique: async () => inventory[0] ?? null,
    },
    houseTreasuryLedgerEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        ledger.push(data);
        return data;
      },
    },
  };
  const database = databaseObject as unknown as DatabaseClient;
  const sessions = {
    findSession: async () => snapshot(),
    transition: async (
      _sessionId: string,
      action: Parameters<FlipSessionStateService['transition']>[1],
    ) => {
      const replay = transitions.find(
        ({ transitionKey }) => transitionKey === action.transitionKey,
      );
      if (replay) {
        if (
          replay.kind !== action.kind ||
          canonicalFlipAcquisitionStringify(replay.evidence) !==
            canonicalFlipAcquisitionStringify(action.evidence)
        ) {
          throw new Error('Flip transitionKey was reused with different evidence');
        }
        return snapshot();
      }
      if (
        action.kind === 'request-recovery' &&
        options.failRecoveryTransitionOnce &&
        !recoveryTransitionFailed
      ) {
        recoveryTransitionFailed = true;
        throw new Error('test interrupted recovery transition');
      }
      if (action.kind === 'request-recovery' && sessionStatus === 'RECOVERY_REQUIRED') {
        throw new Error('cannot append recovery from recovery-required');
      }
      const fromStatus = normalizedStatus(sessionStatus);
      if (action.kind === 'record-purchase') sessionStatus = 'PURCHASE_RECORDED';
      if (action.kind === 'record-transfer') sessionStatus = 'TRANSFER_RECORDED';
      if (action.kind === 'request-recovery') sessionStatus = 'RECOVERY_REQUIRED';
      if (action.kind === 'complete-recovery') sessionStatus = 'RECOVERED';
      transitions.push({
        evidence: structuredClone(action.evidence),
        fromStatus,
        kind: action.kind,
        toStatus: normalizedStatus(sessionStatus),
        transitionKey: action.transitionKey,
      });
      sessionVersion += 1;
      return snapshot();
    },
  } as unknown as FlipSessionStateService;
  const provider = options.provider ?? new ScriptedProvider();
  const service = new FlipAcquisitionService(
    database,
    provider,
    sessions,
    options.environment ?? FIXTURE_ENVIRONMENT,
  );

  function operations(): Array<Record<string, unknown>> {
    return (acquisition?.operations as Array<Record<string, unknown>> | undefined) ?? [];
  }

  function snapshot() {
    return {
      id: SESSION_ID,
      playerWalletReference: 'fixture-wallet:flip-player',
      poolCommitment: null,
      purchaseReference: null,
      purchasedAt: null,
      revealReadyAt: null,
      revealReadyReference: null,
      selectedOutcome: {
        bandLabel: 'plus',
        listingValueAmount: '30000000',
        ordinal: 2,
        providerAssetReference: 'fixture-asset-selected',
        providerListingReference: 'fixture-listing-selected',
      },
      status: sessionStatus.toLowerCase().replaceAll('_', '-'),
      terminalAt: null,
      terminalReason: null,
      transferReference: null,
      transferredAt: null,
      transitions: transitions.map((transition, index) => ({
        createdAt: new Date(1_754_227_200_000 + index).toISOString(),
        evidence: transition.evidence,
        fromStatus: transition.fromStatus,
        kind: snapshotTransitionKind(transition.kind),
        poolCommitmentHash: null,
        selectedAssetReference: null,
        sequence: index + 1,
        terminalReason: null,
        toStatus: transition.toStatus,
        transitionKey: transition.transitionKey,
      })),
      version: sessionVersion,
    };
  }

  return {
    get acquisition() {
      return acquisition;
    },
    database,
    inventory,
    ledger,
    provider,
    service,
    sessions,
    transitions,
  };
}

function normalizedStatus(status: string): string {
  return status.toLowerCase().replaceAll('_', '-');
}

function snapshotTransitionKind(kind: string): string {
  const kinds: Record<string, string> = {
    'complete-recovery': 'recovery-completed',
    'record-purchase': 'purchase-recorded',
    'record-transfer': 'transfer-recorded',
    'request-recovery': 'recovery-requested',
  };
  return kinds[kind] ?? kind;
}

class ScriptedProvider implements FlipAcquisitionProvider {
  readonly effects = new Map<string, FlipAcquisitionProviderResult>();
  executions = 0;
  reconciliations = 0;
  #ambiguousThrown = false;

  constructor(
    private readonly script: {
      ambiguousOnce?: 'purchase' | 'transfer';
      failureCode?: string;
      failKind?: 'purchase' | 'transfer';
      timeoutOnce?: 'purchase' | 'transfer';
    } = {},
  ) {}

  async reconcile(
    request: FlipAcquisitionProviderRequest,
    _knownProviderReference: string | null,
  ): Promise<FlipAcquisitionProviderResult | null> {
    this.reconciliations += 1;
    return this.effects.get(request.providerRequestKey) ?? null;
  }

  async execute(request: FlipAcquisitionProviderRequest): Promise<FlipAcquisitionProviderResult> {
    this.executions += 1;
    if (this.script.failureCode && this.script.failKind === request.kind) {
      throw new FlipAcquisitionDefinitelyNotAppliedError(this.script.failureCode);
    }
    if (this.script.timeoutOnce === request.kind && !this.#ambiguousThrown) {
      this.#ambiguousThrown = true;
      throw new FlipAcquisitionAmbiguousError('PROVIDER_TIMEOUT');
    }
    const result = {
      evidence: {
        providerRequestKey: request.providerRequestKey,
        schemaVersion: 'dailydraft.flip-acquisition-provider-fixture.v1',
      },
      finalized: true,
      providerReference: `fixture-provider:${request.kind}`,
      resultHash: request.kind === 'purchase' ? '5'.repeat(64) : '6'.repeat(64),
    } as const satisfies FlipAcquisitionProviderResult;
    this.effects.set(request.providerRequestKey, result);
    if (this.script.ambiguousOnce === request.kind && !this.#ambiguousThrown) {
      this.#ambiguousThrown = true;
      throw new FlipAcquisitionAmbiguousError('PROVIDER_RESPONSE_LOST', result.providerReference);
    }
    return result;
  }
}

function applyData(target: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      target[key] = Number(target[key] ?? 0) + Number(value.increment);
    } else {
      target[key] = value;
    }
  }
}
