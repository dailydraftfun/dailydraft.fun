'use client';

import {
  ArrowSquareOutIcon,
  CardsThreeIcon,
  CheckCircleIcon,
  LockKeyIcon,
  ReceiptIcon,
  SparkleIcon,
  SpinnerGapIcon,
  WalletIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import Image from 'next/image';
import {
  type BalanceStatus,
  resolveFundingPreflight,
  type WalletBalances,
} from '../../solana/balance';
import { getExplorerAddressUrl, getExplorerTransactionUrl } from '../../solana/config';
import { describeConfirmation } from '../../solana/confirmation';
import {
  describeFlipStage,
  type FlipStage,
  getFlipCostSummary,
  getFlipFundingRequirement,
  getFlipStage,
} from './flip-machine-flow';
import type { FlipMachineState } from './flip-machine-state';
import { FLIP_SPORTS, FLIP_TIERS, type FlipSport } from './flip-machines';
import { describeFlipReveal } from './flip-reveal-presentation';

/** The subset of a Wallet Standard entry this surface renders. */
export type FlipWalletChoice = { icon: string; name: string };

export type FlipMachineViewProps = {
  balanceStatus: BalanceStatus;
  balances: WalletBalances | null;
  onConfirm: () => void;
  onConnect: (walletName: string) => void;
  onPrepare: () => void;
  onReset: () => void;
  onResume: () => void;
  onSelect: (sport: FlipSport, tierPriceMinor: string) => void;
  state: FlipMachineState;
  walletAddress: string | null;
  walletCanSignTransaction: boolean;
  walletConnecting: boolean;
  wallets: readonly FlipWalletChoice[];
};

/**
 * The whole Sports Pack Gacha surface, rendered from plain props.
 *
 * Nothing here reads a hook. The workspace has no DOM test environment, so a
 * component that called `useSolanaWallet()` itself could only ever be rendered
 * against a mocked module; taking the wallet as data means every stage is
 * reachable from `renderToStaticMarkup` with an object literal instead.
 */
export function FlipMachineView({
  balanceStatus,
  balances,
  onConfirm,
  onConnect,
  onPrepare,
  onReset,
  onResume,
  onSelect,
  state,
  walletAddress,
  walletCanSignTransaction,
  walletConnecting,
  wallets,
}: FlipMachineViewProps) {
  const {
    broadcastUnknown,
    capability,
    capabilityError,
    confirmationPhase,
    error,
    fundingPhase,
    intent,
    machine,
    notice,
    odds,
    pending,
    prepared,
    recovery,
    recoveryInvalid,
    result,
    serverSeedHash,
    signature,
    snapshot,
  } = state;

  const stage = getFlipStage({
    capability,
    capabilityError,
    error,
    fundingPhase,
    pending,
    prepared,
    result,
    walletAddress,
  });
  const stageCopy = describeFlipStage(stage);
  const cost = getFlipCostSummary(machine.tierPriceMinor, intent);
  const preflight = intent
    ? resolveFundingPreflight(balanceStatus, balances, getFlipFundingRequirement(intent))
    : null;
  const underfunded = preflight?.status === 'insufficient';
  const revealEvidenceMatches =
    result !== null &&
    snapshot?.machineKey === result.rip.machineKey &&
    snapshot.contentHash === result.rip.snapshotContentHash &&
    odds?.machineKey === result.rip.machineKey &&
    odds.version === result.oddsCommitment.version &&
    odds.rulesHash === result.rip.oddsRulesHash;
  const reveal =
    result?.rip.status === 'SETTLED'
      ? describeFlipReveal(
          result.rip,
          revealEvidenceMatches ? snapshot : null,
          revealEvidenceMatches ? odds.bandMinimums : null,
        )
      : null;

  return (
    <section
      aria-label="Sports Pack Gacha"
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]"
      data-stage={stage}
    >
      <div className="proof-panel">
        <PanelHeading
          eyebrow={stageCopy.label}
          title={
            snapshot?.machineKey === machine.machineKey
              ? snapshot.machine.displayName
              : `${machine.sportLabel} ${machine.tierLabel} Sports Pack`
          }
        />
        <p className="mt-3 text-sm leading-6 text-secondary">{stageCopy.detail}</p>

        {stage === 'blocked' ? (
          <div className="intent-warnings mt-5" role="status">
            <WarningCircleIcon size={17} weight="fill" />
            <span>{capabilityError ?? capability?.reason ?? 'This machine is closed.'}</span>
          </div>
        ) : null}

        {stage === 'connect' ? (
          <ConnectPanel connecting={walletConnecting} onConnect={onConnect} wallets={wallets} />
        ) : null}

        {stage === 'review' ||
        stage === 'preparing' ||
        (stage === 'recovery' && !signature && !broadcastUnknown) ? (
          <>
            <p className="proof-label mt-6">Sport</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FLIP_SPORTS.map(({ label, sport }) => (
                <PoolChoice
                  active={machine.sport === sport}
                  key={sport}
                  label={label}
                  meta="Sealed devnet pool"
                  onClick={() => onSelect(sport, machine.tierPriceMinor)}
                />
              ))}
            </div>

            <p className="proof-label mt-6">Tier</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {FLIP_TIERS.map((tier) => (
                <PoolChoice
                  active={machine.tierPriceMinor === tier.priceMinor}
                  key={tier.priceMinor}
                  label={tier.label}
                  meta="Per rip"
                  onClick={() => onSelect(machine.sport, tier.priceMinor)}
                />
              ))}
            </div>

            {odds ? (
              <div className="mt-5 rounded-xl border border-lime/20 bg-lime/5 p-5" role="status">
                <div className="flex items-center gap-3 text-lime">
                  <LockKeyIcon size={20} weight="fill" />
                  <strong className="text-sm">Odds sealed before your roll</strong>
                </div>
                <div className="mt-4 overflow-hidden rounded-xl border border-border">
                  <ProbabilityRow
                    band="Base"
                    chance={formatChance(odds.baseProbabilityPpm, odds.probabilityScalePpm)}
                    detail="Cleared the pool floor."
                  />
                  <ProbabilityRow
                    band="Plus"
                    chance={formatChance(odds.plusProbabilityPpm, odds.probabilityScalePpm)}
                    detail="Cleared the plus band minimum."
                  />
                  <ProbabilityRow
                    band="Premium"
                    chance={formatChance(odds.premiumProbabilityPpm, odds.probabilityScalePpm)}
                    detail="Cleared the premium band minimum."
                  />
                  <ProbabilityRow
                    band="Chase"
                    chance={formatChance(odds.chaseProbabilityPpm, odds.probabilityScalePpm)}
                    detail="Top committed band — the chase hit."
                  />
                </div>
                <dl className="proof-definition-list mt-4">
                  <div>
                    <dt>Odds key</dt>
                    <dd>{shorten(odds.oddsKey)}</dd>
                  </div>
                  <div>
                    <dt>Rules hash</dt>
                    <dd>{shorten(odds.rulesHash)}</dd>
                  </div>
                  <div>
                    <dt>Committed pool</dt>
                    <dd>{snapshot ? `${snapshot.eligibleCount} eligible cards` : 'Loading…'}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {error ? (
              <p className="duel-preflight duel-preflight-short mt-5" role="alert">
                <WarningCircleIcon size={15} weight="fill" />
                {error}
              </p>
            ) : null}

            <button
              className="proof-primary-action mt-6 gap-2"
              disabled={pending || !odds}
              onClick={onPrepare}
              type="button"
            >
              <LockKeyIcon size={16} />
              {pending ? 'Preparing your rip…' : 'Price this rip'}
            </button>
          </>
        ) : null}

        {stage === 'funding-review' && intent && prepared ? (
          <div className="duel-step-panel mt-6">
            <div className="duel-step-title">
              <WalletIcon size={23} weight="fill" />
              <h3>Review the deposit</h3>
            </div>
            <dl className="duel-money-summary">
              <div>
                <dt>Pack tier</dt>
                <dd>{cost.packTier}</dd>
              </div>
              <div className="duel-money-total">
                <dt>Deposit</dt>
                <dd>{cost.deposit}</dd>
              </div>
              <div>
                <dt>Network fee</dt>
                <dd>{cost.networkFee}</dd>
              </div>
              <div>
                <dt>Wallet approval</dt>
                <dd>{cost.walletApproval}</dd>
              </div>
            </dl>

            {preflight ? (
              <p className={underfunded ? 'duel-preflight duel-preflight-short' : 'duel-preflight'}>
                {underfunded ? <WarningCircleIcon size={15} weight="fill" /> : null}
                {preflight.summary}
              </p>
            ) : null}

            <p className="duel-payment-safety">
              Nothing is charged until you approve the transfer. The deposit goes to the house
              treasury token account shown below, and the seed is only revealed once the network
              confirms it.
            </p>

            {!walletCanSignTransaction ? (
              <p className="duel-preflight duel-preflight-short" role="alert">
                <WarningCircleIcon size={15} weight="fill" />
                This wallet only supports combined sign-and-send. Choose a wallet that can sign
                first so the payment is claimed by the server before broadcast.
              </p>
            ) : null}

            <dl className="proof-definition-list mt-4">
              <AddressRow address={intent.destinationTokenAccount} label="House treasury" />
              <AddressRow address={intent.mint} label="USDC mint" />
              <AddressRow address={prepared.sourceTokenAccount} label="Funding token account" />
              <div>
                <dt>Intent</dt>
                <dd>{shorten(intent.intentId)}</dd>
              </div>
              {serverSeedHash ? (
                <div>
                  <dt>Server seed commitment</dt>
                  <dd className="break-all font-mono text-xs">{serverSeedHash}</dd>
                </div>
              ) : null}
            </dl>

            {error ? (
              <p className="duel-preflight duel-preflight-short" role="alert">
                <WarningCircleIcon size={15} weight="fill" />
                {error}
              </p>
            ) : null}

            <button
              className="proof-primary-action mt-6 gap-2"
              disabled={underfunded || !walletCanSignTransaction}
              onClick={onConfirm}
              type="button"
            >
              <SparkleIcon size={16} weight="fill" />
              Approve and rip
            </button>
          </div>
        ) : null}

        {stage === 'funding-signature' ||
        stage === 'confirming' ||
        stage === 'verifying' ||
        stage === 'ripping' ? (
          <ProgressPanel
            detail={
              confirmationPhase && stage === 'confirming'
                ? describeConfirmation(confirmationPhase).detail
                : stageCopy.detail
            }
            explorerUrl={signature ? getExplorerTransactionUrl(signature) : null}
            label={stageCopy.label}
            signature={signature ? shorten(signature) : undefined}
          />
        ) : null}

        {stage === 'recovery' &&
        (intent || signature || broadcastUnknown || recoveryInvalid || recovery) ? (
          <div className="duel-step-panel mt-6" role="alert">
            <div className="duel-step-title">
              <WarningCircleIcon size={23} weight="fill" />
              <h3>Recover this rip</h3>
            </div>
            <p className="text-sm leading-6 text-secondary">{error ?? stageCopy.detail}</p>
            {signature ? (
              <a
                className="duel-explorer-link"
                href={getExplorerTransactionUrl(signature)}
                rel="noreferrer"
                target="_blank"
              >
                Track on Solana Explorer <ArrowSquareOutIcon size={13} />
              </a>
            ) : null}
            {broadcastUnknown || recoveryInvalid ? (
              <>
                <p className="duel-preflight duel-preflight-short mt-5" role="status">
                  Reconciliation is required before another transfer can be approved.
                </p>
                {recoveryInvalid ? (
                  <p className="mt-3 text-xs leading-5 text-secondary">
                    Contact the DailyDraft operator from this browser and include your connected
                    wallet address. Do not clear browser storage or approve another transfer until
                    the prior intent is identified.
                  </p>
                ) : null}
              </>
            ) : (
              <button className="proof-secondary-action mt-5" onClick={onResume} type="button">
                {signature ? 'Resume this rip' : 'Refresh payment review'}
              </button>
            )}
          </div>
        ) : null}

        {stage === 'delivery-failed' && result ? (
          <div className="duel-step-panel mt-6" role="alert">
            <div className="duel-step-title">
              <WarningCircleIcon size={23} weight="fill" />
              <h3>Card delivery failed</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-secondary">
              Your deposit settled and was consumed, but the provider did not deliver the selected
              card. DailyDraft operator reconciliation and a manual refund are required.
            </p>
            <ReceiptSummary
              facts={[
                ['Rip', shorten(result.rip.id)],
                ['Failure reason', result.rip.failureReason ?? 'Provider delivery failed'],
                ['Failed asset', result.rip.failedAssetReference ?? 'Not recorded'],
                [
                  'Server seed proof',
                  result.serverSeed ? 'Verified against the pre-payment commitment' : 'Unavailable',
                ],
              ]}
              title="Refund reconciliation"
            />
            <button className="proof-secondary-action mt-5" onClick={onReset} type="button">
              Return to the machine
            </button>
          </div>
        ) : null}

        {stage === 'revealed' && reveal && result ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-center">
            <div className="pull-shell" data-rarity={reveal.rarity?.band ?? 'base'}>
              {reveal.imageUrl ? (
                <div className="relative aspect-[2.5/3.5] overflow-hidden rounded-xl border border-border bg-tertiary">
                  <Image
                    alt={reveal.displayName}
                    className="object-cover"
                    fill
                    priority
                    sizes="(min-width: 768px) 240px, 72vw"
                    src={reveal.imageUrl}
                  />
                </div>
              ) : (
                <div className="grid aspect-[2.5/3.5] place-items-center rounded-xl border border-border bg-tertiary text-sm text-secondary">
                  {reveal.displayName}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-3 text-lime">
                <CheckCircleIcon size={20} weight="fill" />
                <strong className="text-sm">
                  {revealEvidenceMatches ? (reveal.rarity?.label ?? 'Revealed') : 'Rarity pending'}
                </strong>
              </div>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-primary">
                {reveal.displayName}
              </h3>
              <p className="mt-2 text-sm leading-6 text-secondary">
                {revealEvidenceMatches
                  ? (reveal.rarity?.blurb ?? 'The server seed is revealed and the pull is final.')
                  : 'The pull is final. Matching sealed rarity evidence is still loading.'}
              </p>
              <ReceiptSummary
                facts={[
                  ['Insured value', reveal.insuredValue],
                  ['Graded', reveal.graded ? 'Yes' : 'No'],
                  ['Rip', shorten(result.rip.id)],
                  ['Client seed hash', result.rip.seedCommitmentHash],
                  [
                    'Server seed',
                    result.serverSeed ? shorten(result.serverSeed) : 'Pending reveal',
                  ],
                  ['Server seed commitment', result.serverSeedHash ?? 'Missing proof'],
                  ['Server seed proof', 'Verified against the pre-payment commitment'],
                  ['Odds rules hash', shorten(result.rip.oddsRulesHash)],
                ]}
                title="Provably fair receipt"
              />
              <button className="proof-secondary-action mt-5" onClick={onReset} type="button">
                Rip another pack
              </button>
            </div>
          </div>
        ) : null}

        {notice ? (
          <p className="mt-5 text-xs leading-5 text-secondary" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <JourneyRail current={journeyIndex(stage)} />
    </section>
  );
}

const JOURNEY_STEPS: ReadonlyArray<[string, string, string]> = [
  ['01', 'Pick your pack', 'Choose a sport and tier. The machine prices the rip.'],
  ['02', 'Seal the odds', 'The server commits a seed hash and the odds before you pay.'],
  ['03', 'Approve the deposit', 'One USDC transfer to the house treasury, shown in full.'],
  ['04', 'Reveal', 'The seed is revealed and the committed pull is final.'],
];

export function journeyIndex(stage: FlipStage): number {
  if (stage === 'delivery-failed' || stage === 'revealed') return 3;
  if (stage === 'ripping' || stage === 'verifying' || stage === 'confirming') return 2;
  if (stage === 'funding-review' || stage === 'funding-signature') return 2;
  if (stage === 'preparing') return 1;
  return 0;
}

export function formatChance(ppm: number, scalePpm: number): string {
  if (!Number.isFinite(ppm) || !Number.isFinite(scalePpm) || scalePpm <= 0) return '—';
  return `${((ppm / scalePpm) * 100).toFixed(1)}%`;
}

export function shorten(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="proof-label">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-primary">{title}</h2>
    </div>
  );
}

function PoolChoice({
  active,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={[
        'min-h-28 rounded-xl border p-4 text-left transition-colors',
        active
          ? 'border-lime/40 bg-lime/5'
          : 'border-border bg-tertiary hover:border-border-strong',
      ].join(' ')}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className={active ? 'text-lime' : 'text-secondary'}>
        <CardsThreeIcon size={20} weight="fill" />
      </span>
      <strong className="mt-3 block text-sm text-primary">{label}</strong>
      <small className="mt-1 block text-xs text-secondary">{meta}</small>
    </button>
  );
}

function ProbabilityRow({
  band,
  chance,
  detail,
}: {
  band: string;
  chance: string;
  detail: string;
}) {
  return (
    <div className="grid gap-2 border-b border-border bg-secondary px-4 py-3 last:border-b-0 sm:grid-cols-[6rem_4rem_minmax(0,1fr)] sm:items-center">
      <strong className="text-sm text-primary">{band}</strong>
      <span className="font-mono text-sm font-semibold text-lime">{chance}</span>
      <span className="text-xs text-secondary">{detail}</span>
    </div>
  );
}

function AddressRow({ address, label }: { address: string; label: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <a
          className="duel-explorer-link"
          href={getExplorerAddressUrl(address)}
          rel="noreferrer"
          target="_blank"
        >
          {shorten(address)} <ArrowSquareOutIcon size={12} />
        </a>
      </dd>
    </div>
  );
}

function ProgressPanel({
  detail,
  explorerUrl,
  label,
  signature,
}: {
  detail: string;
  explorerUrl?: string | null;
  label: string;
  signature?: string;
}) {
  return (
    <div aria-live="polite" className="duel-step-panel duel-progress-panel mt-6" role="status">
      <SpinnerGapIcon className="wallet-spinner" size={30} />
      {signature ? <span className="duel-progress-signature">{signature}</span> : null}
      <h3>{label}</h3>
      <p>{detail}</p>
      {explorerUrl ? (
        <a className="duel-explorer-link" href={explorerUrl} rel="noreferrer" target="_blank">
          Track on Solana Explorer <ArrowSquareOutIcon size={13} />
        </a>
      ) : null}
    </div>
  );
}

function ConnectPanel({
  connecting,
  onConnect,
  wallets,
}: {
  connecting: boolean;
  onConnect: (walletName: string) => void;
  wallets: readonly FlipWalletChoice[];
}) {
  return (
    <div className="duel-step-panel mt-6">
      <div className="duel-step-title">
        <WalletIcon size={23} weight="fill" />
        <h3>Connect your wallet</h3>
      </div>
      {wallets.length > 0 ? (
        <div className="wallet-list">
          {wallets.map((available) => (
            <button
              disabled={connecting}
              key={available.name}
              onClick={() => onConnect(available.name)}
              type="button"
            >
              <Image alt="" height={30} src={available.icon} unoptimized width={30} />
              <span className="wallet-list-copy">
                <strong>{available.name}</strong>
                <small>Wallet Standard · devnet</small>
              </span>
              {connecting ? (
                <SpinnerGapIcon className="wallet-spinner" size={17} />
              ) : (
                <span aria-hidden="true">→</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="wallet-empty-state">
          <p>No Wallet Standard wallet was detected in this browser.</p>
        </div>
      )}
    </div>
  );
}

function ReceiptSummary({ facts, title }: { facts: Array<[string, string]>; title: string }) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-tertiary p-5" role="status">
      <div className="flex items-center gap-3 text-lime">
        <ReceiptIcon size={20} weight="fill" />
        <strong className="text-sm">{title}</strong>
      </div>
      <dl className="proof-definition-list mt-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function JourneyRail({ current }: { current: number }) {
  return (
    <aside className="proof-panel">
      <p className="proof-label">Player journey</p>
      <h2 className="mt-2 text-xl font-semibold text-primary">One committed path</h2>
      <ol className="mt-5 grid gap-3">
        {JOURNEY_STEPS.map(([number, label, detail], index) => (
          <li className="flex gap-3" key={number}>
            <span
              className={[
                'grid size-8 shrink-0 place-items-center rounded-full border font-mono text-xs font-semibold',
                index <= current
                  ? 'border-lime/40 bg-lime/10 text-lime'
                  : 'border-border bg-tertiary text-secondary',
              ].join(' ')}
            >
              {number}
            </span>
            <div>
              <p className="text-sm font-semibold text-primary">{label}</p>
              <p className="mt-1 text-xs leading-5 text-secondary">{detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
