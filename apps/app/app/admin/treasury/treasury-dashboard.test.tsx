import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  type OperatorTreasurySummary,
  operatorDashboardAuthorized,
} from './operator-treasury-client';
import { TreasuryDashboard } from './treasury-dashboard';

describe('operator treasury dashboard', () => {
  test('separates a healthy canonical ledger from finalized Solana evidence', () => {
    const html = render(fixture());

    expect(html).toContain('data-treasury-state="healthy"');
    expect(html).toContain('Canonical ledger');
    expect(html).toContain('Finalized Solana evidence');
    expect(html).toContain('Reconciled and within limits');
    expect(html).toContain('150 USDC');
    expect(html).toContain('+15 USDC');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
  });

  test('presents stale evidence without an unsafe corrective action', () => {
    const summary = fixture();
    summary.liquidity.snapshotFresh = false;
    summary.ready = false;

    const html = render(summary);

    expect(html).toContain('The finalized Solana treasury observation is stale.');
    expect(html).toContain('Snapshot freshness');
    expect(html).toContain('Stale');
    expect(html).toContain('No corrective action is available here.');
    expect(html).not.toContain('Reconcile now');
  });

  test('shows durable expected-versus-observed reconciliation evidence', () => {
    const summary = fixture();
    summary.reconciliation.discrepancies = [
      {
        detail: 'Finalized treasury balance differs from append-only ledger movement',
        entityReference: 'solana-devnet-usdc',
        expectedValue: '210000000',
        firstObservedAt: '2026-07-29T10:00:00.000Z',
        kind: 'treasury_balance',
        lastObservedAt: '2026-07-29T10:05:00.000Z',
        observedSlot: '481516',
        observedValue: '200000000',
      },
    ];

    const html = render(summary);

    expect(html).toContain('1 unresolved reconciliation discrepancy.');
    expect(html).toContain('Reconciliation discrepancies');
    expect(html).toContain('210000000');
    expect(html).toContain('200000000');
    expect(html).toContain('481516');
  });

  test('renders an explicit empty state before the first observation', () => {
    const summary = fixture();
    summary.inventory.heldAssets = 0;
    summary.inventory.heldValueAmount = '0';
    summary.liquidity.balanceAmount = null;
    summary.liquidity.delegatedAmount = null;
    summary.liquidity.snapshotFresh = false;
    summary.pendingGames = 0;
    summary.reconciliation.observedSlot = null;
    summary.reconciliation.verifiedAt = null;

    const html = render(summary);

    expect(html).toContain('No treasury observation or recorded exposure');
    expect(html).toContain('Not observed');
    expect(html).toContain('Slot not observed');
    expect(html).toContain('Never');
  });

  test('names breached limits and concentration risk', () => {
    const summary = fixture();
    summary.inventory.concentration.largestAssetBasisPoints = 7_500;
    summary.risk.disableReasons = ['daily_loss_limit', 'total_exposure_limit'];
    summary.risk.dailyLossAmount = '100000000';
    summary.risk.totalExposureAmount = '200000000';

    const html = render(summary);

    expect(html).toContain('House admission limit: daily loss limit.');
    expect(html).toContain('House admission limit: total exposure limit.');
    expect(html).toContain('75.00%');
    expect(html).toContain('100 USDC / 100 USDC');
    expect(html).toContain('200 USDC / 200 USDC');
  });

  test('uses a separate, timing-safe dashboard bearer and fails closed when unconfigured', () => {
    expect(operatorDashboardAuthorized('Bearer operator-view', 'operator-view')).toBe(true);
    expect(operatorDashboardAuthorized('Bearer operator-write', 'operator-view')).toBe(false);
    expect(operatorDashboardAuthorized(null, 'operator-view')).toBe(false);
    expect(operatorDashboardAuthorized('Bearer operator-view', undefined)).toBe(false);
  });
});

function render(summary: OperatorTreasurySummary): string {
  return renderToStaticMarkup(<TreasuryDashboard summary={summary} />);
}

function fixture(): OperatorTreasurySummary {
  return {
    configuration: {
      errors: [],
      houseEnabled: true,
      network: 'solana-devnet',
      separationOfDuties: true,
    },
    inventory: {
      concentration: {
        largestAssetBasisPoints: 2_500,
        uniqueAssets: 4,
      },
      heldAssets: 4,
      heldValueAmount: '50000000',
      realizedCostAmount: '35000000',
      realizedPnlAmount: '15000000',
      realizedProceedsAmount: '50000000',
    },
    liquidity: {
      availableAmount: '150000000',
      balanceAmount: '200000000',
      decimals: 6,
      delegatedAmount: '200000000',
      minimumAmount: '50000000',
      snapshotFresh: true,
      verifiedAt: '2026-07-29T10:05:00.000Z',
    },
    pendingGames: 2,
    pendingGamesByStatus: {
      funded: 1,
      reserved: 1,
    },
    ready: true,
    reconciliation: {
      discrepancies: [],
      observedSlot: '481516',
      verifiedAt: '2026-07-29T10:05:00.000Z',
    },
    risk: {
      dailyLossAmount: '10000000',
      dailyLossLimitAmount: '100000000',
      disableReasons: [],
      maxTotalExposureAmount: '200000000',
      tierAdmissionStates: [
        {
          disabled: false,
          evaluatedAt: '2026-07-29T10:05:00.000Z',
          reason: null,
          reenableBoundary: null,
          tier: 50,
          version: 1,
        },
      ],
      tiers: [{ pendingGames: 2, tier: 50 }],
      totalExposureAmount: '50000000',
    },
  };
}
