'use client';

import {
  CheckCircleIcon,
  LockKeyIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Button, Separator } from '@shipshitdev/ui';
import { useDialogFocus } from '../accessibility/use-dialog-focus';
import { getDuelPaymentReviewCopy } from '../duel/duel-player-copy';
import { journeyTestIds } from '../e2e/journey-test-ids';
import type { DuelTransactionIntent } from './duel-client';

type TransactionIntentReviewProps = {
  intent: DuelTransactionIntent;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function TransactionIntentReview({
  intent,
  pending,
  error,
  onClose,
  onConfirm,
}: TransactionIntentReviewProps) {
  const copy = getDuelPaymentReviewCopy(intent.feeAmountSol);
  const dialogRef = useDialogFocus({
    active: true,
    closeOnEscape: !pending,
    onClose,
  });

  return (
    <div className="intent-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="intent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intent-dialog-title"
        aria-describedby="intent-dialog-description"
        aria-busy={pending}
        tabIndex={-1}
        data-testid={journeyTestIds.transactionDialog}
      >
        <div className="intent-dialog-heading">
          <div>
            <span className="network-chip">
              <i /> Solana {intent.cluster}
            </span>
            <h2 id="intent-dialog-title">{copy.heading}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Close review">
            <XIcon size={18} />
          </button>
        </div>

        <div className="intent-title">
          <LockKeyIcon size={22} weight="fill" />
          <div>
            <strong data-testid={journeyTestIds.transactionPurpose}>{copy.title}</strong>
            <p data-testid={journeyTestIds.transactionValue}>{copy.description}</p>
          </div>
        </div>

        <dl className="intent-details">
          {copy.rows.map((row, index) => (
            <div className={index === 0 ? 'intent-total' : undefined} key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
          <div>
            <dt>Your turn</dt>
            <dd data-testid={journeyTestIds.transactionTurn}>
              {intent.fundingSide === 'creator' ? 'You pay first' : 'You pay second'}
            </dd>
          </div>
          <div>
            <dt>Approve by</dt>
            <dd>
              {new Date(intent.expiresAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </dd>
          </div>
        </dl>

        <div id="intent-dialog-description" className="intent-notice">
          <CheckCircleIcon size={18} weight="fill" />
          <span>{copy.safety}</span>
        </div>

        {intent.warnings.length > 0 ? (
          <ul className="intent-warnings">
            {intent.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        <details className="intent-advanced">
          <summary>Advanced</summary>
          <dl className="intent-details intent-technical-details">
            <div>
              <dt>Wallet</dt>
              <dd data-testid={journeyTestIds.transactionAdvancedWallet}>
                {shorten(intent.wallet)}
              </dd>
            </div>
            <div>
              <dt>Escrow PDA</dt>
              <dd>{shorten(intent.escrowAddress)}</dd>
            </div>
            <div>
              <dt>Program</dt>
              <dd>{shorten(intent.programId)}</dd>
            </div>
            <div>
              <dt>Fee recipient</dt>
              <dd>{shorten(intent.feeRecipient)}</dd>
            </div>
          </dl>
        </details>

        {error ? (
          <div className="intent-error" role="alert">
            <WarningCircleIcon size={17} weight="fill" /> {error}
          </div>
        ) : null}

        <Separator className="bg-border" />
        <div className="intent-actions" aria-live="polite">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={pending}
            data-dialog-initial-focus
            data-testid={journeyTestIds.transactionCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="intent-confirm"
            onClick={onConfirm}
            disabled={pending}
            data-testid={journeyTestIds.transactionConfirm}
          >
            {pending ? <SpinnerGapIcon className="wallet-spinner" size={17} /> : null}
            {pending ? 'Waiting for wallet' : 'Approve fee in wallet'}
          </Button>
        </div>
        <p className="intent-safety">
          Pack Duel will never ask for your private key or seed phrase.
        </p>
      </section>
    </div>
  );
}

function shorten(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}
