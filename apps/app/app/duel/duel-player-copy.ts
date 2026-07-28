import type { DurableDuel, MatchmakingSession } from '../solana/duel-client';

export const prohibitedPrimaryUiTerms = [
  'persisted',
  'canonical',
  'reconciliation',
  'durable',
  'intent',
  'valuation-policy',
] as const;

export type DuelPlayerStatusCopy = {
  detail: string;
  headline: string;
  nextAction: string | null;
};

export const duelRules = [
  {
    body: 'Each participant separately approves and escrows the exact test-SOL platform fee shown before signing. Normal Solana network fees and recoverable token-account rent are additional. The demo-pool value is not charged or purchased.',
    title: 'What you pay',
  },
  {
    body: 'The selected $25, $50, or $100 tier is a label for a server-provided DailyDraft Pokémon demo pool—not an amount charged. Pool contents can change; Collector Crypt production packs and commercial odds are not active.',
    title: 'Demo-pool source and odds',
  },
  {
    body: 'The server compares its demo outcomes using the verified value snapshot recorded for the duel. Check the public receipt for the result and current asset state.',
    title: 'How the winner is chosen',
  },
  {
    body: 'Equal values return each original card and refund both platform fees.',
    title: 'Ties',
  },
  {
    body: 'A challenge can be cancelled before funding starts. After either wallet pays, the duel follows its opening, settlement, or safe-refund path.',
    title: 'Cancellation',
  },
  {
    body: 'This preview uses test SOL and valueless demo collectibles on Solana devnet. No mainnet funds or Collector Crypt inventory are involved.',
    title: 'Devnet limits',
  },
] as const;

export function getLobbyEconomicsCopy(): string {
  return 'Choose a server-provided demo-pool tier, then separately approve your displayed test-SOL platform fee. The pool value is not charged or purchased, and opening starts only after both participants’ fees finalize.';
}

type MatchmakingSearchSession = Pick<MatchmakingSession, 'state'> & {
  queue: Pick<MatchmakingSession['queue'], 'tier'>;
};

export function getMatchmakingSearchCopy(session: MatchmakingSearchSession): string | null {
  if (session.state !== 'searching') return null;
  return `Searching for an opponent in the $${session.queue.tier} demo pool. You can continue or cancel before funding starts.`;
}

export function getDuelPaymentReviewCopy(feeAmountSol: string) {
  return {
    description: `Your platform fee is exactly ${feeAmountSol} test SOL and is approved separately from the other participant’s fee. Your wallet also shows the network fee and any recoverable rent. No pack or demo-pool value is purchased.`,
    heading: 'Review your duel payment',
    rows: [
      { label: 'Platform fee now', value: `${feeAmountSol} SOL` },
      { label: 'Additional costs', value: 'Network fee + recoverable rent' },
      { label: 'Demo-pool value', value: 'Not charged or purchased' },
      { label: 'Opening begins', value: 'After both fees finalize' },
      { label: 'Asset state', value: 'Shown on the public receipt' },
      { label: 'Cancellation', value: 'Before funding starts' },
    ],
    safety:
      'Your wallet will show the platform fee, network fee, and any recoverable account rent.',
    title: 'Pay the devnet platform fee',
  } as const;
}

