'use client';

import {
  CheckCircleIcon,
  LockKeyIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Button, Separator } from '@shipshitdev/ui';
import { useEffect } from 'react';
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
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, pending]);

  return (
    <div className="intent-dialog-backdrop" role="presentation">
      <section
        className="intent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intent-dialog-title"
      >
        <div className="intent-dialog-heading">
          <div>
            <span className="network-chip">
              <i /> Solana {intent.cluster}
            </span>
            <h2 id="intent-dialog-title">Review transaction intent</h2>
          </div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Close review">
            <XIcon size={18} />
          </button>
        </div>

        <div className="intent-title">
          <LockKeyIcon size={22} weight="fill" />
          <div>
            <strong>Fund your duel platform fee</strong>
            <p>
              Wrap and deposit exactly {intent.feeAmountSol} SOL into the verified devnet escrow.
            </p>
          </div>
        </div>

        <dl className="intent-details">
          <div>
            <dt>Funding side</dt>
            <dd>{intent.fundingSide}</dd>
          </div>
          <div>
            <dt>Platform fee</dt>
            <dd>{intent.feeAmountSol} WSOL</dd>
          </div>
          <div className="intent-total">
            <dt>Pack purchase</dt>
            <dd>Not included</dd>
          </div>
          <div>
            <dt>Wallet</dt>
            <dd>{shorten(intent.wallet)}</dd>
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

        <div className="intent-notice">
          <CheckCircleIcon size={18} weight="fill" />
          <span>
            The full unsigned message is integrity-bound. Your wallet will broadcast it only after
            your approval.
          </span>
        </div>

        <ul className="intent-warnings">
          {intent.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>

        {error ? (
          <div className="intent-error" role="alert">
            <WarningCircleIcon size={17} weight="fill" /> {error}
          </div>
        ) : null}

        <Separator className="bg-border" />
        <div className="intent-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" className="intent-confirm" onClick={onConfirm} disabled={pending}>
            {pending ? <SpinnerGapIcon className="wallet-spinner" size={17} /> : null}
            {pending ? 'Waiting for wallet' : 'Review and broadcast'}
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
