import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { cache } from 'react';
import { buildDuelMetadata, receiptTitle } from '../duel-metadata';
import { DuelProofRefresh } from '../duel-proof-refresh';
import {
  type DuelReceiptPresentation,
  getDuelReceiptPresentation,
} from '../duel-receipt-presentation';
import {
  fetchPublicDuelReceipt,
  formatPublicMoney,
  type PublicDuelReceipt,
  type PublicDuelStatus,
  type PublicPostDuelCardActionState,
  publicReceiptDownloadUrl,
} from '../public-proof-client';

type DuelPageProps = { params: Promise<{ duelId: string }> };

const getReceipt = cache(fetchPublicDuelReceipt);
const terminalStatuses = new Set<PublicDuelStatus>([
  'cancelled',
  'expired',
  'failed',
  'refunded',
  'settled',
]);

export async function generateMetadata({ params }: DuelPageProps): Promise<Metadata> {
  const { duelId } = await params;
  const receipt = await getReceipt(duelId);
  if (!receipt) {
    return {
      title: 'Duel proof unavailable — Pack Duel',
      robots: { follow: false, index: false, nocache: true },
    };
  }
  return buildDuelMetadata(receipt);
}

export default async function DuelPage({ params }: DuelPageProps) {
  const { duelId } = await params;
  const receipt = await getReceipt(duelId);
  if (!receipt) return <UnavailableProof duelId={duelId} />;

  const active = !terminalStatuses.has(receipt.duel.status);
  const canonicalOrigin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://openpacksduel.vercel.app';
  const canonicalUrl = `${canonicalOrigin}/duel/${encodeURIComponent(receipt.duel.id)}`;
  const shareUrl = `https://x.com/intent/post?${new URLSearchParams({
    text: `${receiptTitle(receipt)} · ${receipt.pack.name}`,
    url: canonicalUrl,
  }).toString()}`;
  const presentation = getDuelReceiptPresentation(receipt);

  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <article className="receipt-artifact">
        <header className="receipt-artifact-header">
          <div className="min-w-0">
            <p className="receipt-serial">
              Pack Duel receipt · {receipt.duel.id} · {receipt.duel.network}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span
                className="receipt-status"
                style={{
                  backgroundColor: `${presentation.accent}14`,
                  borderColor: `${presentation.accent}59`,
                  color: presentation.accent,
                }}
              >
                {presentation.badge}
              </span>
              <span className="text-xs font-semibold capitalize text-secondary">
                {presentation.statusLabel}
              </span>
            </div>
          </div>
          <DuelProofRefresh active={active} />
        </header>

        <section className="receipt-hero">
          <div className="max-w-3xl">
            <p className="receipt-kicker">
              {receipt.result ? 'Committed duel result' : 'Durable duel state'}
            </p>
            <h1>{presentation.headline}</h1>
            <p className="receipt-hero-subline">{presentation.subline}</p>
            <p className="receipt-pack-line">
              {receipt.pack.name} · {formatPublicMoney(receipt.pack.tier)}
            </p>
            <p className="mt-2 text-sm font-semibold text-primary">
              {receipt.participants.creator.display} vs{' '}
              {receipt.participants.opponent?.display ?? 'open seat'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="proof-primary-action" href={receipt.actions.primary.href}>
              {receipt.actions.primary.label}
            </Link>
            <a className="proof-secondary-action" href={shareUrl} target="_blank" rel="noreferrer">
              Share receipt
            </a>
          </div>
        </section>

        {receipt.result ? (
          <ResultArtifact receipt={receipt} presentation={presentation} />
        ) : (
          <StatusArtifact receipt={receipt} presentation={presentation} />
        )}

        <FinalityNotice presentation={presentation} />
      </article>

      {!receipt.availability.complete ? (
        <section className="rounded-xl border border-warning/30 bg-warning/5 p-5">
          <p className="receipt-kicker text-warning">Partial receipt</p>
          <p className="mt-2 text-sm leading-6 text-secondary">
            Durable state is available, but these proof fields are still missing:{' '}
            {receipt.availability.missing.join(', ')}.
          </p>
        </section>
      ) : null}

      <VerificationDrawer receipt={receipt} />
    </main>
  );
}