export function getDuelPlayerStatus(
  status: DurableDuel['status'],
  hasMatchmakingSession = false,
): DuelPlayerStatusCopy {
  if (status === 'waiting' && hasMatchmakingSession) {
    return {
      detail: 'Your seat is open in the public wallet queue.',
      headline: 'Looking for an opponent',
      nextAction: 'Keep searching or cancel before funding starts.',
    };
  }

  const copy: Record<DurableDuel['status'], DuelPlayerStatusCopy> = {
    awaiting_assets: {
      detail:
        'The result, including a possible tie, is already decided while both demo cards enter the duel vault.',
      headline: 'Cards are moving into the duel',
      nextAction: 'Keep this page open while devnet finishes the transfers.',
    },
    cancelled: {
      detail: 'The duel closed before both wallets paid. No cards changed hands.',
      headline: 'Duel cancelled',
      nextAction: 'Start another duel when you are ready.',
    },
    cancelling: {
      detail: 'No winner will be shown while the cancellation finishes.',
      headline: 'Closing this duel',
      nextAction: 'Keep this page open until the cancellation completes.',
    },
    committing: {
      detail: 'One or both platform-fee payments are still confirming on Solana devnet.',
      headline: 'Waiting for both payments',
      nextAction: 'Approve your displayed fee if prompted, then leave this page open.',
    },
    failed: {
      detail: 'No winner is shown, and your current progress remains available.',
      headline: 'This duel needs attention',
      nextAction: 'Refresh once. If it still fails, return to the lobby and retry.',
    },
    funded: {
      detail: 'Pack opening can start now, and neither player can cancel the funded duel.',
      headline: 'Both wallets paid',
      nextAction: 'Keep this page open while both packs are prepared.',
    },
    matched: {
      detail: 'The challenge creator pays first, and the other wallet pays next.',
      headline: 'Opponent found',
      nextAction: 'The challenge creator approves first; the other wallet is prompted next.',
    },
    opening: {
      detail: 'Both pack results stay hidden until the provider has recorded both pulls.',
      headline: 'Both packs are opening',
      nextAction: 'Keep this page open for the synchronized reveal.',
    },
    refunded: {
      detail: 'Both platform-fee payments were returned, and no winner was claimed.',
      headline: 'Payments returned',
      nextAction: 'Start another duel when you are ready.',
    },
    refunding: {
      detail: 'Solana devnet is returning both platform-fee payments.',
      headline: 'Returning both payments',
      nextAction: 'Keep this page open until both returns complete.',
    },
    settled: {
      detail:
        'The committed result is final. The public receipt shows whether one pull led or the values tied.',
      headline: 'Duel complete',
      nextAction: 'View the public receipt or start another duel.',
    },
    settling: {
      detail:
        'The committed comparison is final while Solana devnet completes settlement or return.',
      headline: 'Result committed; settlement is finishing',
      nextAction: 'Keep this page open until the final settlement completes.',
    },
    waiting: {
      detail: 'Your challenge is open, and no payment has been requested yet.',
      headline: 'Challenge ready to share',
      nextAction: 'Share the challenge link or cancel before funding starts.',
    },
  };

  return copy[status] ?? copy.failed;
}

export function getFundingStatusNotice(
  duel: Pick<DurableDuel, 'status'>,
  activeTransactionCount: number,
): string {
  if (activeTransactionCount > 0) {
    return 'Your payment is still confirming on Solana devnet. Refresh this duel before retrying so verification can continue without submitting a duplicate payment.';
  }
  if (duel.status === 'funded') return 'Both wallets paid. Pack opening can start now.';
  if (duel.status === 'committing') {
    return 'Your payment completed. Waiting for the other wallet to pay.';
  }
  const copy = getDuelPlayerStatus(duel.status);
  return `${copy.headline}. ${copy.nextAction ?? copy.detail}`;
}

export function getPlayerActionError(
  error: unknown,
  fallback: string,
  transactionMayHaveBeenSubmitted = false,
  transactionWasSubmitted = false,
): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (transactionWasSubmitted) {
    return 'The payment may have been sent to Solana devnet, but confirmation could not be verified. Refresh this duel before retrying so you do not submit a duplicate payment.';
  }

  if (
    message.includes('reject') ||
    message.includes('declin') ||
    message.includes('cancelled by user')
  ) {
    return 'Nothing was submitted. Review the payment and approve it in your wallet when ready.';
  }

  if (transactionMayHaveBeenSubmitted) {
    return 'The payment may have been sent to Solana devnet, but confirmation could not be verified. Refresh this duel before retrying so you do not submit a duplicate payment.';
  }

  if (
    message.includes('unauthorized') ||
    message.includes('authentication') ||
    message.includes('wallet session') ||
    message.includes('authentication session') ||
    message.includes('session token') ||
    message.includes('401')
  ) {
    return 'Your wallet session expired. Re-authenticate from the wallet menu, then retry.';
  }

  if (
    message.includes('network') ||
    message.includes('rpc') ||
    message.includes('timeout') ||
    message.includes('unavailable') ||
    message.includes('failed to fetch') ||
    message.includes('503')
  ) {
    return 'Solana devnet is temporarily unavailable. Check your connection, then retry; your current progress is unchanged.';
  }

  return `${fallback} Try again; your current duel progress is unchanged.`;
}
