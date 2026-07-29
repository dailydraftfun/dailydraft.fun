import { afterEach, describe, expect, test } from 'bun:test';
import {
  getOperatorTreasurySummary,
  type OperatorTreasurySummary,
} from './operator-treasury-client';

const originalApiUrl = process.env.DAILYDRAFT_API_URL;
const originalDuelApiUrl = process.env.NEXT_PUBLIC_DUEL_API_URL;
const originalApiKey = process.env.DAILYDRAFT_OPERATOR_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  restoreEnv('DAILYDRAFT_API_URL', originalApiUrl);
  restoreEnv('NEXT_PUBLIC_DUEL_API_URL', originalDuelApiUrl);
  restoreEnv('DAILYDRAFT_OPERATOR_API_KEY', originalApiKey);
  globalThis.fetch = originalFetch;
});

describe('operator treasury client', () => {
  test('fetches the read-only summary with the dedicated server credential', async () => {
    process.env.DAILYDRAFT_API_URL = 'https://api.dailydraft.test/';
    process.env.DAILYDRAFT_OPERATOR_API_KEY = '  operator-read  ';
    let request: { input: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { input: String(input), init };
      return Response.json(summary());
    }) as unknown as typeof fetch;

    await expect(getOperatorTreasurySummary()).resolves.toEqual(summary());
    expect(request?.input).toBe('https://api.dailydraft.test/admin/treasury');
    expect(request?.init?.cache).toBe('no-store');
    expect(request?.init?.headers).toEqual({ authorization: 'Bearer operator-read' });
    expect(request?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('uses the existing duel API URL only when the server API URL is absent', async () => {
    delete process.env.DAILYDRAFT_API_URL;
    process.env.NEXT_PUBLIC_DUEL_API_URL = 'https://fallback.dailydraft.test/';
    process.env.DAILYDRAFT_OPERATOR_API_KEY = 'operator-read';
    let requestedUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return Response.json(summary());
    }) as unknown as typeof fetch;

    await getOperatorTreasurySummary();

    expect(requestedUrl).toBe('https://fallback.dailydraft.test/admin/treasury');
  });

  test('fails closed before a request when the dashboard is not configured', async () => {
    delete process.env.DAILYDRAFT_API_URL;
    delete process.env.NEXT_PUBLIC_DUEL_API_URL;
    delete process.env.DAILYDRAFT_OPERATOR_API_KEY;
    let requested = false;
    globalThis.fetch = (async () => {
      requested = true;
      return Response.json(summary());
    }) as unknown as typeof fetch;

    await expect(getOperatorTreasurySummary()).rejects.toThrow(
      'Operator treasury dashboard is not configured.',
    );
    expect(requested).toBe(false);
  });

  test('surfaces a bounded status-only error when the API rejects the request', async () => {
    process.env.DAILYDRAFT_API_URL = 'https://api.dailydraft.test';
    process.env.DAILYDRAFT_OPERATOR_API_KEY = 'operator-read';
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;

    await expect(getOperatorTreasurySummary()).rejects.toThrow(
      'Operator treasury summary is unavailable (503).',
    );
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function summary(): OperatorTreasurySummary {
  return {
    configuration: {
      errors: [],
      houseEnabled: true,
      network: 'solana-devnet',
      separationOfDuties: true,
    },
    inventory: {
      concentration: { largestAssetBasisPoints: 0, uniqueAssets: 0 },
      heldAssets: 0,
      heldValueAmount: '0',
      realizedCostAmount: '0',
      realizedPnlAmount: '0',
      realizedProceedsAmount: '0',
    },
    liquidity: {
      availableAmount: '1000000',
      balanceAmount: '1000000',
      decimals: 6,
      delegatedAmount: '1000000',
      minimumAmount: '0',
      snapshotFresh: true,
      verifiedAt: '2026-07-29T10:00:00.000Z',
    },
    pendingGames: 0,
    pendingGamesByStatus: {},
    ready: true,
    reconciliation: {
      discrepancies: [],
      observedSlot: '481516',
      verifiedAt: '2026-07-29T10:00:00.000Z',
    },
    risk: {
      dailyLossAmount: '0',
      dailyLossLimitAmount: '1000000',
      disableReasons: [],
      maxTotalExposureAmount: '1000000',
      tierAdmissionStates: [],
      tiers: [],
      totalExposureAmount: '0',
    },
  };
}
