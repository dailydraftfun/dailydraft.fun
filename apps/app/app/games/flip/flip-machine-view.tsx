'use client';

import {
  ArrowSquareOutIcon,
  CardsThreeIcon,
  CheckCircleIcon,
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
import { engineRarityForGachaBand } from '../scenes/gacha-reveal-choreography';
import { GachaRevealScene } from '../scenes/gacha-reveal-scene';
import {
  describeFlipStage,
  getFlipCostSummary,
  getFlipFundingRequirement,
  getFlipStage,
} from './flip-machine-flow';
import type { FlipMachineState } from './flip-machine-state';
import { FLIP_SPORTS, FLIP_TIERS, type FlipSport } from './flip-machines';
import { describeFlipReveal } from './flip-reveal-presentation';
import styles from './gacha-machine.module.css';

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
  walletAuthenticated: boolean;
  walletAddress: string | null;
  walletAuthenticationPending: boolean;
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
  walletAuthenticated,
  walletAddress,
  walletAuthenticationPending,
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
  const locked = Boolean(recovery || recoveryInvalid || broadcastUnknown || signature);
  const selectionStage =
    stage === 'review' || stage === 'preparing' || (stage === 'recovery' && !locked && !intent);
  const recoveryWalletMatches = Boolean(
    recovery && walletAddress && recovery.payerWallet === walletAddress,
  );
  const recoveryActionable = Boolean(
    recovery &&
      recovery.status !== 'awaiting-signature' &&
      walletAuthenticated &&
      recoveryWalletMatches,
  );
  const chaseChance = odds
    ? formatChance(odds.chaseProbabilityPpm, odds.probabilityScalePpm)
    : null;

  return (
    <section aria-label="Sports Pack Gacha" className={styles.machine} data-stage={stage}>
      <header className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>{stageCopy.label}</p>
          <h2 className={styles.title}>
            {snapshot?.machineKey === machine.machineKey
              ? snapshot.machine.displayName.replace(' Devnet Machine', '')
              : `${machine.sportLabel} ${machine.tierLabel} Pack`}
          </h2>
        </div>
        <span className={styles.devnet}>Devnet</span>
      </header>

      {stage !== 'revealed' ? (
        <PackStage
          detail={stageCopy.detail}
          label={stageCopy.label}
          price={cost.packTier}
          sport={machine.sport}
          sportLabel={machine.sportLabel}
        />
      ) : null}

      {stage === 'blocked' ? (
        <StatusCard
          detail={capabilityError ?? capability?.reason ?? 'This machine is closed.'}
          title="This pack is temporarily offline"
          warning
        />
      ) : null}

      {stage === 'connect' ? (
        <ConnectPanel connecting={walletConnecting} onConnect={onConnect} wallets={wallets} />
      ) : null}

      {selectionStage ? (
        <div className={styles.controls}>
          <fieldset className={styles.choiceGroup}>
            <legend className={styles.choiceLabel}>Sport</legend>
            <div className={styles.choices} style={{ '--columns': 4 } as React.CSSProperties}>
              {FLIP_SPORTS.map(({ label, sport }) => (
                <Choice
                  active={machine.sport === sport}
                  key={sport}
                  label={label}
                  onClick={() => onSelect(sport, machine.tierPriceMinor)}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.choiceGroup}>
            <legend className={styles.choiceLabel}>Pack</legend>
            <div className={styles.choices} style={{ '--columns': 3 } as React.CSSProperties}>
              {FLIP_TIERS.map((tier) => (
                <Choice
                  active={machine.tierPriceMinor === tier.priceMinor}
                  key={tier.priceMinor}
                  label={tier.label}
                  onClick={() => onSelect(machine.sport, tier.priceMinor)}
                />
              ))}
            </div>
          </fieldset>

          <p className={styles.facts}>
            <span>
              <strong>{snapshot ? snapshot.eligibleCount : '—'}</strong> possible cards
            </span>
            <span>
              <strong>{chaseChance ?? '—'}</strong> Chase
            </span>
            <span>Provably fair</span>
          </p>

          {error ? (
            <p className="duel-preflight duel-preflight-short mt-4" role="alert">
              <WarningCircleIcon size={15} weight="fill" />
              {error}
            </p>
          ) : null}

          <button
            className={styles.primary}
            disabled={pending || !odds}
            onClick={onPrepare}
            type="button"
          >
            <SparkleIcon size={17} weight="fill" />
            {pending ? 'Sealing your pack…' : `Rip ${machine.sportLabel} · ${cost.packTier}`}
          </button>

          {odds ? (
            <FairnessDetails
              odds={odds}
              serverSeedHash={null}
              snapshotCount={snapshot?.eligibleCount}
            />
          ) : null}
        </div>
      ) : null}

      {stage === 'funding-review' && intent && prepared ? (
        <div className={styles.sheet}>
          <div className={styles.sheetHeading}>
            <WalletIcon size={23} weight="fill" />
            <h3>One approval, then the pack opens</h3>
          </div>
          <div className={styles.price}>
            <span>Total deposit</span>
            <strong>{cost.deposit}</strong>
          </div>

          {preflight ? (
            <p className={underfunded ? 'duel-preflight duel-preflight-short' : 'duel-preflight'}>
              {underfunded ? <WarningCircleIcon size={15} weight="fill" /> : null}
              {preflight.summary}
            </p>
          ) : null}

          <p className={styles.safety}>
            Nothing moves until you approve {cost.deposit} in your wallet. DailyDraft verifies the
            exact transfer before broadcasting it, then opens this sealed pack automatically.
          </p>

          {!walletCanSignTransaction ? (
            <p className="duel-preflight duel-preflight-short mt-4" role="alert">
              <WarningCircleIcon size={15} weight="fill" />
              This wallet only supports combined sign-and-send. Choose a wallet that supports safe
              sign-first payments.
            </p>
          ) : null}

          {error ? (
            <p className="duel-preflight duel-preflight-short mt-4" role="alert">
              <WarningCircleIcon size={15} weight="fill" />
              {error}
            </p>
          ) : null}

          <button
            className={styles.primary}
            disabled={underfunded || !walletCanSignTransaction}
            onClick={onConfirm}
            type="button"
          >
            <SparkleIcon size={17} weight="fill" />
            Approve {cost.deposit}
          </button>

          <details className={styles.details}>
            <summary>Payment details</summary>
            <div className={styles.detailsBody}>
              <dl className={styles.technical}>
                <div>
                  <dt>Network fee</dt>
                  <dd>{cost.networkFee}</dd>
                </div>
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
            </div>
          </details>
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
        <div
          className={`${styles.statusCard} ${recoveryInvalid ? styles.warning : ''}`}
          role="status"
        >
          <span className={styles.statusIcon}>
            {recoveryInvalid ? (
              <WarningCircleIcon size={22} weight="fill" />
            ) : (
              <SpinnerGapIcon className="wallet-spinner" size={22} />
            )}
          </span>
          <h3>
            {recovery?.status === 'signed-claim-pending'
              ? 'Securing your pack'
              : recoveryInvalid
                ? 'Your previous rip needs attention'
                : 'Finishing your rip'}
          </h3>
          <p>
            {recovery?.status === 'signed-claim-pending'
              ? 'Your payment was not sent. We will retry the same signed payment—never a second charge or wallet prompt.'
              : recoveryInvalid
                ? 'Do not approve another payment. Your saved recovery record needs operator review.'
                : broadcastUnknown
                  ? 'We are checking the previous attempt before another payment can be approved.'
                  : 'Your pack is safe. DailyDraft will continue from the last verified step.'}
          </p>

          {walletAuthenticationPending ? (
            <p>Restoring your wallet session before recovery…</p>
          ) : recovery && walletAddress && !recoveryWalletMatches ? (
            <p>Reconnect the wallet that started this rip to continue safely.</p>
          ) : null}

          {recoveryActionable || (!recovery && intent && prepared && !broadcastUnknown) ? (
            <button className={styles.secondary} onClick={onResume} type="button">
              Try recovery now
            </button>
          ) : null}

          <details className={styles.details}>
            <summary>Recovery details</summary>
            <div className={styles.detailsBody}>
              <p>{error ?? stageCopy.detail}</p>
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
            </div>
          </details>
        </div>
      ) : null}

      {stage === 'delivery-failed' && result ? (
        <div className={`${styles.statusCard} ${styles.warning}`} role="alert">
          <span className={styles.statusIcon}>
            <WarningCircleIcon size={22} weight="fill" />
          </span>
          <h3>Card delivery is delayed</h3>
          <p>
            Your deposit settled, but the card provider did not finish delivery. This rip is locked
            for operator reconciliation and refund review.
          </p>
          <button className={styles.secondary} onClick={onReset} type="button">
            Return to packs
          </button>
          <details className={styles.details}>
            <summary>Refund details</summary>
            <div className={styles.detailsBody}>
              <ReceiptSummary
                facts={[
                  ['Rip', shorten(result.rip.id)],
                  ['Failure reason', result.rip.failureReason ?? 'Provider delivery failed'],
                  ['Failed asset', result.rip.failedAssetReference ?? 'Not recorded'],
                  [
                    'Server seed proof',
                    result.serverSeed
                      ? 'Verified against the pre-payment commitment'
                      : 'Unavailable',
                  ],
                ]}
                title="Refund reconciliation"
              />
            </div>
          </details>
        </div>
      ) : null}

      {stage === 'revealed' && reveal && result ? (
        <div className={styles.reveal}>
          <div data-rarity={reveal.rarity?.band}>
            {revealEvidenceMatches && reveal.rarity && reveal.imageUrl ? (
              <GachaRevealScene
                cardImageUrl={reveal.imageUrl}
                displayName={reveal.displayName}
                rarity={engineRarityForGachaBand(reveal.rarity.band)}
                revealId={result.rip.id}
              />
            ) : reveal.imageUrl ? (
              <div className="relative mx-auto aspect-[2.5/3.5] w-full max-w-60 overflow-hidden rounded-xl border border-border bg-tertiary">
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
              <div className="mx-auto grid aspect-[2.5/3.5] w-full max-w-60 place-items-center rounded-xl border border-border bg-tertiary text-sm text-secondary">
                {reveal.displayName}
              </div>
            )}
          </div>
          <div className={styles.reward}>
            <p className={styles.rarity}>
              <CheckCircleIcon size={16} weight="fill" />{' '}
              {revealEvidenceMatches ? (reveal.rarity?.label ?? 'Revealed') : 'Rarity pending'}
            </p>
            <h3>{reveal.displayName}</h3>
            <p>
              {revealEvidenceMatches
                ? (reveal.rarity?.blurb ?? 'The committed pack is open and the pull is final.')
                : 'The pull is final. Matching sealed rarity evidence is still loading.'}
            </p>
            <div className={styles.value}>
              <span>Insured value</span>
              <strong>{reveal.insuredValue}</strong>
            </div>
            <button className={styles.primary} onClick={onReset} type="button">
              <SparkleIcon size={17} weight="fill" />
              Rip another · {cost.packTier}
            </button>
            <details className={styles.details}>
              <summary>Verified receipt</summary>
              <div className={styles.detailsBody}>
                <ReceiptSummary
                  facts={[
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
              </div>
            </details>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

export function formatChance(ppm: number, scalePpm: number): string {
  if (!Number.isFinite(ppm) || !Number.isFinite(scalePpm) || scalePpm <= 0) return '—';
  return `${((ppm / scalePpm) * 100).toFixed(1)}%`;
}

export function shorten(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

function PackStage({
  detail,
  label,
  price,
  sport,
  sportLabel,
}: {
  detail: string;
  label: string;
  price: string;
  sport: FlipSport;
  sportLabel: string;
}) {
  return (
    <div className={styles.stage}>
      <div>
        <div className={styles.packWrap} aria-hidden="true">
          <span className={styles.halo} />
          <div className={styles.pack} data-sport={sport}>
            <span className={styles.packMark}>
              <CardsThreeIcon size={25} weight="fill" />
            </span>
            <span className={styles.packCopy}>
              <small>DailyDraft sealed</small>
              <strong>{sportLabel}</strong>
              <span>{price}</span>
            </span>
          </div>
        </div>
        <p aria-live="polite" className={styles.phase}>
          <strong>{label}</strong>
          <span>{detail}</span>
        </p>
      </div>
    </div>
  );
}

function Choice({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-pressed={active} className={styles.choice} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function FairnessDetails({
  odds,
  serverSeedHash,
  snapshotCount,
}: {
  odds: NonNullable<FlipMachineState['odds']>;
  serverSeedHash: string | null;
  snapshotCount: number | undefined;
}) {
  const probabilities = [
    ['Base', odds.baseProbabilityPpm],
    ['Plus', odds.plusProbabilityPpm],
    ['Premium', odds.premiumProbabilityPpm],
    ['Chase', odds.chaseProbabilityPpm],
  ] as const;

  return (
    <details className={styles.details}>
      <summary>Odds &amp; fairness</summary>
      <div className={styles.detailsBody}>
        <div className={styles.probabilities}>
          {probabilities.map(([band, ppm]) => (
            <div className={styles.probability} key={band}>
              <strong>{formatChance(ppm, odds.probabilityScalePpm)}</strong>
              <span>{band}</span>
            </div>
          ))}
        </div>
        <dl className={styles.technical}>
          <div>
            <dt>Possible cards</dt>
            <dd>{snapshotCount ?? 'Loading'}</dd>
          </div>
          <div>
            <dt>Odds key</dt>
            <dd>{shorten(odds.oddsKey)}</dd>
          </div>
          <div>
            <dt>Rules hash</dt>
            <dd>{shorten(odds.rulesHash)}</dd>
          </div>
          {serverSeedHash ? (
            <div>
              <dt>Seed commitment</dt>
              <dd>{shorten(serverSeedHash)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </details>
  );
}

function StatusCard({
  detail,
  title,
  warning = false,
}: {
  detail: string;
  title: string;
  warning?: boolean;
}) {
  return (
    <div className={`${styles.statusCard} ${warning ? styles.warning : ''}`} role="status">
      <span className={styles.statusIcon}>
        <WarningCircleIcon size={22} weight="fill" />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
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
    <div aria-live="polite" className={styles.statusCard} role="status">
      <span className={styles.statusIcon}>
        <SpinnerGapIcon className="wallet-spinner" size={22} />
      </span>
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
    <div className={styles.sheet}>
      <div className={styles.sheetHeading}>
        <WalletIcon size={23} weight="fill" />
        <h3>Connect to open this pack</h3>
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
    <div role="status">
      <div className="flex items-center gap-3 text-lime">
        <ReceiptIcon size={20} weight="fill" />
        <strong className="text-sm">{title}</strong>
      </div>
      <dl className={styles.technical}>
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
