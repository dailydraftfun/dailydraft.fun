import { describe, expect, test } from 'bun:test';
import type { CrashHistoryPage, CrashReceipt } from '@dailydraft/contracts/crash-history';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  actionLabel,
  CrashHistoryOwnedSurface,
  CrashHistorySurface,
  crashHistorySessionOwner,
} from './crash-history-panel';

describe('Crash history presentation', () => {
  test('renders the authenticated empty, loading, and reconnect-safe error states', () => {
    const loading = renderSurface({ loadState: 'loading' });
    const empty = renderSurface({ loadState: 'empty' });
    const error = renderSurface({ loadState: 'error' });

    expect(loading).toContain('Syncing durable state');
    expect(loading).toContain('Checking the authenticated wallet');
    expect(empty).toContain('No runs yet');
    expect(empty).toContain('No fixture Card Streak runs exist');
    expect(error).toContain('Reconnect required');
    expect(error).toContain('Existing game state remains server-owned and unchanged');
    expect(error).toContain('Retry history');
  });

  test('requires wallet authentication without suggesting public discovery', () => {
    const markup = renderSurface({ authenticated: false });

    expect(markup).toContain('Wallet authentication required');
    expect(markup).toContain('No other wallet’s rounds are discoverable');
    expect(markup).not.toContain('Verify receipt');
  });

  test('suppresses wallet A state during the render that switches to wallet B', () => {
    const walletA = crashHistorySessionOwner('wallet-a', 'session-a');
    const walletB = crashHistorySessionOwner('wallet-b', 'session-b');
    const markup = renderToStaticMarkup(
      <CrashHistoryOwnedSurface
        loadState="ready"
        onLoadMore={() => undefined}
        onOpenReceipt={() => undefined}
        onRefresh={() => undefined}
        page={page()}
        receipt={receipt()}
        receiptState="ready"
        sessionOwner={walletB}
        stateOwner={walletA}
      />,
    );

    expect(markup).toContain('No history shown');
    expect(markup).not.toContain('crashround_panelhistory01');
    expect(markup).not.toContain('Committed game ledger');
  });

  test('renders committed, custody, and settlement finality as separate facts', () => {
    const markup = renderSurface({
      loadState: 'ready',
      page: page(),
      receipt: receipt(),
      receiptState: 'ready',
    });

    expect(markup).toContain('Settlement disputed');
    expect(markup).toContain('recovery-required');
    expect(markup).toContain('Retry settlement reconciliation');
    expect(markup).toContain('Custody: not-final · Settlement: recovery-required');
    expect(markup).toContain('Provider signatures and wallet addresses are intentionally excluded');
    expect(markup).toContain('PROVIDER RESULT AMBIGUOUS');
    expect(markup).toContain('Deadline scheduled');
    expect(markup).toContain('2026-07-28T18:00:31.000Z');
    expect(markup).toContain('Load older runs');
  });

  test.each([
    ['active', 'Run in progress'],
    ['cash-out', 'Cash-out committed'],
    ['bust', 'Run busted'],
    ['timed-out', 'Deadline forfeit committed'],
    ['recovering', 'Settlement recovering'],
    ['disputed', 'Settlement disputed'],
    ['refunded', 'Refund finalized'],
    ['failed', 'Settlement action failed'],
  ] as const)('renders the %s durable resolution state', (resolution, label) => {
    const history = page();
    const item = history.data[0];
    if (!item) throw new Error('history fixture required');
    item.resolution = resolution;
    if (resolution === 'active') {
      item.decisionDeadline = '2026-07-28T18:00:30.000Z';
    }

    const markup = renderSurface({ loadState: 'ready', page: history });

    expect(markup).toContain(label);
    if (resolution === 'active') {
      expect(markup).toContain('Decision due');
      expect(markup).toContain('2026-07-28T18:00:30.000Z');
    }
  });

  test('renders receipt loading and failure without claiming finality', () => {
    const loading = renderSurface({
      loadState: 'ready',
      page: page(),
      receiptState: 'loading',
    });
    const error = renderSurface({
      loadState: 'ready',
      page: page(),
      receiptState: 'error',
    });

    expect(loading).toContain('Verifying the durable ledger');
    expect(error).toContain('receipt could not be verified');
    expect(error).not.toContain('Committed game ledger');
  });

  test('names every safe next action in player language', () => {
    expect(actionLabel('choose-action')).toBe('Choose the next stage action');
    expect(actionLabel('reconnect')).toBe('Reconnect to restore the current deadline');
    expect(actionLabel('retry-settlement')).toBe('Retry settlement reconciliation');
    expect(actionLabel('review-receipt')).toBe('Review the verified receipt');
    expect(actionLabel('wait-for-settlement')).toBe('Wait for settlement finality');
  });
});

