'use client';

import {
  CheckCircleIcon,
  ClockCountdownIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';

export type FlipPublicStatus =
  | 'acquired'
  | 'disputed'
  | 'failed'
  | 'purchase_pending'
  | 'refunded'
  | 'transfer_pending';

export interface FlipPublicReceipt {
  acquisition: {
    card: string;
    displayedValueUsd: string;
    ownership: 'confirmed' | 'unchanged';
    purchaseEvidence: 'provider_confirmed' | 'not_available';
    purchasePriceUsd: string | null;
    transferState: 'confirmed' | 'failed' | 'pending' | 'not_started';
  };
  createdAt: string;
  economics: {
    entryValueUsd: string;
    feeUsd: string;
    poolVersion: string;
  };
  id: string;
  nextAction: string;
  selection: {
    commitment: string;
    probabilityBand: string;
    proofVersion: string;
    revealedSeed: string;
  };
  status: FlipPublicStatus;
}

export const flipPublicReceipts: readonly FlipPublicReceipt[] = [
  {
    acquisition: {
      card: 'Charizard · Base Set',
      displayedValueUsd: '72.50',
      ownership: 'confirmed',
      purchaseEvidence: 'provider_confirmed',
      purchasePriceUsd: '68.75',
      transferState: 'confirmed',
    },
    createdAt: '2026-07-29T20:43:00.000Z',
    economics: { entryValueUsd: '25.00', feeUsd: '2.50', poolVersion: 'flip-pool-17' },
    id: 'flip_demo_acquired',
    nextAction: 'Keep the acquired card; listing is unavailable in this preview.',
    selection: {
      commitment: 'sha256:8f4c…18a2',
      probabilityBand: 'Chase · 7.5%',
      proofVersion: 'selection-proof-v1',
      revealedSeed: 'fixture:marketplace-flip:017',
    },
    status: 'acquired',
  },
  {
    acquisition: {
      card: 'Blastoise · Base Set',
      displayedValueUsd: '44.00',
      ownership: 'unchanged',
      purchaseEvidence: 'not_available',
      purchasePriceUsd: null,
      transferState: 'not_started',
    },
    createdAt: '2026-07-29T20:32:00.000Z',
    economics: { entryValueUsd: '25.00', feeUsd: '0.00', poolVersion: 'flip-pool-17' },
    id: 'flip_demo_purchase_pending',
    nextAction: 'Wait for purchase reconciliation; value actions remain locked.',
    selection: {
      commitment: 'sha256:aa91…604e',
      probabilityBand: 'Core · 30%',
      proofVersion: 'selection-proof-v1',
      revealedSeed: 'fixture:marketplace-flip:016',
    },
    status: 'purchase_pending',
  },
  {
    acquisition: {
      card: 'Mewtwo · Base Set',
      displayedValueUsd: '39.25',
      ownership: 'unchanged',
      purchaseEvidence: 'provider_confirmed',
      purchasePriceUsd: '36.10',
      transferState: 'pending',
    },
    createdAt: '2026-07-29T20:18:00.000Z',
    economics: { entryValueUsd: '25.00', feeUsd: '2.50', poolVersion: 'flip-pool-16' },
    id: 'flip_demo_transfer_pending',
    nextAction: 'Transfer reconciliation is active; resale stays unavailable.',
    selection: {
      commitment: 'sha256:f821…c903',
      probabilityBand: 'Core · 30%',
      proofVersion: 'selection-proof-v1',
      revealedSeed: 'fixture:marketplace-flip:015',
    },
    status: 'transfer_pending',
  },
  {
    acquisition: {
      card: 'Pikachu · Base Set',
      displayedValueUsd: '18.00',
      ownership: 'unchanged',
      purchaseEvidence: 'not_available',
      purchasePriceUsd: null,
      transferState: 'not_started',
    },
    createdAt: '2026-07-29T19:58:00.000Z',
    economics: { entryValueUsd: '15.00', feeUsd: '0.00', poolVersion: 'flip-pool-16' },
    id: 'flip_demo_refunded',
    nextAction: 'Refund recorded; no card or ownership action is available.',
    selection: {
      commitment: 'sha256:2721…7d20',
      probabilityBand: 'Floor · 62.5%',
      proofVersion: 'selection-proof-v1',
      revealedSeed: 'fixture:marketplace-flip:014',
    },
    status: 'refunded',
  },
  {
    acquisition: {
      card: 'Charizard · Base Set',
      displayedValueUsd: '71.90',
      ownership: 'unchanged',
      purchaseEvidence: 'provider_confirmed',
      purchasePriceUsd: '69.00',
      transferState: 'failed',
    },
    createdAt: '2026-07-29T19:42:00.000Z',
    economics: { entryValueUsd: '25.00', feeUsd: '0.00', poolVersion: 'flip-pool-15' },
    id: 'flip_demo_disputed',
    nextAction: 'Human review required; purchase and transfer evidence are preserved.',
    selection: {
      commitment: 'sha256:781c…d8e1',
      probabilityBand: 'Chase · 7.5%',
      proofVersion: 'selection-proof-v1',
      revealedSeed: 'fixture:marketplace-flip:013',
    },
    status: 'disputed',
  },
  {
    acquisition: {
      card: 'No card acquired',
      displayedValueUsd: '0.00',
      ownership: 'unchanged',
      purchaseEvidence: 'not_available',
      purchasePriceUsd: null,
      transferState: 'not_started',
    },
    createdAt: '2026-07-29T19:21:00.000Z',
    economics: { entryValueUsd: '25.00', feeUsd: '0.00', poolVersion: 'flip-pool-15' },
    id: 'flip_demo_failed',
    nextAction: 'Session closed without purchase; no further action is required.',
    selection: {
      commitment: 'sha256:307c…0292',
      probabilityBand: 'Not selected',
      proofVersion: 'selection-proof-v1',
      revealedSeed: 'fixture:marketplace-flip:012',
    },
    status: 'failed',
  },
] as const;

const statusLabels: Record<FlipPublicStatus, string> = {
  acquired: 'Acquired',
  disputed: 'Disputed',
  failed: 'Failed safely',
  purchase_pending: 'Purchase pending',
  refunded: 'Refunded',
  transfer_pending: 'Transfer pending',
};

export function FlipReceiptHistory() {
  const [filter, setFilter] = useState<'all' | FlipPublicStatus>('all');
  const [kept, setKept] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const selected = flipPublicReceipts[0];
  const filtered = flipPublicReceipts.filter(
    (receipt) => filter === 'all' || receipt.status === filter,
  );
  const visible = showAll ? filtered : filtered.slice(0, 3);

  return (
    <section aria-labelledby="flip-receipt-title" className="grid gap-5">
      <div className="proof-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="proof-label">Latest terminal receipt · public-safe fixture</p>
            <h2 className="mt-2 text-xl font-semibold text-primary" id="flip-receipt-title">
              Acquisition evidence
            </h2>
          </div>
          <StatusPill status={selected.status} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <ReceiptGroup
            facts={[
              ['Card', selected.acquisition.card],
              ['Displayed value', `$${selected.acquisition.displayedValueUsd}`],
              ['Purchase price', `$${selected.acquisition.purchasePriceUsd}`],
              ['Ownership', selected.acquisition.ownership],
              ['Transfer', selected.acquisition.transferState],
            ]}
            title="Acquisition"
          />
          <ReceiptGroup
            facts={[
              ['Entry', `$${selected.economics.entryValueUsd}`],
              ['Fee', `$${selected.economics.feeUsd}`],
              ['Pool snapshot', selected.economics.poolVersion],
              ['Probability band', selected.selection.probabilityBand],
            ]}
            title="Economics"
          />
          <ReceiptGroup
            facts={[
              ['Proof', selected.selection.proofVersion],
              ['Commitment', selected.selection.commitment],
              ['Revealed seed', selected.selection.revealedSeed],
              ['Purchase evidence', 'Provider-confirmed · sensitive payload redacted'],
            ]}
            title="Verification"
          />
        </div>

        <div className="mt-5 rounded-xl border border-lime/20 bg-lime/5 p-4">
          <div className="flex items-center gap-2 text-lime">
            <ShieldCheckIcon aria-hidden="true" size={18} weight="fill" />
            <strong className="text-sm">Ownership confirmed</strong>
          </div>
          <p className="mt-2 text-xs leading-5 text-secondary">{selected.nextAction}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="proof-primary-action" onClick={() => setKept(true)} type="button">
              {kept ? 'Kept in fixture collection' : 'Keep fixture card'}
            </button>
            <button
              aria-disabled="true"
              className="proof-secondary-action cursor-not-allowed opacity-60"
              type="button"
            >
              Listing unavailable
            </button>
          </div>
          {kept ? (
            <p className="mt-3 text-xs font-semibold text-lime" role="status">
              Local fixture preference saved for this preview session. No custody action occurred.
            </p>
          ) : null}
        </div>
      </div>

      <div className="proof-panel">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="proof-label">Private fixture history</p>
            <h2 className="mt-2 text-xl font-semibold text-primary">
              Every terminal path stays clear
            </h2>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-secondary">
            Receipt status
            <select
              className="min-h-10 rounded-lg border border-border bg-secondary px-3 text-sm text-primary"
              onChange={(event) => {
                setFilter(event.target.value as 'all' | FlipPublicStatus);
                setShowAll(false);
              }}
              value={filter}
            >
              <option value="all">All statuses</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 grid gap-3" data-flip-history-count={visible.length}>
          {visible.map((receipt) => (
            <article
              className="grid gap-3 rounded-xl border border-border bg-secondary p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              data-flip-receipt-status={receipt.status}
              key={receipt.id}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={receipt.status} />
                  <span className="font-mono text-[11px] text-muted">{receipt.id}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-primary">
                  {receipt.acquisition.card}
                </p>
                <p className="mt-1 text-xs leading-5 text-secondary">{receipt.nextAction}</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:text-right">
                <div>
                  <dt className="text-muted">Entry</dt>
                  <dd className="font-mono text-primary">${receipt.economics.entryValueUsd}</dd>
                </div>
                <div>
                  <dt className="text-muted">Transfer</dt>
                  <dd className="capitalize text-primary">
                    {receipt.acquisition.transferState.replaceAll('_', ' ')}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>

        {!showAll && filtered.length > 3 ? (
          <button
            className="proof-secondary-action mt-4 gap-2"
            onClick={() => setShowAll(true)}
            type="button"
          >
            <ReceiptIcon aria-hidden="true" size={16} />
            Load older receipts
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ReceiptGroup({
  facts,
  title,
}: {
  facts: ReadonlyArray<readonly [string, string]>;
  title: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
      <dl className="proof-definition-list mt-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StatusPill({ status }: { status: FlipPublicStatus }) {
  const Icon =
    status === 'acquired' || status === 'refunded'
      ? CheckCircleIcon
      : status === 'purchase_pending' || status === 'transfer_pending'
        ? ClockCountdownIcon
        : WarningCircleIcon;
  const tone =
    status === 'acquired' || status === 'refunded'
      ? 'border-lime/25 bg-lime/5 text-lime'
      : status === 'purchase_pending' || status === 'transfer_pending'
        ? 'border-amber/25 bg-amber/5 text-amber'
        : 'border-warning/25 bg-warning/5 text-warning';

  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone}`}
    >
      <Icon aria-hidden="true" size={14} weight="fill" />
      {statusLabels[status]}
    </span>
  );
}