function ResultArtifact({
  presentation,
  receipt,
}: {
  presentation: DuelReceiptPresentation;
  receipt: PublicDuelReceipt;
}) {
  const result = receipt.result;
  if (!result) return null;

  return (
    <section aria-label="Duel result">
      <div className="receipt-scoreboard">
        <ResultMetric
          label={result.winner ? 'Winner' : 'Result'}
          value={result.winner?.display ?? 'Tie'}
        />
        <ResultMetric accent label="Total haul" value={formatPublicMoney(result.totalValue)} />
        <ResultMetric
          accent={Boolean(result.winner)}
          label={result.winner ? 'Winning margin' : 'Margin'}
          value={formatPublicMoney(result.margin)}
        />
      </div>

      {presentation.mockPreview ? (
        <p className="receipt-preview-note">
          Devnet mock values test the reveal and comparison flow only. No purchased card,
          transferred NFT, or settled prize is represented.
        </p>
      ) : null}

      <div className="receipt-pulls">
        {result.outcomes.map((outcome) => {
          const outcomeState = presentation.outcomeStates.find(
            (candidate) => candidate.side === outcome.side,
          );
          const actionState = receipt.cardActions.cards.find(
            (candidate) => candidate.side === outcome.side,
          );
          return (
            <article
              key={outcome.side}
              className={
                outcomeState?.label === 'Winner'
                  ? 'receipt-pull receipt-pull-winner'
                  : 'receipt-pull'
              }
            >
              <div className="receipt-pull-heading">
                <div>
                  <p className="receipt-kicker">{outcomeState?.label ?? outcome.side}</p>
                  <p className="mt-1 text-sm font-semibold text-secondary">
                    {outcome.side === 'creator'
                      ? receipt.participants.creator.display
                      : (receipt.participants.opponent?.display ?? 'Opponent')}
                  </p>
                </div>
                <strong>{formatPublicMoney(outcome.insuredValue)}</strong>
              </div>
              {outcome.imageUrl ? (
                <div className="receipt-pull-image">
                  <Image
                    alt={outcome.displayName}
                    fill
                    sizes="(min-width: 768px) 360px, 88vw"
                    src={outcome.imageUrl}
                  />
                </div>
              ) : (
                <div className="receipt-pull-placeholder" aria-hidden="true">
                  <span>Verified pull</span>
                  <strong>PACK DUEL</strong>
                </div>
              )}
              <h2>{outcome.displayName}</h2>
              {actionState ? <CardActionState state={actionState} /> : null}
            </article>
          );
        })}
      </div>

      {receipt.cardActions.availability === 'hidden' ? (
        <p className="receipt-action-gate">{cardActionGateMessage(receipt.cardActions.reason)}</p>
      ) : null}
    </section>
  );
}

function StatusArtifact({
  presentation,
  receipt,
}: {
  presentation: DuelReceiptPresentation;
  receipt: PublicDuelReceipt;
}) {
  return (
    <section className="receipt-empty-result" aria-label="Duel status">
      <p className="receipt-kicker">No committed result</p>
      <div>
        <strong>{receipt.pack.name}</strong>
        <span>{formatPublicMoney(receipt.pack.tier)}</span>
      </div>
      <p>
        Observed {new Date(receipt.duel.observedAt).toLocaleString()} · {presentation.statusLabel}
      </p>
    </section>
  );
}