function renderSurface({
  authenticated = true,
  loadState = 'empty',
  page: history = null,
  receipt: selected = null,
  receiptState = 'empty',
}: Partial<Parameters<typeof CrashHistorySurface>[0]> = {}) {
  return renderToStaticMarkup(
    <CrashHistorySurface
      authenticated={authenticated}
      loadState={loadState}
      onLoadMore={() => undefined}
      onOpenReceipt={() => undefined}
      onRefresh={() => undefined}
      page={history}
      receipt={selected}
      receiptState={receiptState}
    />,
  );
}

function page(): CrashHistoryPage {
  return {
    data: [
      {
        createdAt: '2026-07-28T18:00:00.000Z',
        currentStage: 2,
        decisionDeadline: null,
        gameState: { committed: true, status: 'cashed-out', version: 2 },
        pot: { amount: '2500000', currency: 'USDC', decimals: 6 },
        receiptHref: '/v1/crash/rounds/crashround_panelhistory01/receipt',
        resolution: 'disputed',
        roundId: 'crashround_panelhistory01',
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
    hasMore: true,
    nextCursor: 'v1.c2FmZQ',
    schemaVersion: 'dailydraft.crash-history.v1',
  };
}

function receipt(): CrashReceipt {
  return {
    bindings: {
      architectureVersion: 'architecture-v1',
      calculatorVersion: 'calculator-v1',
      custodyPolicyHash: 'c'.repeat(64),
      custodyPolicyVersion: 'custody-v1',
      inventoryPolicyHash: 'f'.repeat(64),
      inventoryPolicyVersion: 'inventory-v1',
      riskRulesHash: 'e'.repeat(64),
      riskRulesVersion: 'risk-v1',
      rulesHash: 'b'.repeat(64),
      rulesVersion: 'rules-v1',
      settlementPolicyHash: 'd'.repeat(64),
      settlementPolicyVersion: 'settlement-v1',
      stateMachineRulesHash: 'a'.repeat(64),
      stateMachineVersion: 'state-v1',
    },
    createdAt: '2026-07-28T18:00:00.000Z',
    decisionDeadline: null,
    custody: {
      preparedIntentCount: 1,
      recoveryRequiredIntentCount: 0,
      status: 'prepared',
    },
    events: [
      {
        amount: { amount: '2500000', currency: 'USDC', decimals: 6 },
        decision: 'continue',
        eventId: 'transition:2',
        kind: 'stage-continued',
        occurredAt: '2026-07-28T18:00:01.000Z',
        reference: `crashref_${'1'.repeat(32)}`,
        scheduledDeadline: '2026-07-28T18:00:31.000Z',
        stage: 2,
        terminalReason: null,
      },
      {
        amount: null,
        decision: null,
        eventId: 'settlement:1',
        kind: 'settlement-recovery-required',
        occurredAt: '2026-07-28T18:00:04.000Z',
        reference: `crashref_${'2'.repeat(32)}`,
        scheduledDeadline: null,
        stage: 2,
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
    pot: { amount: '2500000', currency: 'USDC', decimals: 6 },
    privacy: {
      exposesProviderSignatures: false,
      exposesWalletAddresses: false,
    },
    roundId: 'crashround_panelhistory01',
    resolution: 'disputed',
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
