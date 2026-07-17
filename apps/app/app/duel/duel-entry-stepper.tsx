'use client';

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  LockKeyIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  WalletIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Button, Separator } from '@shipshitdev/ui';
import Image from 'next/image';
import { useEffect, useRef } from 'react';
import type {
  DuelOpponentType,
  DuelTransactionIntent,
  DurableDuel,
} from '../solana/duel-client';
import { useWalletAuth } from '../solana/wallet-auth-provider';
import { useSolanaWallet } from '../solana/wallet-provider';
import { getDuelEntryStage, getPlainMoneySummary } from './duel-entry-flow';

type DuelEntryStepperProps = {
  error: string | null;
  fundingPhase: 'idle' | 'signing' | 'confirming' | 'recovering';
  intent: DuelTransactionIntent | null;
  mode: DuelOpponentType;
  notice: string | null;
  onCancel: () => Promise<void>;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onPrepare: () => Promise<void>;
  onResume: () => Promise<void>;
  pending: boolean;
  persistedDuel: DurableDuel | null;
  tier: number;
};

export function DuelEntryStepper({
  error,
  fundingPhase,
  intent,
  mode,
  notice,
  onCancel,
  onClose,
  onConfirm,
  onPrepare,
  onResume,
  pending,
  persistedDuel,
  tier,
}: DuelEntryStepperProps) {
  const wallet = useSolanaWallet();
  const authentication = useWalletAuth();
  const dialog = useRef<HTMLElement>(null);
  const stage = getDuelEntryStage({
    authenticationStatus: authentication.status,
    error,
    fundingPhase,
    hasSession: Boolean(authentication.sessionToken),
    intent,
    networkStatus: wallet.networkStatus,
    pending,
    persistedStatus: persistedDuel?.status ?? null,
    walletAddress: wallet.address,
  });
  const blocking =
    pending ||
    fundingPhase === 'signing' ||
    fundingPhase === 'confirming' ||
    authentication.status === 'signing';
  const canCancel =
    fundingPhase === 'idle' &&
    (!persistedDuel ||
      persistedDuel.status === 'waiting' ||
      persistedDuel.status === 'matched' ||
      persistedDuel.status === 'failed');

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    function containDialogFocus(event: KeyboardEvent) {
      if (event.key === 'Escape' && !blocking) onClose();
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = getFocusableElements(dialog.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener('keydown', containDialogFocus);
    return () => window.removeEventListener('keydown', containDialogFocus);
  }, [blocking, onClose]);

  return (
    <div className="duel-stepper-backdrop" role="presentation" data-testid="duel-entry-backdrop">
      <section
        ref={dialog}
        className="duel-stepper-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duel-stepper-title"
        data-stage={stage}
        data-testid="duel-entry-stepper"
        tabIndex={-1}
      >
        <div className="duel-stepper-heading">
          <div>
            <span className={`network-chip network-${wallet.networkStatus}`}>
              <i /> Solana devnet · {wallet.networkStatus}
            </span>
            <h2 id="duel-stepper-title">Enter this duel</h2>
            <p>Connect, verify, review, and fund without losing your place.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={blocking}
            aria-label="Continue this duel later"
            data-testid="duel-entry-close"
          >
            <XIcon size={18} />
          </button>
        </div>

        <ol className="duel-stepper-progress" aria-label="Duel entry progress">
          {['Connect', 'Verify', 'Review', 'Fund'].map((label, index) => {
            const progress = stageProgress(stage);
            return (
              <li
                key={label}
                className={
                  index + 1 < progress
                    ? 'duel-step-complete'
                    : index + 1 === progress
                      ? 'duel-step-active'
                      : ''
                }
              >
                <span>{index + 1 < progress ? <CheckCircleIcon weight="fill" /> : index + 1}</span>
                {label}
              </li>
            );
          })}
        </ol>

        <div className="duel-stepper-content">
          {stage === 'connect' ? <ConnectStep /> : null}
          {stage === 'authenticate' ? <AuthenticateStep /> : null}
          {stage === 'review' ? (
            <ReviewStep
              mode={mode}
              tier={tier}
              pending={pending}
              onPrepare={onPrepare}
              networkChecking={wallet.networkStatus === 'checking'}
            />
          ) : null}
          {stage === 'preparing' ? (
            <ProgressStep
              label="Preparing funding"
              detail="Creating or restoring the duel, then calculating the exact devnet fee."
            />
          ) : null}
          {stage === 'funding-review' && intent ? (
            <FundingReviewStep
              intent={intent}
              tier={tier}
              pending={pending}
              onConfirm={onConfirm}
            />
          ) : null}
          {stage === 'funding-signature' ? (
            <ProgressStep
              label="Value-bearing transaction"
              detail="Your wallet is waiting for an explicit approval to move the displayed devnet fee."
              signature="Transaction signature · moves test SOL"
            />
          ) : null}
          {stage === 'confirming' ? (
            <ProgressStep
              label="Confirming escrow funding"
              detail="The transaction was broadcast. Pack Duel is verifying finalized escrow state and will advance automatically."
            />
          ) : null}
          {stage === 'waiting' ? (
            <WaitingStep status={persistedDuel?.status ?? null} notice={notice} />
          ) : null}
          {stage === 'complete' ? (
            <CompleteStep status={persistedDuel?.status ?? null} />
          ) : null}
          {stage === 'recovery' ? (
            <RecoveryStep
              error={error}
              offline={wallet.networkStatus === 'offline'}
              persistedStatus={persistedDuel?.status ?? null}
              pending={pending}
              postBroadcast={fundingPhase === 'recovering'}
              onRetryNetwork={wallet.retryNetwork}
              onResume={onResume}
            />
          ) : null}
        </div>

        {authentication.error ? (
          <StepperError message={authentication.error} onDismiss={authentication.clearError} />
        ) : null}
        {wallet.error ? <StepperError message={wallet.error} onDismiss={wallet.clearError} /> : null}
        {error && stage !== 'recovery' ? (
          <StepperError message={error} />
        ) : null}
        {notice && stage !== 'waiting' ? <p className="duel-stepper-notice">{notice}</p> : null}

        <Separator className="bg-border" />
        <div className="duel-stepper-footer">
          <p>
            Closing keeps a local recovery pointer, never a session token, signature, or private
            key.
          </p>
          <div>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={blocking}
              data-testid="duel-entry-continue-later"
            >
              Continue later
            </Button>
            {canCancel ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                disabled={blocking}
                data-testid="duel-entry-cancel"
              >
                {persistedDuel ? 'Cancel duel' : 'Cancel entry'}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function ConnectStep() {
  const wallet = useSolanaWallet();
  return (
    <div className="duel-step-panel">
      <div className="duel-step-title">
        <WalletIcon size={23} weight="fill" />
        <div>
          <span>Step 1</span>
          <h3>Connect your Solana wallet</h3>
          <p>This keeps your selected pack and opponent ready for the next step.</p>
        </div>
      </div>
      {wallet.wallets.length > 0 ? (
        <div className="wallet-list">
          {wallet.wallets.map((availableWallet) => (
            <button
              type="button"
              key={availableWallet.name}
              disabled={wallet.status === 'connecting'}
              onClick={() => wallet.connect(availableWallet)}
              data-testid="duel-entry-connect-wallet"
            >
              <Image src={availableWallet.icon} alt="" width={30} height={30} unoptimized />
              <span className="wallet-list-copy">
                <strong>{availableWallet.name}</strong>
                <small>Wallet Standard · devnet</small>
              </span>
              {wallet.status === 'connecting' ? (
                <SpinnerGapIcon className="wallet-spinner" size={17} />
              ) : (
                <span aria-hidden="true">→</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="wallet-empty-state">
          <WalletIcon size={30} />
          <strong>No compatible Solana wallet found</strong>
          <p>Install a Wallet Standard wallet, refresh, then resume this saved entry.</p>
        </div>
      )}
    </div>
  );
}

function AuthenticateStep() {
  const authentication = useWalletAuth();
  return (
    <div className="duel-step-panel">
      <div className="duel-step-title">
        <ShieldCheckIcon size={23} weight="fill" />
        <div>
          <span>Step 2</span>
          <h3>Verify wallet ownership</h3>
          <p>This readable authentication signature cannot move funds.</p>
        </div>
      </div>
      <div className="duel-signature-kind">
        <ShieldCheckIcon size={17} />
        <span>
          <strong>Authentication signature</strong>
          No transaction · no fee · no asset movement
        </span>
      </div>
      {authentication.challenge ? (
        <div className="wallet-auth-message">
          <p>Review the exact message your wallet will sign:</p>
          <pre>{authentication.challenge.message}</pre>
          <Button
            type="button"
            onClick={authentication.signIn}
            disabled={authentication.status === 'signing'}
            data-testid="duel-entry-auth-sign"
          >
            {authentication.status === 'signing' ? (
              <SpinnerGapIcon className="wallet-spinner" size={17} />
            ) : (
              <ShieldCheckIcon size={17} weight="fill" />
            )}
            {authentication.status === 'signing'
              ? 'Waiting for authentication signature'
              : 'Sign authentication message'}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          onClick={authentication.prepare}
          disabled={authentication.status === 'preparing'}
          data-testid="duel-entry-auth-prepare"
        >
          {authentication.status === 'preparing' ? (
            <SpinnerGapIcon className="wallet-spinner" size={17} />
          ) : (
            <ShieldCheckIcon size={17} />
          )}
          {authentication.status === 'preparing'
            ? 'Preparing authentication'
            : authentication.error
              ? 'Retry authentication'
              : 'Review authentication message'}
        </Button>
      )}
    </div>
  );
}

function ReviewStep({
  mode,
  networkChecking,
  onPrepare,
  pending,
  tier,
}: {
  mode: DuelOpponentType;
  networkChecking: boolean;
  onPrepare: () => Promise<void>;
  pending: boolean;
  tier: number;
}) {
  return (
    <div className="duel-step-panel">
      <div className="duel-step-title">
        <LockKeyIcon size={23} weight="fill" />
        <div>
          <span>Step 3</span>
          <h3>Review the money before any wallet prompt</h3>
          <p>The exact platform fee appears here before a value-bearing signature is requested.</p>
        </div>
      </div>
      <div className="duel-entry-selection">
        <span>
          Selected pack <strong>${tier.toFixed(2)}</strong>
        </span>
        <span>
          Opponent <strong>{modeLabel(mode)}</strong>
        </span>
        <p>
          Continue to calculate the fee. The next screen is the single money summary shown before
          any transaction wallet prompt.
        </p>
      </div>
      <Button
        type="button"
        onClick={onPrepare}
        disabled={pending || networkChecking}
        className="duel-stepper-primary"
        data-testid="duel-entry-prepare-funding"
      >
        {pending || networkChecking ? (
          <SpinnerGapIcon className="wallet-spinner" size={17} />
        ) : (
          <LockKeyIcon size={17} />
        )}
        {networkChecking ? 'Checking Solana devnet' : 'Continue to exact fee review'}
      </Button>
    </div>
  );
}

function FundingReviewStep({
  intent,
  onConfirm,
  pending,
  tier,
}: {
  intent: DuelTransactionIntent;
  onConfirm: () => Promise<void>;
  pending: boolean;
  tier: number;
}) {
  const summary = getPlainMoneySummary(tier, intent);
  return (
    <div className="duel-step-panel">
      <div className="duel-step-title">
        <LockKeyIcon size={23} weight="fill" />
        <div>
          <span>Step 4</span>
          <h3>Approve the exact devnet fee</h3>
          <p>This is the only value-bearing wallet request in the entry flow.</p>
        </div>
      </div>
      <div className="duel-signature-kind duel-signature-value">
        <WarningCircleIcon size={17} weight="fill" />
        <span>
          <strong>Value-bearing transaction</strong>
          Moves {summary.walletApproval} after your explicit wallet approval
        </span>
      </div>
      <dl className="duel-money-summary">
        <div>
          <dt>Pack tier</dt>
          <dd>{summary.packTier}</dd>
        </div>
        <div>
          <dt>Pack purchase</dt>
          <dd>{summary.packPurchase}</dd>
        </div>
        <div>
          <dt>Platform fee</dt>
          <dd>{summary.platformFee}</dd>
        </div>
        <div className="duel-money-total">
          <dt>Wallet approval</dt>
          <dd>{summary.walletApproval}</dd>
        </div>
      </dl>
      <details className="duel-technical-details">
        <summary>Technical transaction details</summary>
        <dl>
          <div>
            <dt>Funding side</dt>
            <dd>{intent.fundingSide}</dd>
          </div>
          <div>
            <dt>Escrow</dt>
            <dd>{shorten(intent.escrowAddress)}</dd>
          </div>
          <div>
            <dt>Program</dt>
            <dd>{shorten(intent.programId)}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>
              {new Date(intent.expiresAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </dd>
          </div>
        </dl>
      </details>
      {intent.warnings.length > 0 ? (
        <ul className="intent-warnings">
          {intent.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className="duel-stepper-primary"
        data-testid="duel-entry-confirm-funding"
      >
        <LockKeyIcon size={17} weight="fill" />
        Approve {intent.feeAmountSol} SOL in wallet
      </Button>
    </div>
  );
}

function ProgressStep({
  detail,
  label,
  signature,
}: {
  detail: string;
  label: string;
  signature?: string;
}) {
  return (
    <div className="duel-step-panel duel-progress-panel" role="status" aria-live="polite">
      <SpinnerGapIcon className="wallet-spinner" size={30} />
      {signature ? <span className="duel-progress-signature">{signature}</span> : null}
      <h3>{label}</h3>
      <p>{detail}</p>
    </div>
  );
}

function WaitingStep({
  notice,
  status,
}: {
  notice: string | null;
  status: DurableDuel['status'] | null;
}) {
  return (
    <div className="duel-step-panel duel-progress-panel" role="status">
      <SpinnerGapIcon className="wallet-spinner" size={30} />
      <h3>{status === 'committing' ? 'Your funding is finalized' : 'Your place is saved'}</h3>
      <p>
        {notice ??
          (status === 'committing'
            ? 'Waiting for the other wallet to fund. You can close and resume without signing again.'
            : 'The duel or matchmaking search is durable. Close now or cancel it explicitly.')}
      </p>
    </div>
  );
}

function CompleteStep({ status }: { status: DurableDuel['status'] | null }) {
  return (
    <div className="duel-step-panel duel-progress-panel" role="status">
      <CheckCircleIcon className="duel-complete-icon" size={34} weight="fill" />
      <h3>Entry complete</h3>
      <p>
        Funding is finalized and the duel advanced automatically
        {status ? ` to ${status.replaceAll('_', ' ')}` : ''}.
      </p>
    </div>
  );
}

function RecoveryStep({
  error,
  offline,
  onResume,
  onRetryNetwork,
  pending,
  postBroadcast,
  persistedStatus,
}: {
  error: string | null;
  offline: boolean;
  onResume: () => Promise<void>;
  onRetryNetwork: () => Promise<boolean>;
  pending: boolean;
  postBroadcast: boolean;
  persistedStatus: DurableDuel['status'] | null;
}) {
  return (
    <div className="duel-step-panel">
      <div className="duel-step-title">
        <ArrowClockwiseIcon size={23} />
        <div>
          <span>Recovery</span>
          <h3>
            {postBroadcast
              ? 'Confirm the broadcast transaction'
              : offline
                ? 'Solana devnet is unreachable'
                : 'Resume this saved entry'}
          </h3>
          <p>
            {postBroadcast
              ? `The wallet may already have broadcast this transaction. ${
                  offline
                    ? 'Reconnect to devnet, then resume confirmation without signing or sending again.'
                    : 'Resume confirmation without signing or sending again.'
                }`
              : offline
                ? 'No transaction will open until the RPC responds on the expected network.'
                : error ??
                  (persistedStatus === 'matched'
                    ? 'The duel is matched. Refresh its funding intent, then approve it explicitly.'
                    : 'The previous attempt did not complete. Retry from the last safe boundary.')}
          </p>
          {error ? <p className="duel-recovery-error">{error}</p> : null}
        </div>
      </div>
      <Button
        type="button"
        onClick={offline ? onRetryNetwork : onResume}
        disabled={pending}
        className="duel-stepper-primary"
        data-testid="duel-entry-recovery"
      >
        {pending ? (
          <SpinnerGapIcon className="wallet-spinner" size={17} />
        ) : (
          <ArrowClockwiseIcon size={17} />
        )}
        {offline
          ? postBroadcast
            ? 'Retry devnet to resume confirmation'
            : 'Retry devnet connection'
          : postBroadcast
            ? 'Resume confirmation without signing'
            : 'Resume safely'}
      </Button>
    </div>
  );
}

function StepperError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="duel-stepper-error" role="alert">
      <WarningCircleIcon size={17} weight="fill" />
      <span>{message}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss error">
          <XIcon size={14} />
        </button>
      ) : null}
    </div>
  );
}

function stageProgress(stage: ReturnType<typeof getDuelEntryStage>): number {
  if (stage === 'connect') return 1;
  if (stage === 'authenticate') return 2;
  if (stage === 'review' || stage === 'preparing') return 3;
  return 4;
}

function modeLabel(mode: DuelOpponentType): string {
  if (mode === 'direct') return 'Invited wallet';
  if (mode === 'house') return 'Disclosed house';
  return 'Public matchmaking';
}

function shorten(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary, [tabindex]:not([tabindex="-1"])',
    ),
  );
}
