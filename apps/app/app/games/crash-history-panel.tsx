'use client';

import type {
  CrashHistoryItem,
  CrashHistoryPage,
  CrashReceipt,
} from '@dailydraft/contracts/crash-history';
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWalletAuth } from '../solana/wallet-auth-provider';
import { getCrashHistory, getCrashReceipt } from './crash-history-client';
import { CrashHistorySessionGuard } from './crash-history-session-guard';

export type CrashHistoryLoadState = 'empty' | 'error' | 'loading' | 'ready';

// Browser effects and state transitions are exercised through the transport
// and pure presentation contracts because Bun's server renderer has no DOM.
/* istanbul ignore next */
export function CrashHistoryPanel() {
  const authentication = useWalletAuth();
  const [page, setPage] = useState<CrashHistoryPage | null>(null);
  const [receipt, setReceipt] = useState<CrashReceipt | null>(null);
  const [loadState, setLoadState] = useState<CrashHistoryLoadState>('empty');
  const [receiptState, setReceiptState] = useState<CrashHistoryLoadState>('empty');
  const requestGuard = useRef(new CrashHistorySessionGuard());
  const sessionToken = authentication.sessionToken;
  const sessionOwner = crashHistorySessionOwner(authentication.walletAddress, sessionToken);
  const [stateOwner, setStateOwner] = useState(sessionOwner);

  const refresh = useCallback(async () => {
    if (!sessionToken) {
      return;
    }
    const request = requestGuard.current.begin('history');
    setLoadState('loading');
    try {
      const next = await getCrashHistory(sessionToken, null, request.signal);
      if (!requestGuard.current.isCurrent(request)) return;
      setPage(next);
      setLoadState(next.data.length ? 'ready' : 'empty');
    } catch {
      if (!requestGuard.current.isCurrent(request)) return;
      setLoadState('error');
    }
  }, [sessionToken]);

  useEffect(() => {
    requestGuard.current.switchSession();
    setPage(null);
    setReceipt(null);
    setLoadState('empty');
    setReceiptState('empty');
    setStateOwner(sessionOwner);
    if (sessionOwner) void refresh();
    return () => {
      requestGuard.current.switchSession();
    };
  }, [refresh, sessionOwner]);

  useEffect(() => {
    const reconnect = () => void refresh();
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [refresh]);

  async function loadMore(): Promise<void> {
    if (!sessionToken || !page?.nextCursor) return;
    const request = requestGuard.current.begin('history');
    setLoadState('loading');
    try {
      const next = await getCrashHistory(sessionToken, page.nextCursor, request.signal);
      if (!requestGuard.current.isCurrent(request)) return;
      const known = new Set(page.data.map(({ roundId }) => roundId));
      setPage({
        ...next,
        data: [...page.data, ...next.data.filter(({ roundId }) => !known.has(roundId))],
      });
      setLoadState('ready');
    } catch {
      if (!requestGuard.current.isCurrent(request)) return;
      setLoadState('error');
    }
  }

  async function openReceipt(item: CrashHistoryItem): Promise<void> {
    if (!sessionToken) return;
    const request = requestGuard.current.begin('receipt');
    setReceiptState('loading');
    try {
      const next = await getCrashReceipt(item.roundId, sessionToken, request.signal);
      if (!requestGuard.current.isCurrent(request)) return;
      setReceipt(next);
      setReceiptState('ready');
    } catch {
      if (!requestGuard.current.isCurrent(request)) return;
      setReceipt(null);
      setReceiptState('error');
    }
  }

  return (
    <CrashHistoryOwnedSurface
      loadState={loadState}
      onLoadMore={() => void loadMore()}
      onOpenReceipt={(item) => void openReceipt(item)}
      onRefresh={() => void refresh()}
      page={page}
      receipt={receipt}
      receiptState={receiptState}
      sessionOwner={sessionOwner}
      stateOwner={stateOwner}
    />
  );
}

export function CrashHistoryOwnedSurface({
  loadState,
  onLoadMore,
  onOpenReceipt,
  onRefresh,
  page,
  receipt,
  receiptState,
  sessionOwner,
  stateOwner,
}: Omit<Parameters<typeof CrashHistorySurface>[0], 'authenticated'> & {
  sessionOwner: string | null;
  stateOwner: string | null;
}) {
  const ownsSession = sessionOwner !== null && sessionOwner === stateOwner;
  return (
    <CrashHistorySurface
      authenticated={sessionOwner !== null}
      loadState={ownsSession ? loadState : 'empty'}
      onLoadMore={onLoadMore}
      onOpenReceipt={onOpenReceipt}
      onRefresh={onRefresh}
      page={ownsSession ? page : null}
      receipt={ownsSession ? receipt : null}
      receiptState={ownsSession ? receiptState : 'empty'}
    />
  );
}

export function crashHistorySessionOwner(
  walletAddress: string | null,
  sessionToken: string | null,
): string | null {
  return walletAddress && sessionToken ? `${walletAddress}:${sessionToken}` : null;
}

export function CrashHistorySurface({
  authenticated,
  loadState,
  onLoadMore,
  onOpenReceipt,
  onRefresh,
  page,
  receipt,
  receiptState,
}: {
  authenticated: boolean;
  loadState: CrashHistoryLoadState;
  onLoadMore: () => void;
  onOpenReceipt: (item: CrashHistoryItem) => void;
  onRefresh: () => void;
  page: CrashHistoryPage | null;
  receipt: CrashReceipt | null;
  receiptState: CrashHistoryLoadState;
}) {
  return (
    <section aria-labelledby="crash-history-title" className="proof-panel">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="proof-label flex items-center gap-2">
            <ClockCounterClockwiseIcon aria-hidden="true" size={15} />
            Private wallet history
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-primary" id="crash-history-title">
            Resume every Card Streak run.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">
            Game commitment, custody progress, and settlement finality stay separate. Recovery
            states never imply that a card or payout is already yours.
          </p>
        </div>
        <HistoryStatus authenticated={authenticated} state={loadState} />
      </div>

      {!authenticated ? (
        <div className="mt-5 rounded-xl border border-border bg-secondary p-5" role="status">
          <p className="text-sm font-semibold text-primary">Wallet authentication required</p>
          <p className="mt-2 text-sm leading-6 text-secondary">
            Connect and sign in from the wallet control to read your private fixture history. No
            other wallet’s rounds are discoverable.
          </p>
        </div>
      ) : page?.data.length ? (
        <ol className="mt-5 grid gap-3">
          {page.data.map((item) => (
            <li
              className="grid gap-4 rounded-xl border border-border bg-secondary p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              key={item.roundId}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="proof-label">Stage {item.currentStage}</span>
                  <FinalityBadge status={item.settlement.status} />
                  <time className="text-xs text-muted" dateTime={item.updatedAt}>
                    {formatTimestamp(item.updatedAt)}
                  </time>
                </div>
                <p className="mt-2 text-base font-semibold text-primary">
                  {statusLabel(item.gameState.status)}
                </p>
                <p className="mt-1 text-sm text-secondary">
                  {formatMoney(item.pot.amount)} · {actionLabel(item.safeNextAction)}
                </p>
                <p className="mt-2 truncate font-mono text-[11px] text-muted">{item.roundId}</p>
              </div>
              <button
                className="proof-secondary-action gap-2"
                onClick={() => onOpenReceipt(item)}
                type="button"
              >
                <ReceiptIcon aria-hidden="true" size={15} />
                Verify receipt
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <HistoryEmpty state={loadState} />
      )}

      {page?.hasMore ? (
        <button
          className="proof-secondary-action mt-4 gap-2"
          disabled={loadState === 'loading'}
          onClick={onLoadMore}
          type="button"
        >
          <CaretDownIcon aria-hidden="true" size={15} />
          Load older runs
        </button>
      ) : null}

      {loadState === 'error' && authenticated ? (
        <button className="proof-secondary-action mt-4 gap-2" onClick={onRefresh} type="button">
          <ArrowClockwiseIcon aria-hidden="true" size={15} />
          Retry history
        </button>
      ) : null}

      <ReceiptDetail receipt={receipt} state={receiptState} />
    </section>
  );
}

function ReceiptDetail({
  receipt,
  state,
}: {
  receipt: CrashReceipt | null;
  state: CrashHistoryLoadState;
}) {
  if (state === 'empty') return null;
  if (state === 'loading') {
    return (
      <p className="mt-5 flex items-center gap-2 text-sm text-secondary" role="status">
        <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" size={16} />
        Verifying the durable ledger…
      </p>
    );
  }
  if (state === 'error' || !receipt) {
    return (
      <p className="mt-5 text-sm text-warning" role="alert">
        The receipt could not be verified. Retry from the history row after reconnecting.
      </p>
    );
  }
  return (
    <article
      className="mt-6 rounded-xl border border-lime/20 bg-lime/5 p-5"
      aria-label="Crash receipt"
    >
      <div className="flex items-start gap-3">
        <ShieldCheckIcon className="mt-0.5 shrink-0 text-lime" size={21} weight="fill" />
        <div>
          <p className="text-sm font-semibold text-primary">Committed game ledger</p>
          <p className="mt-1 text-xs leading-5 text-secondary">
            Custody: {receipt.finality.custody} · Settlement: {receipt.finality.settlement}.
            Provider signatures and wallet addresses are intentionally excluded.
          </p>
        </div>
      </div>
      <dl className="proof-definition-list mt-5">
        <div>
          <dt>Rules hash</dt>
          <dd className="truncate font-mono">{receipt.bindings.rulesHash}</dd>
        </div>
        <div>
          <dt>Risk hash</dt>
          <dd className="truncate font-mono">{receipt.bindings.riskRulesHash}</dd>
        </div>
        <div>
          <dt>Receipt hash</dt>
          <dd className="truncate font-mono">
            {receipt.settlement.receiptHash ?? 'Not finalized'}
          </dd>
        </div>
        <div>
          <dt>Safe next action</dt>
          <dd>{actionLabel(receipt.safeNextAction)}</dd>
        </div>
      </dl>
      <ol className="mt-5 grid gap-2">
        {receipt.events.map((event) => (
          <li className="rounded-lg border border-border bg-secondary p-3" key={event.eventId}>
            <div className="flex flex-wrap justify-between gap-2">
              <strong className="text-xs text-primary">{event.kind.replaceAll('-', ' ')}</strong>
              <time className="text-[11px] text-muted" dateTime={event.occurredAt}>
                {formatTimestamp(event.occurredAt)}
              </time>
            </div>
            <p className="mt-1 text-xs text-secondary">
              Stage {event.stage}
              {event.amount ? ` · ${formatMoney(event.amount.amount)}` : ''}
              {event.decision ? ` · ${event.decision}` : ''}
              {event.terminalReason ? ` · ${event.terminalReason.replaceAll('_', ' ')}` : ''}
            </p>
            <p className="mt-1 truncate font-mono text-[10px] text-muted">{event.reference}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}

function HistoryStatus({
  authenticated,
  state,
}: {
  authenticated: boolean;
  state: CrashHistoryLoadState;
}) {
  const content = !authenticated
    ? { icon: <ReceiptIcon size={15} />, label: 'Sign in to restore', tone: 'text-secondary' }
    : state === 'loading'
      ? {
          icon: <SpinnerGapIcon className="animate-spin motion-reduce:animate-none" size={15} />,
          label: 'Syncing durable state',
          tone: 'text-secondary',
        }
      : state === 'error'
        ? {
            icon: <WarningCircleIcon size={15} weight="fill" />,
            label: 'Reconnect required',
            tone: 'text-warning',
          }
        : {
            icon: <CheckCircleIcon size={15} weight="fill" />,
            label: state === 'ready' ? 'History current' : 'No runs yet',
            tone: 'text-lime',
          };
  return (
    <p
      aria-live="polite"
      className={`flex min-h-10 w-fit items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-semibold ${content.tone}`}
      role="status"
    >
      {content.icon}
      {content.label}
    </p>
  );
}

function HistoryEmpty({ state }: { state: CrashHistoryLoadState }) {
  const copy =
    state === 'loading'
      ? 'Checking the authenticated wallet for resumable runs.'
      : state === 'error'
        ? 'History could not be refreshed. Existing game state remains server-owned and unchanged.'
        : 'No fixture Card Streak runs exist for this wallet yet.';
  return (
    <div className="mt-5 rounded-xl border border-border bg-secondary p-5" role="status">
      <p className="text-sm font-semibold text-primary">No history shown</p>
      <p className="mt-2 text-sm leading-6 text-secondary">{copy}</p>
    </div>
  );
}

function FinalityBadge({ status }: { status: CrashHistoryItem['settlement']['status'] }) {
  return (
    <span
      className={
        status === 'settled'
          ? 'rounded-full border border-lime/20 bg-lime/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-lime'
          : 'rounded-full border border-warning/20 bg-warning/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-warning'
      }
    >
      {status}
    </span>
  );
}

export function actionLabel(action: CrashHistoryItem['safeNextAction']): string {
  return {
    'choose-action': 'Choose the next stage action',
    reconnect: 'Reconnect to restore the current deadline',
    'retry-settlement': 'Retry settlement reconciliation',
    'review-receipt': 'Review the verified receipt',
    'wait-for-settlement': 'Wait for settlement finality',
  }[action];
}

function statusLabel(status: CrashHistoryItem['gameState']['status']): string {
  return {
    active: 'Run in progress',
    busted: 'Run busted',
    'cashed-out': 'Cash-out committed',
    completed: 'All stages completed',
    defaulted: 'Deadline forfeit committed',
  }[status];
}

function formatMoney(amount: string): string {
  const minor = BigInt(amount);
  const major = minor / 1_000_000n;
  const decimal = (minor % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${major}${decimal ? `.${decimal}` : ''} fixture USDC`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}
