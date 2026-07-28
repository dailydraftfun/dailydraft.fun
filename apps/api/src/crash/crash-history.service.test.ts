import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '@dailydraft/db';
import { BadRequestException } from '@nestjs/common';
import {
  CrashHistoryService,
  decodeCrashHistoryCursor,
  encodeCrashHistoryCursor,
} from './crash-history.service.js';
import type { CrashSettlementService } from './crash-settlement.service.js';
import type { CrashRoundSnapshot, CrashStageStateService } from './crash-stage-state.js';
import { CrashStateMachineError } from './crash-stage-state.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OTHER_WALLET = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const ROUND_ID = 'crashround_historytest01';
const NOW = new Date('2026-07-28T18:00:00.000Z');

describe('CrashHistoryService', () => {
  test('returns a bounded wallet-scoped page with a stable keyset cursor', async () => {
    const queries: unknown[] = [];
    const service = createService({
      findMany: async (query: unknown) => {
        queries.push(query);
        return [
          { createdAt: NOW, id: ROUND_ID },
          { createdAt: new Date(NOW.getTime() - 1), id: 'crashround_historytest00' },
        ];
      },
    });
    const getReceipt = service.getReceipt.bind(service);
    service.getReceipt = async (roundId) =>
      receiptFor(await getReceipt(ROUND_ID, WALLET), { roundId });

    const page = await service.list(WALLET, { limit: 1 });

    expect(page.data).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCrashHistoryCursor(page.nextCursor as string)).toEqual({
      createdAt: NOW.toISOString(),
      id: ROUND_ID,
    });
    expect(queries).toEqual([
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
        where: expect.objectContaining({
          activationMode: 'fixture-only',
          playerWalletReference: `fixture-wallet:${WALLET}`,
        }),
      }),
    ]);
  });

  test('projects ordered decision, value, custody, recovery, and settlement evidence safely', async () => {
    const receipt = await createService().getReceipt(ROUND_ID, WALLET);
    const serialized = JSON.stringify(receipt);

    expect(receipt.events.map(({ kind }) => kind)).toEqual([
      'round-started',
      'stage-continued',
      'custody-prepared',
      'settlement-recovery-required',
    ]);
    expect(receipt.events[1]).toMatchObject({
      amount: { amount: '2000000', currency: 'USDC', decimals: 6 },
      decision: 'continue',
      stage: 2,
    });
    expect(receipt.events[1]?.reference).toMatch(/^crashref_[a-f0-9]{32}$/);
    expect(receipt.finality).toEqual({
      custody: 'not-final',
      gameState: 'committed',
      settlement: 'recovery-required',
    });
    expect(receipt.safeNextAction).toBe('retry-settlement');
    expect(receipt.bindings).toMatchObject({
      custodyPolicyHash: 'c'.repeat(64),
      custodyPolicyVersion: 'custody-v1',
      inventoryPolicyHash: 'f'.repeat(64),
      inventoryPolicyVersion: 'inventory-v1',
      riskRulesHash: 'e'.repeat(64),
      rulesHash: 'b'.repeat(64),
      settlementPolicyHash: 'd'.repeat(64),
      settlementPolicyVersion: 'settlement-v1',
    });
    expect(serialized).not.toContain(WALLET);
    expect(serialized).not.toContain(OTHER_WALLET);
    expect(serialized).not.toContain('provider-signature-secret');
    expect(serialized).not.toContain('providerEvidence');
    expect(serialized).not.toContain('sourceReference');
    expect(serialized).not.toContain('crashcustody_safe_reference');
    expect(serialized).not.toContain('operation:safe-reference');
    expect(serialized).not.toContain('player:decision-safe-reference');
    expect(receipt.privacy).toEqual({
      exposesProviderSignatures: false,
      exposesWalletAddresses: false,
    });
  });

  test('hides whether another wallet round exists', async () => {
    await expect(createService().getReceipt(ROUND_ID, OTHER_WALLET)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('propagates durable ledger tamper failures instead of projecting an unverified receipt', async () => {
    const tamper = new CrashStateMachineError(
      'DISABLED',
      'Crash durable transition ledger is inconsistent',
    );
    const service = createService({}, { findRound: async () => Promise.reject(tamper) });
    await expect(service.getReceipt(ROUND_ID, WALLET)).rejects.toBe(tamper);
  });

  test('returns an empty authenticated page without leaking global rounds', async () => {
    const service = createService({ findMany: async () => [] });
    await expect(service.list(WALLET, { limit: 20 })).resolves.toEqual({
      data: [],
      hasMore: false,
      nextCursor: null,
      schemaVersion: 'dailydraft.crash-history.v1',
    });
  });

  test('fails closed before querying even an empty history outside fixture mode', async () => {
    let queried = false;
    const disabled = new CrashStateMachineError('DISABLED', 'fixture mode disabled');
    const service = createService(
      {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
      {
        assertFixtureModeEnabled: () => {
          throw disabled;
        },
      },
    );

    await expect(service.list(WALLET, { limit: 20 })).rejects.toBe(disabled);
    expect(queried).toBe(false);
  });

  test('fails closed when round metadata disappears after ledger validation', async () => {
    const service = createService({ findUnique: async () => null });
    await expect(service.getReceipt(ROUND_ID, WALLET)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test.each([
    'duplicate',
    'extra',
  ] as const)('rejects an %s custody intent instead of projecting ambiguous ownership evidence', async (kind) => {
    const metadata = metadataFixture();
    const intent = metadata.custodyIntents[0];
    if (!intent) throw new Error('custody fixture required');
    metadata.custodyIntents.push({
      ...intent,
      id: kind === 'duplicate' ? intent.id : 'crashcustody_unbound_extra',
    });

    await expect(
      createService({ findUnique: async () => metadata }).getReceipt(ROUND_ID, WALLET),
    ).rejects.toMatchObject({ code: 'INVALID_EVIDENCE' });
  });

  test('projects every safe next action and non-final custody state', async () => {
    const active = snapshot();
    active.status = 'active';
    active.decisionDeadline = '2026-07-28T18:00:30.000Z';
    active.settlementStatus = 'not-required';
    active.terminalAt = null;
    active.terminalReason = null;
    const choose = await createService({}, { findRound: async () => active }, null).getReceipt(
      ROUND_ID,
      WALLET,
    );
    expect(choose.safeNextAction).toBe('choose-action');
    expect(choose.custody.status).toBe('prepared');

    active.decisionDeadline = null;
    const reconnect = await createService({}, { findRound: async () => active }, null).getReceipt(
      ROUND_ID,
      WALLET,
    );
    expect(reconnect.safeNextAction).toBe('reconnect');

    const terminal = snapshot();
    terminal.settlementStatus = 'pending';
    const pendingMetadata = metadataFixture();
    if (!pendingMetadata.settlement?.operations[0]) throw new Error('operation required');
    pendingMetadata.settlement.operations[0] = {
      ...pendingMetadata.settlement.operations[0],
      failureCode: null,
      status: 'PREPARED',
    };
    const pending = await createService(
      { findUnique: async () => pendingMetadata },
      { findRound: async () => terminal },
      settlement({
        operations: [
          {
            failureCode: null,
            kind: 'transfer',
            operationKey: 'operation:safe-reference',
            providerSignature: null,
            recoveryMode: 'none',
            sequence: 1,
            status: 'prepared',
          },
        ],
        recoveryReason: null,
        status: 'pending',
      }),
    ).getReceipt(ROUND_ID, WALLET);
    expect(pending.safeNextAction).toBe('wait-for-settlement');

    terminal.settlementStatus = 'settled';
    terminal.settlementReceiptHash = 'f'.repeat(64);
    terminal.settledAt = '2026-07-28T18:00:05.000Z';
    const settledMetadata = metadataFixture();
    if (!settledMetadata.settlement?.operations[0]) throw new Error('operation required');
    settledMetadata.settlement.operations[0] = {
      ...settledMetadata.settlement.operations[0],
      failureCode: null,
      finalizedAt: new Date('2026-07-28T18:00:05.000Z'),
      status: 'FINALIZED',
    };
    const settled = await createService(
      { findUnique: async () => settledMetadata },
      { findRound: async () => terminal },
      settlement({
        finalizedOperationCount: 1,
        operations: [
          {
            failureCode: null,
            kind: 'transfer',
            operationKey: 'operation:safe-reference',
            providerSignature: 'provider-signature-secret',
            recoveryMode: 'none',
            sequence: 1,
            status: 'finalized',
          },
        ],
        receiptHash: 'f'.repeat(64),
        recoveryReason: null,
        status: 'settled',
      }),
    ).getReceipt(ROUND_ID, WALLET);
    expect(settled.safeNextAction).toBe('review-receipt');
    expect(settled.finality.custody).toBe('settled');
  });

  test('sanitizes malformed recovery evidence and handles every operation projection branch', async () => {
    const metadata = metadataFixture();
    if (!metadata.settlement) throw new Error('settlement fixture required');
    const operation = metadata.settlement.operations[0];
    if (!operation) throw new Error('operation fixture required');
    metadata.settlement.operations = [
      {
        ...operation,
        failureCode: 'unsafe recovery reason with spaces and wallet data',
        status: 'FINALIZED',
      },
      {
        ...operation,
        amount: '01',
        finalizedAt: null,
        operationKey: 'operation:prepared',
        sequence: 2,
        stage: null,
        status: 'PREPARED',
      },
    ];
    const tamperedValue = snapshot();
    const firstTransition = tamperedValue.transitions[0];
    if (!firstTransition) throw new Error('transition fixture required');
    tamperedValue.transitions = [
      { ...firstTransition, valueChange: null },
      ...tamperedValue.transitions.slice(1),
    ];
    const receipt = await createService(
      { findUnique: async () => metadata },
      { findRound: async () => tamperedValue },
      settlement({
        expectedOperationCount: 2,
        finalizedOperationCount: 1,
        operations: [
          {
            failureCode: 'unsafe recovery reason with spaces and wallet data',
            kind: 'transfer',
            operationKey: operation.operationKey,
            providerSignature: 'provider-signature-secret',
            recoveryMode: 'none',
            sequence: 1,
            status: 'finalized',
          },
          {
            failureCode: null,
            kind: 'transfer',
            operationKey: 'operation:prepared',
            providerSignature: null,
            recoveryMode: 'none',
            sequence: 2,
            status: 'prepared',
          },
        ],
        recoveryReason: 'crashsettlementop_internal_01:PROVIDER_RESULT_AMBIGUOUS',
      }),
    ).getReceipt(ROUND_ID, WALLET);

    expect(receipt.custody.status).toBe('prepared');
    expect(receipt.finality.custody).toBe('not-final');
    expect(receipt.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: null,
          kind: 'round-started',
        }),
        expect.objectContaining({
          kind: 'settlement-finalized',
          terminalReason: 'RECOVERY_REQUIRED',
        }),
        expect.objectContaining({
          amount: null,
          kind: 'settlement-prepared',
          stage: 2,
        }),
      ]),
    );
    expect(receipt.settlement.recoveryReason).toBe('RECOVERY_REQUIRED');
    expect(JSON.stringify(receipt)).not.toContain('crashsettlementop_internal_01');
  });

  test.each([
    'not-a-cursor',
    `v1.${Buffer.from(JSON.stringify({ createdAt: 'yesterday', id: ROUND_ID })).toString(
      'base64url',
    )}`,
    `v1.${Buffer.from(
      JSON.stringify({ createdAt: NOW.toISOString(), id: 'duel_wrongkind00001' }),
    ).toString('base64url')}`,
  ])('rejects malformed cursor %s', (cursor) => {
    expect(() => decodeCrashHistoryCursor(cursor)).toThrow(BadRequestException);
  });

  test('refuses to encode a non-canonical cursor', () => {
    expect(() => encodeCrashHistoryCursor({ createdAt: '2026-07-28', id: ROUND_ID })).toThrow(
      BadRequestException,
    );
  });
});

function createService(
  roundOverrides: {
    findMany?: (query: unknown) => Promise<Array<{ createdAt: Date; id: string }>>;
    findUnique?: () => Promise<ReturnType<typeof metadataFixture> | null>;
  } = {},
  stateOverrides: {
    assertFixtureModeEnabled?: () => void;
    findRound?: (roundId: string) => Promise<CrashRoundSnapshot>;
  } = {},
  settlementOverride: ReturnType<typeof settlement> | null = settlement(),
) {
  const metadata = metadataFixture(settlementOverride !== null);
  const database = {
    crashRound: {
      findMany: roundOverrides.findMany ?? (async () => [{ createdAt: NOW, id: ROUND_ID }]),
      findUnique: roundOverrides.findUnique ?? (async () => metadata),
    },
  } as unknown as DatabaseClient;
  const state = {
    assertFixtureModeEnabled: stateOverrides.assertFixtureModeEnabled ?? (() => undefined),
    findRound: stateOverrides.findRound ?? (async () => snapshot()),
  } as unknown as CrashStageStateService;
  const settlements = {
    findFixtureSettlement: async () => settlementOverride,
  } as unknown as CrashSettlementService;
  return new CrashHistoryService(database, state, settlements);
}

function metadataFixture(withSettlement = true) {
  const custodyIntents: Array<{
    activationMode: string;
    approvedRecipient: string | null;
    architectureVersion: string;
    assetReference: string;
    calculatorVersion: string;
    createdAt: Date;
    id: string;
    network: string;
    playerWalletReference: string;
    policyHash: string | null;
    policyVersion: string | null;
    recoveryReason: string | null;
    requestedRecipient: string;
    roundId: string;
    rulesHash: string;
    rulesVersion: string;
    signingStatus: 'NOT_STARTED';
    stage: number;
    stateMachineRulesHash: string;
    stateMachineVersion: string;
    status: 'PREPARED' | 'RECOVERY_REQUIRED';
  }> = [
    {
      activationMode: 'fixture-only',
      approvedRecipient: 'fixture-wallet:session-custody',
      architectureVersion: 'crash-architecture-v1',
      assetReference: 'fixture-asset:history-stage-1',
      calculatorVersion: 'dailydraft.crash-calculator.v1',
      createdAt: new Date('2026-07-28T18:00:02.000Z'),
      id: 'crashcustody_safe_reference',
      network: 'solana-devnet',
      playerWalletReference: `fixture-wallet:${WALLET}`,
      policyHash: 'c'.repeat(64),
      policyVersion: 'custody-v1',
      recoveryReason: null,
      requestedRecipient: 'fixture-wallet:session-custody',
      roundId: ROUND_ID,
      rulesHash: 'b'.repeat(64),
      rulesVersion: 'rules-v1',
      signingStatus: 'NOT_STARTED',
      stage: 1,
      stateMachineRulesHash: 'a'.repeat(64),
      stateMachineVersion: 'dailydraft.crash-stage-state.v1',
      status: 'PREPARED',
    },
  ];
  const operations: Array<{
    amount: string;
    createdAt: Date;
    decimals: number;
    failureCode: string | null;
    finalizedAt: Date | null;
    operationKey: string;
    sequence: number;
    stage: number | null;
    status: 'FINALIZED' | 'PREPARED' | 'RECOVERY_REQUIRED';
    updatedAt: Date;
  }> = [
    {
      amount: '2000000',
      createdAt: new Date('2026-07-28T18:00:03.000Z'),
      decimals: 6,
      failureCode: 'PROVIDER_RESULT_AMBIGUOUS',
      finalizedAt: null,
      operationKey: 'operation:safe-reference',
      sequence: 1,
      stage: 2,
      status: 'RECOVERY_REQUIRED',
      updatedAt: new Date('2026-07-28T18:00:04.000Z'),
    },
  ];
  return {
    createdAt: NOW,
    custodyIntents,
    id: ROUND_ID,
    playerWalletReference: `fixture-wallet:${WALLET}`,
    settlement: withSettlement
      ? {
          custodyPolicyHash: 'c'.repeat(64),
          operations,
          settlementPolicyHash: 'd'.repeat(64),
        }
      : null,
    updatedAt: new Date('2026-07-28T18:00:04.000Z'),
  };
}

function settlement(
  overrides: Partial<{
    finalizedOperationCount: number;
    expectedOperationCount: number;
    operations: Array<{
      failureCode: string | null;
      kind: 'liquidate' | 'open' | 'purchase' | 'transfer';
      operationKey: string;
      providerSignature: string | null;
      recoveryMode: 'none' | 'reconcile-only' | 'retryable';
      sequence: number;
      status: 'finalized' | 'prepared' | 'recovery-required';
    }>;
    receiptHash: string | null;
    recoveryReason: string | null;
    status: 'pending' | 'recovery-required' | 'settled';
  }> = {},
) {
  return {
    custodyRecipient: 'fixture-wallet:session-custody',
    expectedOperationCount: 1,
    finalizedOperationCount: 0,
    custodyPolicyHash: 'c'.repeat(64),
    custodyPolicyVersion: 'custody-v1',
    inventoryPolicyHash: 'f'.repeat(64),
    inventoryPolicyVersion: 'inventory-v1',
    kind: 'cash-out' as const,
    operations: [
      {
        failureCode: 'PROVIDER_RESULT_AMBIGUOUS',
        kind: 'transfer' as const,
        operationKey: 'operation:safe-reference',
        providerSignature: 'provider-signature-secret',
        recoveryMode: 'reconcile-only' as const,
        sequence: 1,
        status: 'recovery-required' as const,
      },
    ],
    receiptHash: null,
    recoveryReason: 'PROVIDER_RESULT_AMBIGUOUS',
    roundId: ROUND_ID,
    settledAt: null,
    settlementPolicyHash: 'd'.repeat(64),
    settlementPolicyVersion: 'settlement-v1',
    status: 'recovery-required' as const,
    ...overrides,
  };
}

function snapshot(): CrashRoundSnapshot {
  return {
    architectureVersion: 'crash-architecture-v1',
    calculatorVersion: 'dailydraft.crash-calculator.v1',
    decisionDeadline: null,
    defaultAction: 'forfeit',
    id: ROUND_ID,
    playerWalletReference: `fixture-wallet:${WALLET}`,
    pot: { amount: '2000000', currency: 'USDC', decimals: 6 },
    riskExpiresAt: '2026-07-28T19:00:00.000Z',
    riskRulesHash: 'e'.repeat(64),
    riskRulesVersion: 'risk-v1',
    rulesHash: 'b'.repeat(64),
    rulesVersion: 'rules-v1',
    settledAt: null,
    settlementReceiptHash: null,
    settlementStatus: 'recovery-required',
    stage: 2,
    stateMachineRulesHash: 'a'.repeat(64),
    stateMachineVersion: 'dailydraft.crash-stage-state.v1',
    status: 'cashed-out',
    terminalAt: '2026-07-28T18:00:03.000Z',
    terminalReason: 'PLAYER_CASH_OUT',
    transitions: [
      {
        createdAt: NOW.toISOString(),
        decision: null,
        fromStage: null,
        fromStatus: null,
        kind: 'round-started',
        outcome: null,
        payment: null,
        scheduledDeadline: '2026-07-28T18:00:30.000Z',
        sequence: 1,
        settlement: null,
        terminalReason: null,
        toStage: 1,
        toStatus: 'active',
        transitionKey: 'round-started',
        valueChange: {
          after: { amount: '1000000', currency: 'USDC', decimals: 6 },
        },
      },
      {
        createdAt: '2026-07-28T18:00:01.000Z',
        decision: 'continue',
        fromStage: 1,
        fromStatus: 'active',
        kind: 'stage-continued',
        outcome: {
          custody: {
            assetReference: 'fixture-asset:history-stage-1',
            reference: 'crashcustody_safe_reference',
          },
          provider: {
            providerEvidence: 'must-never-leak',
            stage: 1,
            wallet: OTHER_WALLET,
          },
        },
        payment: { providerSignature: 'must-never-leak' },
        scheduledDeadline: '2026-07-28T18:00:31.000Z',
        sequence: 2,
        settlement: null,
        terminalReason: null,
        toStage: 2,
        toStatus: 'active',
        transitionKey: 'player:decision-safe-reference',
        valueChange: {
          nextPot: { amount: '2000000', currency: 'USDC', decimals: 6 },
        },
      },
    ],
    version: 2,
  };
}

function receiptFor(
  receipt: Awaited<ReturnType<CrashHistoryService['getReceipt']>>,
  overrides: { roundId: string },
) {
  return { ...receipt, ...overrides };
}
