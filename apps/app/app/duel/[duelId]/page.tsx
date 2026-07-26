import type { Metadata } from 'next';
import Image from 'next/image';
import { cache } from 'react';
import { getExplorerAddressUrl } from '../../solana/config';
import { buildDuelMetadata } from '../duel-metadata';
import { DuelPrimaryAction } from '../duel-primary-action';
import { DuelProofRefresh } from '../duel-proof-refresh';
import {
  type DuelReceiptPresentation,
  getDuelReceiptPresentation,
} from '../duel-receipt-presentation';
import { DuelUnavailableProof } from '../duel-unavailable-proof';
import { CardActionGate, CardActionState, toCardActionState } from '../post-duel-card-actions';
import {
  fetchPublicDuelReceipt,
  formatPublicMoney,
  type PublicDuelReceipt,
  type PublicDuelStatus,
} from '../public-proof-client';
import { getDuelSocialSnapshot, getPrimaryAction, getSocialDescription } from '../social-card-data';

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
      title: 'Duel proof unavailable — DailyDraft',
      robots: { follow: false, index: false, nocache: true },
    };
  }
  return buildDuelMetadata(receipt);
}

export default async function DuelPage({ params }: DuelPageProps) {
  const { duelId } = await params;
  const receipt = await getReceipt(duelId);
  if (!receipt) return <DuelUnavailableProof duelId={duelId} />;

  const active = !terminalStatuses.has(receipt.duel.status);
  const socialSnapshot = getDuelSocialSnapshot(receipt);
  const canonicalOrigin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://dailydraft.fun';
  const canonicalUrl = `${canonicalOrigin}/duel/${encodeURIComponent(receipt.duel.id)}`;
  const socialImagePath = `/duel/${encodeURIComponent(receipt.duel.id)}/social/${receipt.duel.status}`;
  const shareUrl = `https://x.com/intent/post?${new URLSearchParams({
    text: getSocialDescription(socialSnapshot),
    url: canonicalUrl,
  }).toString()}`;
  const presentation = getDuelReceiptPresentation(receipt);

  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <article className="receipt-artifact">
        <header className="receipt-artifact-header">
          <div className="min-w-0">
            <p className="receipt-serial">
              DailyDraft receipt · {receipt.duel.id} · {receipt.duel.network}
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
            <DuelPrimaryAction action={getPrimaryAction(socialSnapshot)} />
            <a className="proof-secondary-action" href={shareUrl} target="_blank" rel="noreferrer">
              Share on X
            </a>
            <a
              className="proof-secondary-action"
              href={socialImagePath}
              target="_blank"
              rel="noreferrer"
            >
              Open social image
            </a>
          </div>
        </section>

        {receipt.duel.status === 'waiting' ? <InvitationFacts receipt={receipt} /> : null}

        {receipt.result ? (
          <ResultArtifact receipt={receipt} presentation={presentation} />
        ) : (
          <StatusArtifact receipt={receipt} presentation={presentation} />
        )}

        <FinalityNotice presentation={presentation} />
      </article>

      {!receipt.availability.complete ? (
        <section className="rounded-xl border border-warning/30 bg-warning/5 p-5">
          <p className="receipt-kicker receipt-kicker-warning">Partial receipt</p>
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

function InvitationFacts({ receipt }: { receipt: PublicDuelReceipt }) {
  return (
    <dl className="mx-7 grid gap-3 border-y border-lime/15 py-5 sm:grid-cols-4">
      <InvitationFact label="Invited by" value={receipt.participants.creator.display} />
      <InvitationFact label="Pack tier" value={receipt.pack.name} />
      <InvitationFact label="Per-player stake" value={formatPublicMoney(receipt.pack.tier)} />
      <InvitationFact
        label="Accept before"
        value={new Date(receipt.duel.expiresAt).toLocaleString()}
      />
    </dl>
  );
}

function InvitationFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="proof-label">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-primary">{value}</dd>
    </div>
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
  const scoreboard = presentation.scoreboard;
  if (!result || !scoreboard) return null;

  return (
    <section aria-label="Duel result">
      <div className="receipt-scoreboard">
        <ResultMetric label={scoreboard.comparisonLabel} value={scoreboard.comparisonValue} />
        <ResultMetric accent label="Total haul" value={formatPublicMoney(result.totalValue)} />
        <ResultMetric
          accent={Boolean(result.winner)}
          label={scoreboard.marginLabel}
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
                outcomeState?.emphasized ? 'receipt-pull receipt-pull-winner' : 'receipt-pull'
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
                  <strong>DAILYDRAFT</strong>
                </div>
              )}
              <h2>{outcome.displayName}</h2>
              {actionState ? <CardActionState state={toCardActionState(actionState)} /> : null}
            </article>
          );
        })}
      </div>

      {receipt.cardActions.availability === 'hidden' ? (
        <CardActionGate reason={receipt.cardActions.reason} />
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
                <ExplorerAddress address={receipt.custody.platformFee.escrowAddress} />
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

        <p className="text-xs leading-5 text-secondary">
          Privacy: {receipt.privacy.reason} This spectator view uses pseudonymous display names and
          keeps full wallet addresses out of the rendered page and social metadata.
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
          <dd className="break-all font-mono">
            <ExplorerAddress address={result.proof.context.escrowAddress} />
          </dd>
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
        <span className="font-semibold text-primary">{participant.display}</span>
        <span className="mt-1 block text-[11px] text-secondary">
          Pseudonymous participant identity
        </span>
      </dd>
    </div>
  );
}

/**
 * Renders an on-chain account as an explorer link. Signature references already
 * arrive with a server-built `explorerUrl`; escrow accounts do not, so the
 * receipt derives one rather than leaving the address as text a reader would
 * have to copy into a block explorer by hand.
 */
function ExplorerAddress({ address }: { address: string | null }) {
  if (!address) return <>Not created</>;
  return (
    <a
      className="duel-explorer-link"
      href={getExplorerAddressUrl(address)}
      target="_blank"
      rel="noreferrer"
    >
      {address}
    </a>
  );
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
