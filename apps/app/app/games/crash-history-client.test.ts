import { describe, expect, test } from 'bun:test';

import {
  CrashHistoryUnavailableError,
  getCrashHistory,
  getCrashReceipt,
  parseCrashHistoryPage,
  parseCrashReceipt,
} from './crash-history-client';

const ROUND_ID = 'crashround_clienthistory01';
const TOKEN = 'session_private_crash';

describe('Crash history client', () => {
  test('binds history and receipts to the bearer session without caching', async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ init, url: String(input) });
      return Response.json(String(input).endsWith('/receipt') ? receipt() : historyPage());
    }) as typeof fetch;

    await getCrashHistory(TOKEN, null, undefined, 'https://api.example.test/v1', fetcher);
    await getCrashHistory(TOKEN, 'v1.c2FmZQ', undefined, 'https://api.example.test/v1', fetcher);
    await getCrashReceipt(ROUND_ID, TOKEN, undefined, 'https://api.example.test/v1', fetcher);

    expect(requests.map(({ url }) => url)).toEqual([
      'https://api.example.test/v1/crash/rounds?limit=10',
      'https://api.example.test/v1/crash/rounds?limit=10&cursor=v1.c2FmZQ',
      `https://api.example.test/v1/crash/rounds/${ROUND_ID}/receipt`,
    ]);
    expect(requests.every(({ init }) => init?.cache === 'no-store')).toBe(true);
    expect(
      requests.every(
        ({ init }) => (init?.headers as Record<string, string>).authorization === `Bearer ${TOKEN}`,
      ),
    ).toBe(true);
  });

  test('rejects history that is unordered, duplicated, or exposes a sensitive key', () => {
    const item = historyPage().data[0];
    expect(() => parseCrashHistoryPage({ ...historyPage(), data: [item, item] })).toThrow(
      'malformed private history',
    );
    expect(() =>
      parseCrashHistoryPage({
        ...historyPage(),
        providerSignature: 'must-not-pass',
      }),
    ).toThrow('malformed private history');
    expect(() =>
      parseCrashHistoryPage({
        ...historyPage(),
        data: [
          { ...item, createdAt: '2026-07-28T17:00:00.000Z', roundId: ROUND_ID },
          {
            ...item,
            createdAt: '2026-07-28T18:00:00.000Z',
            receiptHref: '/v1/crash/rounds/crashround_clienthistory02/receipt',
            roundId: 'crashround_clienthistory02',
          },
        ],
      }),
    ).toThrow('malformed private history');
  });

  test('rejects receipts with false finality, malformed event ordering, or wallet material', () => {
    expect(() =>
      parseCrashReceipt({
        ...receipt(),
        privacy: { exposesProviderSignatures: true, exposesWalletAddresses: false },
      }),
    ).toThrow('malformed private history');
    expect(() =>
      parseCrashReceipt({
        ...receipt(),
        events: [...receipt().events].reverse(),
      }),
    ).toThrow('malformed private history');
    expect(() =>
      parseCrashReceipt({
        ...receipt(),
        sourceWalletReference: 'fixture-wallet:secret',
      }),
    ).toThrow('malformed private history');
  });

  test('surfaces configuration and HTTP failures without fabricating cached history', async () => {
    await expect(getCrashHistory(TOKEN, null, undefined, undefined)).rejects.toBeInstanceOf(
      CrashHistoryUnavailableError,
    );
    await expect(
      getCrashHistory(
        TOKEN,
        null,
        undefined,
        'https://api.example.test/v1',
        (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow('unavailable (503)');
    await expect(getCrashReceipt(ROUND_ID, TOKEN, undefined, undefined)).rejects.toBeInstanceOf(
      CrashHistoryUnavailableError,
    );
    await expect(
      getCrashReceipt('duel_wrongkind00001', TOKEN, undefined, 'https://api.example.test/v1'),
    ).rejects.toThrow('malformed private history');
    await expect(
      getCrashReceipt(
        ROUND_ID,
        TOKEN,
        undefined,
        'https://api.example.test/v1',
        (async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow('unavailable (500)');
  });

  test('fails closed on every malformed envelope boundary', () => {
    expect(() => parseCrashHistoryPage(null)).toThrow('malformed private history');
    expect(() => parseCrashHistoryPage({ ...historyPage(), nextCursor: 'unsafe cursor' })).toThrow(
      'malformed private history',
    );
    expect(() =>
      parseCrashHistoryPage({
        ...historyPage(),
        data: [{ ...historyPage().data[0], receiptHref: '/v1/crash/rounds/wrong/receipt' }],
      }),
    ).toThrow('malformed private history');
    expect(() =>
      parseCrashReceipt({
        ...receipt(),
        events: [{ ...receipt().events[0], kind: 'wallet-secret-event' }],
      }),
    ).toThrow('malformed private history');
    expect(() =>
      parseCrashReceipt({
        ...receipt(),
        bindings: { ...receipt().bindings, architectureVersion: null },
      }),
    ).toThrow('malformed private history');
    expect(() =>
      parseCrashReceipt({
        ...receipt(),
        createdAt: 'not-a-date',
      }),
    ).toThrow('malformed private history');
  });
});

function historyPage() {
  return {
    data: [
      {
        createdAt: '2026-07-28T18:00:00.000Z',
        currentStage: 2,
        gameState: { committed: true, status: 'cashed-out', version: 2 },
        pot: { amount: '2000000', currency: 'USDC', decimals: 6 },
        receiptHref: `/v1/crash/rounds/${ROUND_ID}/receipt`,
        roundId: ROUND_ID,
        safeNextAction: 'retry-settlement',
        settlement: {
          finalizedOperationCount: 0,
          receiptHash: null,
          status: 'recovery-required',
        },
        terminalReason: 'PLAYER_CASH_OUT',
        updatedAt: '2026-07-28T18:00:04.000Z',
      },
    ],
    hasMore: false,
    nextCursor: null,
    schemaVersion: 'dailydraft.crash-history.v1',
  } as const;
}

function receipt() {
  return {
    bindings: {
      architectureVersion: 'architecture-v1',
      calculatorVersion: 'calculator-v1',
      custodyPolicyHash: 'c'.repeat(64),
      riskRulesHash: 'e'.repeat(64),
      riskRulesVersion: 'risk-v1',
      rulesHash: 'b'.repeat(64),
      rulesVersion: 'rules-v1',
      settlementPolicyHash: 'd'.repeat(64),
      stateMachineRulesHash: 'a'.repeat(64),
      stateMachineVersion: 'state-v1',
    },
    createdAt: '2026-07-28T18:00:00.000Z',
    custody: {
      preparedIntentCount: 1,
      recoveryRequiredIntentCount: 0,
      status: 'prepared',
    },
    events: [
      {
        amount: { amount: '1000000', currency: 'USDC', decimals: 6 },
        decision: null,
        eventId: 'transition:1',
        kind: 'round-started',
        occurredAt: '2026-07-28T18:00:00.000Z',
        reference: 'round-started',
        stage: 1,
        terminalReason: null,
      },
      {
        amount: null,
        decision: null,
        eventId: 'settlement:1',
        kind: 'settlement-recovery-required',
        occurredAt: '2026-07-28T18:00:04.000Z',
        reference: 'operation:safe-reference',
        stage: 1,
        terminalReason: 'PROVIDER_RESULT_AMBIGUOUS',
      },
    ],
    finality: {
      custody: 'not-final',
      gameState: 'committed',
      settlement: 'recovery-required',
    },
    mode: 'fixture-preview',
    network: 'solana-devnet',
    pot: { amount: '2000000', currency: 'USDC', decimals: 6 },
    privacy: {
      exposesProviderSignatures: false,
      exposesWalletAddresses: false,
    },
    roundId: ROUND_ID,
    safeNextAction: 'retry-settlement',
    schemaVersion: 'dailydraft.crash-receipt.v1',
    settlement: {
      expectedOperationCount: 1,
      finalizedOperationCount: 0,
      receiptHash: null,
      recoveryReason: 'PROVIDER_RESULT_AMBIGUOUS',
      status: 'recovery-required',
    },
    stage: 2,
    status: 'cashed-out',
    terminalAt: '2026-07-28T18:00:03.000Z',
    terminalReason: 'PLAYER_CASH_OUT',
    updatedAt: '2026-07-28T18:00:04.000Z',
    version: 2,
  };
}