function ResultMetric({
  accent = false,
  label,
  value,
}: {
  accent?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className={accent ? 'receipt-metric-accent' : undefined}>
      <p className="receipt-kicker">{label}</p>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function FinalityNotice({ presentation }: { presentation: DuelReceiptPresentation }) {
  return (
    <section
      className={`receipt-finality receipt-finality-${presentation.finality.tone}`}
      aria-label="Result and ownership finality"
    >
      <div className="receipt-finality-mark" aria-hidden="true" />
      <div>
        <strong>{presentation.finality.label}</strong>
        <p>{presentation.finality.detail}</p>
      </div>
    </section>
  );
}

function VerificationDrawer({ receipt }: { receipt: PublicDuelReceipt }) {
  return (
    <details className="receipt-drawer">
      <summary>
        <span>
          <strong>Verify this receipt</strong>
          <small>Provider, valuation, escrow, signatures, and chain evidence</small>
        </span>
        <span className="receipt-drawer-action" aria-hidden="true">
          Open proof
        </span>
      </summary>
      <div className="receipt-drawer-content">
        <section className="receipt-proof-section">
          <h2>Receipt overview</h2>
          <div className="proof-stat-grid mt-4">
            <ProofStat label="Status" value={receipt.duel.status} />
            <ProofStat label="Pack tier" value={formatPublicMoney(receipt.pack.tier)} />
            <ProofStat label="Mode" value={receipt.duel.mode} />
            <ProofStat
              label="Provider"
              value={`${receipt.pack.provider} · ${receipt.pack.providerMode}`}
            />
          </div>
          <dl className="proof-definition-list mt-5">
            <ParticipantRow label="Creator" participant={receipt.participants.creator} />
            {receipt.participants.opponent ? (
              <ParticipantRow label="Opponent" participant={receipt.participants.opponent} />
            ) : null}
            <div>
              <dt>Receipt schema</dt>
              <dd className="font-mono">{receipt.schemaVersion}</dd>
            </div>
            <div>
              <dt>Observed</dt>
              <dd>{new Date(receipt.duel.observedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </section>

        {receipt.result ? <ResultProof receipt={receipt} /> : null}

        <section className="receipt-proof-section">
          <h2>Fees and custody</h2>
          <dl className="proof-definition-list mt-4">
            <div>
              <dt>Per-side fee</dt>
              <dd>
                {receipt.fees.perSideAmountLamports
                  ? `${receipt.fees.perSideAmountLamports} lamports`
                  : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>Finalized funding</dt>
              <dd>
                {receipt.fees.finalizedSides} / {receipt.fees.requiredSides} sides
              </dd>
            </div>
            <div>
              <dt>Total finalized fee</dt>
              <dd>
                {receipt.fees.totalFinalizedAmountLamports
                  ? `${receipt.fees.totalFinalizedAmountLamports} lamports`
                  : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>Fee escrow</dt>
              <dd className="break-all font-mono">
                {receipt.custody.platformFee.escrowAddress ?? 'Not created'}
              </dd>
            </div>
            <div>
              <dt>Card custody</dt>
              <dd>{receipt.custody.cardAssets.status}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-5 text-secondary">
            {receipt.custody.cardAssets.detail}
          </p>
        </section>

        <section className="receipt-proof-section">
          <h2>Provider and chain references</h2>
          <ReferenceList receipt={receipt} />
        </section>

        <section className="receipt-proof-section receipt-download-row">
          <div>
            <h2>Machine-readable receipt</h2>
            <p>Strict public DTO with no support errors, private metadata, or credentials.</p>
          </div>
          <a
            className="proof-secondary-action"
            href={publicReceiptDownloadUrl(receipt.duel.id)}
            download
          >
            Download JSON
          </a>
        </section>

        <p className="text-xs leading-5 text-secondary">
          Privacy: {receipt.privacy.reason} This page is excluded from indexing.
        </p>
      </div>
    </details>
  );
}

function ResultProof({ receipt }: { receipt: PublicDuelReceipt }) {
  const result = receipt.result;
  if (!result) return null;

  return (
    <section className="receipt-proof-section">
      <h2>Committed result proof</h2>
      <dl className="proof-definition-list mt-4">
        <div>
          <dt>Authoritative value</dt>
          <dd>
            {result.policy.authoritativeField} · {result.policy.currency} / 10^
            {result.policy.decimals} · no rounding
          </dd>
        </div>
        <div>
          <dt>Valuation policy</dt>
          <dd className="break-all font-mono">
            {result.policy.policyVersion} · {result.valuationPolicyHash}
          </dd>
        </div>
        <div>
          <dt>Policy hash algorithm</dt>
          <dd>{result.policy.hashAlgorithm}</dd>
        </div>
        <div>
          <dt>Maximum source age</dt>
          <dd>{result.policy.maxSourceAgeSeconds} seconds</dd>
        </div>
        <div>
          <dt>Tie rule</dt>
          <dd>Return each original card and refund both platform fees.</dd>
        </div>
        <div>
          <dt>Provider attestation</dt>
          <dd>{result.proof.providerAttestation.status}</dd>
        </div>
        <div>
          <dt>Proof schema</dt>
          <dd className="font-mono">{result.proof.schemaVersion}</dd>
        </div>
        <div>
          <dt>Pool version</dt>
          <dd className="font-mono">{result.proof.poolVersion}</dd>
        </div>
        <div>
          <dt>Escrow</dt>
          <dd className="break-all font-mono">{result.proof.context.escrowAddress}</dd>
        </div>
        <div>
          <dt>Creator result hash</dt>
          <dd className="break-all font-mono">{result.proof.creatorResultHash}</dd>
        </div>
        <div>
          <dt>Opponent result hash</dt>
          <dd className="break-all font-mono">{result.proof.opponentResultHash}</dd>
        </div>
        <div>
          <dt>Combined result hash</dt>
          <dd className="break-all font-mono">{result.resultHash}</dd>
        </div>
      </dl>
      <div className="receipt-outcome-proof">
        {result.outcomes.map((outcome) => (
          <dl key={outcome.side}>
            <div>
              <dt>{outcome.side} asset</dt>
              <dd>{outcome.assetReference}</dd>
            </div>
            <div>
              <dt>Provider result hash</dt>
              <dd>{outcome.resultHash}</dd>
            </div>
            <div>
              <dt>Pool version</dt>
              <dd>{outcome.poolVersion}</dd>
            </div>
            <div>
              <dt>Valuation source</dt>
              <dd>{outcome.valuationSourceReference ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Pack opened</dt>
              <dd>{new Date(outcome.openedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Value observed</dt>
              <dd>{new Date(outcome.sourceTimestamp).toLocaleString()}</dd>
            </div>
          </dl>
        ))}
      </div>
    </section>
  );
}

function ParticipantRow({
  label,
  participant,
}: {
  label: string;
  participant: PublicDuelReceipt['participants']['creator'];
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <Link
          href={`/profile/${encodeURIComponent(participant.address)}`}
          className="hover:text-lime"
        >
          {participant.display}
        </Link>
        <span className="mt-1 block break-all font-mono text-[11px] text-secondary">
          {participant.address}
        </span>
      </dd>
    </div>
  );
}

function CardActionState({ state }: { state: PublicPostDuelCardActionState }) {
  return (
    <section className="receipt-card-actions" aria-label={`${state.displayName} actions`}>
      <div>
        <p className="receipt-kicker">Final owner</p>
        <strong>{state.owner.display}</strong>
      </div>
      <ul>
        {state.actions.map((action) => (
          <li key={action.action}>
            <div>
              <span>{action.label}</span>
              <small
                className={
                  action.availability === 'available' ? 'receipt-action-available' : undefined
                }
              >
                {action.availability}
              </small>
            </div>
            <p>{action.detail}</p>
            {action.alternative ? (
              <p className="receipt-card-action-alternative">
                Available alternative: {action.alternative.label}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="receipt-card-settlement">
        Settlement reference: {state.ownership.settlementSignature}
      </p>
    </section>
  );
}

function cardActionGateMessage(reason: PublicDuelReceipt['cardActions']['reason']): string {
  const messages: Record<Exclude<typeof reason, null>, string> = {
    'duel-not-settled': 'Card actions stay hidden until the duel reaches settled state.',
    'mock-assets': 'Card actions stay hidden because mock results do not transfer real cards.',
    'ownership-mismatch':
      'Card actions are hidden because recorded ownership disagrees with the canonical result.',
    'ownership-pending':
      'Card actions stay hidden until an exact finalized settlement reference reconciles ownership.',
  };
  return reason ? messages[reason] : 'Card actions are unavailable.';
}

function ProofStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="proof-label">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold capitalize text-primary" title={value}>
        {value}
      </p>
    </div>
  );
}

function ReferenceList({ receipt }: { receipt: PublicDuelReceipt }) {
  if (
    receipt.references.solana.length === 0 &&
    receipt.references.provider.length === 0 &&
    receipt.recovery.alerts.length === 0
  ) {
    return <p className="mt-3 text-sm text-secondary">No public references recorded yet.</p>;
  }

  return (
    <ul className="receipt-reference-list">
      {receipt.recovery.alerts.map((alert) => (
        <li key={`recovery:${alert.signature}`}>
          <a href={alert.explorerUrl} target="_blank" rel="noreferrer">
            <strong>Recovery required · {alert.action}</strong>
            <span>{alert.code}</span>
            <code>{alert.signature}</code>
          </a>
        </li>
      ))}
      {receipt.references.solana.map((reference) => (
        <li key={reference.signature}>
          <a href={reference.explorerUrl} target="_blank" rel="noreferrer">
            <strong>
              Solana {reference.action} · {reference.status}
            </strong>
            <span>
              {reference.bindingSource === 'rpc-recovery'
                ? 'Recovered RPC binding'
                : 'API submission'}
            </span>
            <code>{reference.signature}</code>
          </a>
        </li>
      ))}
      {receipt.references.provider.map((reference) => (
        <li key={`${reference.side}:${reference.providerReference}`}>
          <div>
            <strong>
              {reference.provider} · {reference.side}
            </strong>
            <span>{reference.assetReference}</span>
            <code>{reference.providerReference}</code>
          </div>
        </li>
      ))}
    </ul>
  );
}

function UnavailableProof({ duelId }: { duelId: string }) {
  return (
    <main className="mx-auto min-h-[calc(100svh-4rem)] max-w-3xl px-4 py-16 sm:px-6">
      <p className="proof-label">Proof unavailable</p>
      <h1 className="mt-3 text-3xl font-semibold text-primary">
        This duel is not publicly readable yet.
      </h1>
      <p className="mt-4 text-sm leading-6 text-secondary">
        The API returned no durable public receipt for <code>{duelId}</code>. No status or result is
        inferred.
      </p>
      <Link href="/overview" className="proof-primary-action mt-6">
        Back to duels
      </Link>
    </main>
  );
}
