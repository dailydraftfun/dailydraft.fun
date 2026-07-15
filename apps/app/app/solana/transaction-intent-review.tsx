'use client';

import {
  CheckCircleIcon,
  InfoIcon,
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
            <strong>{intent.title}</strong>
            <p>{intent.description}</p>
          </div>
        </div>

        <dl className="intent-details">
          <div>
            <dt>Pack</dt>
            <dd>${intent.packTierUsd.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Platform fee</dt>
            <dd>${intent.platformFeeUsd.toFixed(2)}</dd>
          </div>
          <div className="intent-total">
            <dt>Maximum approval</dt>
            <dd>${intent.totalUsd.toFixed(2)} USDC</dd>
          </div>
          <div>
            <dt>Opponent</dt>
            <dd>{intent.counterparty}</dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd>{intent.recipientLabel}</dd>
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

        {intent.simulation ? (
          <div className="intent-notice intent-notice-preview">
            <InfoIcon size={18} weight="fill" />
            <span>
              Devnet preview: the API has not supplied a transaction, so this continues the demo
              without opening a wallet signature request or moving funds.
            </span>
          </div>
        ) : (
          <div className="intent-notice">
            <CheckCircleIcon size={18} weight="fill" />
            <span>
              A prepared devnet transaction is ready. Your wallet will show the final transaction
              before you approve it.
            </span>
          </div>
        )}

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
            {pending
              ? 'Waiting for wallet'
              : intent.simulation
                ? 'Continue devnet preview'
                : 'Review in wallet'}
          </Button>
        </div>
        <p className="intent-safety">
          Pack Duel will never ask for your private key or seed phrase.
        </p>
      </section>
    </div>
  );
}
