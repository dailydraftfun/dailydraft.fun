import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

let requestAuthorization: string | null = null;

mock.module('next/headers', () => ({
  headers: async () => new Headers({ authorization: requestAuthorization ?? '' }),
}));

const { default: OperatorTreasuryPage, dynamic, metadata } = await import('./page');

describe('operator treasury page contract', () => {
  test('publishes a dynamic, no-index operator surface', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(metadata.title).toBe('House treasury operations — DailyDraft');
    expect(metadata.description).toContain('Read-only canonical House treasury');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });

  test('renders treasury evidence only for the dedicated dashboard bearer', async () => {
    const originalToken = process.env.DAILYDRAFT_OPERATOR_DASHBOARD_TOKEN;
    const originalApiUrl = process.env.DAILYDRAFT_API_URL;
    const originalApiKey = process.env.DAILYDRAFT_OPERATOR_API_KEY;
    const originalFetch = globalThis.fetch;
    requestAuthorization = 'Bearer operator-view';
    process.env.DAILYDRAFT_OPERATOR_DASHBOARD_TOKEN = 'operator-view';
    process.env.DAILYDRAFT_API_URL = 'https://api.dailydraft.test';
    process.env.DAILYDRAFT_OPERATOR_API_KEY = 'operator-read';
    globalThis.fetch = (async () =>
      Response.json({
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
      })) as unknown as typeof fetch;

    try {
      const markup = renderToStaticMarkup(await OperatorTreasuryPage());

      expect(markup).toContain('Canonical treasury');
      expect(markup).toContain('Canonical ledger');
      expect(markup).not.toContain('<button');
    } finally {
      requestAuthorization = null;
      restoreEnv('DAILYDRAFT_OPERATOR_DASHBOARD_TOKEN', originalToken);
      restoreEnv('DAILYDRAFT_API_URL', originalApiUrl);
      restoreEnv('DAILYDRAFT_OPERATOR_API_KEY', originalApiKey);
      globalThis.fetch = originalFetch;
    }
  });

  test('returns the framework not-found boundary without the dashboard bearer', async () => {
    const originalToken = process.env.DAILYDRAFT_OPERATOR_DASHBOARD_TOKEN;
    requestAuthorization = null;
    process.env.DAILYDRAFT_OPERATOR_DASHBOARD_TOKEN = 'operator-view';

    try {
      await expect(OperatorTreasuryPage()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    } finally {
      restoreEnv('DAILYDRAFT_OPERATOR_DASHBOARD_TOKEN', originalToken);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
