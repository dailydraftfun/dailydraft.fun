import type { PublicDuelReceipt, PublicDuelStatus } from './public-proof-client';
import { getDuelStatusPresentation } from './social-card-data';

export type ReceiptFinalityTone = 'attention' | 'neutral' | 'pending' | 'verified';

export type DuelReceiptPresentation = {
  accent: string;
  badge: string;
  finality: {
    detail: string;
    label: string;
    tone: ReceiptFinalityTone;
  };
  headline: string;
  outcomeStates: Array<{
    label: 'Runner-up' | 'Tie' | 'Winner';
    side: 'creator' | 'opponent';
  }>;
  statusLabel: string;
  subline: string;
};

export function getDuelReceiptPresentation(receipt: PublicDuelReceipt): DuelReceiptPresentation {
  const result = receipt.result;
  const copy = getDuelStatusPresentation(receipt.duel.status);
  const statusLabel = receipt.duel.status.replaceAll('_', ' ');
  if (!result) {
    const safeCopy =
      receipt.duel.status === 'settled'
        ? {
            ...copy,
            headline: 'Settlement recorded without result proof.',
            subline:
              'This receipt cannot name a winner or card owner until both committed pulls are available.',
          }
        : copy;
    return {
      ...safeCopy,
      finality: finalityWithoutResult(receipt),
      outcomeStates: [],
      statusLabel,
    };
  }

  const mockPreview =
    receipt.pack.providerMode === 'mock' || result.outcomes.some((outcome) => outcome.isMock);
  const settled = receipt.duel.status === 'settled';
  const headline = mockPreview
    ? 'Devnet result preview.'
    : !result.winner
      ? settled
        ? 'The duel ended in a tie.'
        : 'The committed pulls are tied.'
      : settled
        ? `${result.winner.display} won the vault.`
        : copy.headline;
  const subline = mockPreview
    ? 'Committed mock values compare both pulls without claiming real cards or ownership.'
    : !result.winner
      ? 'Equal authoritative values return each original card and both platform fees.'
      : copy.subline;

  return {
    accent: copy.accent,
    badge: mockPreview ? 'Devnet preview' : copy.badge,
    finality: finalityWithResult(receipt, mockPreview),
    headline,
    outcomeStates: result.outcomes.map((outcome) => ({
      label:
        result.winnerSide === null
          ? 'Tie'
          : outcome.side === result.winnerSide
            ? 'Winner'
            : 'Runner-up',
      side: outcome.side,
    })),
    statusLabel,
    subline,
  };
}

function finalityWithResult(
  receipt: PublicDuelReceipt,
  mockPreview: boolean,
): DuelReceiptPresentation['finality'] {
  if (mockPreview) {
    return {
      detail:
        'Committed mock values exercise the comparison flow but do not represent purchased cards or transferred assets.',
      label: 'Preview only · no ownership finality',
      tone: 'neutral',
    };
  }
  if (
    receipt.recovery.status === 'attention-required' ||
    receipt.cardActions.reason === 'ownership-mismatch'
  ) {
    return {
      detail:
        'The committed result remains visible, but recorded ownership conflicts with settlement evidence and requires review.',
      label: 'Result committed · ownership disputed',
      tone: 'attention',
    };
  }
  if (receipt.duel.status === 'settled' && receipt.cardActions.availability === 'available') {
    return {
      detail:
        'The result and exact finalized settlement reference agree on the current card owner.',
      label: 'Result verified · ownership finalized',
      tone: 'verified',
    };
  }
  if (receipt.duel.status === 'settled') {
    return {
      detail:
        'The result is final, but this receipt does not yet contain enough evidence to prove card ownership.',
      label: 'Result verified · ownership unproven',
      tone: 'pending',
    };
  }
  if (receipt.duel.status === 'refunded') {
    return {
      detail:
        'The committed result is retained as evidence, and the refund finalized without transferring card ownership.',
      label: 'Refund finalized · no ownership transfer',
      tone: 'verified',
    };
  }
  if (['cancelled', 'expired'].includes(receipt.duel.status)) {
    return {
      detail:
        'The committed result remains part of the receipt, but the duel closed without transferring card ownership.',
      label: 'Duel closed · result did not settle',
      tone: 'neutral',
    };
  }
  if (['awaiting_assets', 'settling'].includes(receipt.duel.status)) {
    return {
      detail:
        'Both pull values are committed. Card ownership remains pending until settlement finalizes.',
      label: 'Result committed · ownership pending',
      tone: 'pending',
    };
  }
  return {
    detail: `A committed result exists while the duel is ${formatStatus(receipt.duel.status)}; ownership is not final.`,
    label: 'Result retained · ownership not final',
    tone: 'attention',
  };
}

function finalityWithoutResult(receipt: PublicDuelReceipt): DuelReceiptPresentation['finality'] {
  if (receipt.recovery.status === 'attention-required' || receipt.duel.status === 'failed') {
    return {
      detail: 'Recovery evidence is available below. No winner or card owner is inferred.',
      label: 'No final result · attention required',
      tone: 'attention',
    };
  }
  if (receipt.duel.status === 'refunded') {
    return {
      detail: 'The refund completed without a committed winner or card ownership transfer.',
      label: 'Refund finalized · no winner',
      tone: 'verified',
    };
  }
  return {
    detail: `The duel is ${formatStatus(receipt.duel.status)} and has no committed two-pull result.`,
    label: 'No final result yet',
    tone: 'neutral',
  };
}

function formatStatus(status: PublicDuelStatus): string {
  return status.replaceAll('_', ' ');
}
