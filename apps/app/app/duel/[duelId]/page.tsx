import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { cache } from 'react';
import { buildDuelMetadata, receiptTitle } from '../duel-metadata';
import { DuelPrimaryAction } from '../duel-primary-action';
import { DuelProofRefresh } from '../duel-proof-refresh';
import {
  fetchPublicDuelReceipt,
  formatPublicMoney,
  type PublicDuelReceipt,
  type PublicDuelStatus,
  type PublicPostDuelCardActionState,
} from '../public-proof-client';
import {
  type DuelSocialSnapshot,
  getDuelSocialSnapshot,
  getPrimaryAction,
  getSocialDescription,
} from '../social-card-data';

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
  const socialSnapshot = getDuelSocialSnapshot(receipt);
  const canonicalOrigin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://openpacksduel.vercel.app';
  const canonicalUrl = `${canonicalOrigin}/duel/${encodeURIComponent(receipt.duel.id)}`;
  const socialImagePath = `/duel/${encodeURIComponent(receipt.duel.id)}/social/${receipt.duel.status}`;
  const shareUrl = `https://x.com/intent/post?${new URLSearchParams({
    text: getSocialDescription(socialSnapshot),
    url: canonicalUrl,
  }).toString()}`;

  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl flex-col gap-7 px-4 py-10 sm:px-6">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-lime">
            Durable public receipt · {receipt.duel.network}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-primary sm:text-5xl">
            {receiptTitle(receipt)}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary">
            {receipt.participants.creator.display} vs{' '}
            {receipt.participants.opponent?.display ?? 'open seat'} · observed{' '}
            {new Date(receipt.duel.observedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DuelProofRefresh active={active} />
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
      </header>

      {!receipt.availability.complete ? (
        <section className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-5">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
            Partial proof
          </p>
          <p className="mt-2 text-sm leading-6 text-secondary">
            This receipt reflects durable state only. Missing:{' '}
            {receipt.availability.missing.join(', ')}.
          </p>
        </section>
      ) : null}

      <PublicStateCard receipt={receipt} snapshot={socialSnapshot} />

      <section className="proof-stat-grid">
        <ProofStat label="Status" value={receipt.duel.status} />
        <ProofStat label="Pack tier" value={formatPublicMoney(receipt.pack.tier)} />
        <ProofStat label="Mode" value={receipt.duel.mode} />
        <ProofStat
          label="Provider"
          value={`${receipt.pack.provider} · ${receipt.pack.providerMode}`}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <ParticipantCard participant={receipt.participants.creator} />
        {receipt.participants.opponent ? (
          <ParticipantCard participant={receipt.participants.opponent} />
        ) : (
          <article className="proof-panel">
            <p className="proof-label">Opponent</p>
            <h2>Open seat</h2>
          </article>
        )}
      </section>

      {receipt.result ? (
        <ResultPanel receipt={receipt} />
      ) : (
        <PendingResult status={receipt.duel.status} />
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="proof-panel">
          <p className="proof-label">Fees and custody</p>
          <dl className="proof-definition-list">
            <div>
              <dt>Per-side fee</dt>
              <dd>
                {receipt.fees.perSideAmountLamports
                  ? `${receipt.fees.perSideAmountLamports} lamports`
                  : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>Finalized sides</dt>
              <dd>
                {receipt.fees.finalizedSides} / {receipt.fees.requiredSides}
              </dd>
            </div>
            <div>
              <dt>Fee escrow</dt>
              <dd>{receipt.custody.platformFee.escrowAddress ?? 'Not created'}</dd>
            </div>
            <div>
              <dt>Card custody</dt>
              <dd>{receipt.custody.cardAssets.status}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-5 text-secondary">
            {receipt.custody.cardAssets.detail}
          </p>
        </article>
        <article className="proof-panel">
          <p className="proof-label">Verification references</p>
          <ReferenceList receipt={receipt} />
        </article>
      </section>

      <p className="text-xs leading-5 text-secondary">
        Privacy: {receipt.privacy.reason} This spectator view uses pseudonymous display names and
        keeps full wallet addresses out of the rendered page and social metadata.
      </p>
    </main>
  );
}

function PublicStateCard({
  receipt,
  snapshot,
}: {
  receipt: PublicDuelReceipt;
  snapshot: DuelSocialSnapshot;
}) {
  const primaryAction = getPrimaryAction(snapshot);
  const waiting = receipt.duel.status === 'waiting';

  return (
    <section className="rounded-xl border border-lime/20 bg-lime/5 p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-lime">
            {snapshot.badge}
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-primary">{snapshot.headline}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">{snapshot.subline}</p>
        </div>
        <DuelPrimaryAction action={primaryAction} />
      </div>

      {waiting ? (
        <dl className="mt-5 grid gap-3 border-t border-lime/15 pt-5 sm:grid-cols-4">
          <InvitationFact label="Invited by" value={receipt.participants.creator.display} />
          <InvitationFact label="Pack tier" value={receipt.pack.name} />
          <InvitationFact label="Per-player stake" value={formatPublicMoney(receipt.pack.tier)} />
          <InvitationFact
            label="Accept before"
            value={new Date(receipt.duel.expiresAt).toLocaleString()}
          />
        </dl>
      ) : null}
    </section>
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

function ResultPanel({ receipt }: { receipt: PublicDuelReceipt }) {
  const result = receipt.result;
  if (!result) return null;
  const mockPreview =
    receipt.pack.providerMode === 'mock' || result.outcomes.some((outcome) => outcome.isMock);
  return (
    <section className="proof-panel">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="proof-label">
            {mockPreview ? 'Devnet mock preview · no real asset settlement' : 'Provider result'}
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            {result.winner
              ? `${result.winner.display} ${mockPreview ? 'leads the preview' : 'wins'}`
              : 'Tie / no winner'}
          </h2>
        </div>
        <div className="text-right">
          <p className="proof-label">Total value</p>
          <strong className="text-xl text-lime">{formatPublicMoney(result.totalValue)}</strong>
        </div>
      </div>
      {mockPreview ? (
        <p className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">
          These deterministic devnet values test the reveal and comparison flow only. They do not
          represent purchased cards, transferred NFTs, or a settled prize.
        </p>
      ) : null}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {result.outcomes.map((outcome) => {
          const actionState = receipt.cardActions.cards.find(
            (candidate) => candidate.side === outcome.side,
          );
          return (
            <article key={outcome.side} className="rounded-lg border border-border bg-primary p-4">
              <p className="proof-label">{outcome.side} pull</p>
              {outcome.imageUrl ? (
                <Image
                  alt={outcome.displayName}
                  className="mt-3 h-auto w-full rounded-lg"
                  height={500}
                  sizes="(min-width: 768px) 320px, 80vw"
                  src={outcome.imageUrl}
                  width={360}
                />
              ) : null}
              <h3 className="mt-3 text-lg font-semibold text-primary">{outcome.displayName}</h3>
              <p className="mt-1 text-lg font-semibold text-lime">
                {formatPublicMoney(outcome.insuredValue)}
              </p>
              <p className="mt-3 break-all font-mono text-[10px] leading-4 text-secondary">
                {outcome.assetReference}
              </p>
              <p className="mt-2 font-mono text-[10px] leading-4 text-secondary">
                Opened {new Date(outcome.openedAt).toLocaleString()} · value snapshot{' '}
                {new Date(outcome.sourceTimestamp).toLocaleString()} · {outcome.poolVersion}
              </p>
              {actionState ? <CardActionState state={actionState} /> : null}
            </article>
          );
        })}
      </div>
      {receipt.cardActions.availability === 'hidden' ? (
        <p className="mt-5 rounded-lg border border-border bg-secondary p-3 text-xs leading-5 text-secondary">
          {cardActionGateMessage(receipt.cardActions.reason)}
        </p>
      ) : null}
      <dl className="proof-definition-list mt-5">
        <div>
          <dt>Winner metric</dt>
          <dd>
            {result.policy.authoritativeField} · {result.policy.currency} / 10^
            {result.policy.decimals} · no rounding
          </dd>
        </div>
        <div>
          <dt>Winning margin</dt>
          <dd>{formatPublicMoney(result.margin)}</dd>
        </div>
        <div>
          <dt>Valuation policy</dt>
          <dd className="break-all font-mono text-xs">
            {result.policy.policyVersion} · {result.valuationPolicyHash}
          </dd>
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
          <dt>Result hash</dt>
          <dd className="break-all font-mono text-xs">{result.resultHash}</dd>
        </div>
      </dl>
    </section>
  );
}

function CardActionState({ state }: { state: PublicPostDuelCardActionState }) {
  return (
    <section
      className="mt-4 border-t border-border pt-4"
      aria-label={`${state.displayName} actions`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="proof-label">Reconciled owner</p>
          <p className="mt-1 text-sm font-semibold text-primary">{state.owner.display}</p>
        </div>
        <span className="rounded-full border border-lime/30 bg-lime/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-lime">
          Finalized
        </span>
      </div>
      <ul className="mt-4 grid gap-2">
        {state.actions.map((action) => (
          <li key={action.action} className="rounded-md border border-border bg-secondary p-3">
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm text-primary">{action.label}</strong>
              <span
                className={
                  action.availability === 'available'
                    ? 'font-mono text-[10px] uppercase tracking-[0.12em] text-lime'
                    : 'font-mono text-[10px] uppercase tracking-[0.12em] text-secondary'
                }
              >
                {action.availability}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-secondary">{action.detail}</p>
            {action.alternative ? (
              <p className="mt-2 text-xs font-semibold text-primary">
                Available alternative: {action.alternative.label}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 font-mono text-[10px] leading-4 text-secondary">
        Settlement {shorten(state.ownership.settlementSignature)} · no post-duel transaction has
        been created.
      </p>
    </section>
  );
}

function cardActionGateMessage(reason: PublicDuelReceipt['cardActions']['reason']): string {
  const messages: Record<Exclude<typeof reason, null>, string> = {
    'duel-not-settled': 'Card actions stay hidden until the duel reaches settled state.',
    'mock-assets':
      'Card actions stay hidden for mock results because no real card was transferred.',
    'ownership-mismatch':
      'Card actions are hidden because recorded ownership disagrees with the canonical result.',
    'ownership-pending':
      'Card actions stay hidden until an exact finalized settlement reference reconciles ownership.',
  };
  return reason ? messages[reason] : 'Card actions are unavailable.';
}

function PendingResult({ status }: { status: PublicDuelStatus }) {
  return (
    <section className="proof-panel">
      <p className="proof-label">Card result</p>
      <h2 className="mt-2 text-xl font-semibold">No result recorded</h2>
      <p className="mt-2 text-sm leading-6 text-secondary">
        Current state: {status}. This page will not infer card values, a winner, or custody before
        durable provider state exists.
      </p>
    </section>
  );
}

function ParticipantCard({
  participant,
}: {
  participant: PublicDuelReceipt['participants']['creator'];
}) {
  return (
    <article className="proof-panel">
      <p className="proof-label">{participant.role}</p>
      <h2 className="mt-2 text-xl font-semibold text-primary">{participant.display}</h2>
      <p className="mt-3 text-xs leading-5 text-secondary">
        Pseudonymous wallet identity. Full addresses stay out of the spectator surface.
      </p>
    </article>
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
  )
    return <p className="mt-3 text-sm text-secondary">No public references recorded yet.</p>;
  return (
    <ul className="mt-4 grid gap-3">
      {receipt.recovery.alerts.map((alert) => (
        <li key={`recovery:${alert.signature}`}>
          <a
            href={alert.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-amber-300 hover:underline"
          >
            Custody recovery required · funding {shorten(alert.signature)}
          </a>
        </li>
      ))}
      {receipt.references.solana.map((reference) => (
        <li key={reference.signature}>
          <a
            href={reference.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-lime hover:underline"
          >
            Solana {reference.action} · {shorten(reference.signature)}
            {reference.bindingSource === 'rpc-recovery' ? ' · recovered binding' : ''}
          </a>
        </li>
      ))}
      {receipt.references.provider.map((reference) => (
        <li
          key={`${reference.side}:${reference.providerReference}`}
          className="text-sm text-secondary"
        >
          {reference.provider} {reference.side} ·{' '}
          <span className="font-mono text-xs">{shorten(reference.providerReference)}</span>
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
      <Link href="/overview" className="proof-secondary-action mt-6">
        Back to duels
      </Link>
    </main>
  );
}

function shorten(value: string): string {
  return value.length > 16 ? `${value.slice(0, 7)}…${value.slice(-7)}` : value;
}
