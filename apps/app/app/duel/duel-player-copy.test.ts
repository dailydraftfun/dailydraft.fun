import { describe, expect, test } from 'bun:test';

import type { DurableDuel } from '../solana/duel-client';
import {
  duelRules,
  getDuelPaymentReviewCopy,
  getDuelPlayerStatus,
  getFundingStatusNotice,
  getLobbyEconomicsCopy,
  getPlayerActionError,
  prohibitedPrimaryUiTerms,
} from './duel-player-copy';

const statuses: DurableDuel['status'][] = [
  'waiting',
  'matched',
  'committing',
  'funded',
  'opening',
  'awaiting_assets',
  'settling',
  'settled',
  'cancelling',
  'cancelled',
  'refunding',
  'refunded',
  'failed',
];

describe('duel player copy', () => {
  test('maps every duel lifecycle state to a player action', () => {
    expect(
      Object.fromEntries(
        statuses.map((status) => {
          const copy = getDuelPlayerStatus(status);
          return [status, { headline: copy.headline, nextAction: copy.nextAction }];
        }),
      ),
    ).toEqual({
      awaiting_assets: {
        headline: 'Cards are moving into the duel',
        nextAction: 'Keep this page open while devnet finishes the transfers.',
      },
      cancelled: {
        headline: 'Duel cancelled',
        nextAction: 'Start another duel when you are ready.',
      },
      cancelling: {
        headline: 'Closing this duel',
        nextAction: 'Keep this page open until the cancellation completes.',
      },
      committing: {
        headline: 'Waiting for both payments',
        nextAction: 'Approve your displayed fee if prompted, then leave this page open.',
      },
      failed: {
        headline: 'This duel needs attention',
        nextAction: 'Refresh once. If it still fails, return to the lobby and retry.',
      },
      funded: {
        headline: 'Both wallets paid',
        nextAction: 'Keep this page open while both packs are prepared.',
      },
      matched: {
        headline: 'Opponent found',
        nextAction: 'Approve the displayed platform fee, or cancel before funding starts.',
      },
      opening: {
        headline: 'Both packs are opening',
        nextAction: 'Keep this page open for the synchronized reveal.',
      },
      refunded: {
        headline: 'Payments returned',
        nextAction: 'Start another duel when you are ready.',
      },
      refunding: {
        headline: 'Returning both payments',
        nextAction: 'Keep this page open until both returns complete.',
      },
      settled: {
        headline: 'Duel complete',
        nextAction: 'View the public receipt or start another duel.',
      },
      settling: {
        headline: 'Winner decided; cards are moving',
        nextAction: 'Keep this page open until the final transfer completes.',
      },
      waiting: {
        headline: 'Challenge ready to share',
        nextAction: 'Share the challenge link or cancel before funding starts.',
      },
    });

    expect(getDuelPlayerStatus('waiting', true)).toEqual({
      detail: 'Your seat is open in the public wallet queue.',
      headline: 'Looking for an opponent',
      nextAction: 'Keep searching or cancel before funding starts.',
    });
    expect(getDuelPlayerStatus('unexpected' as DurableDuel['status'])).toEqual(
      getDuelPlayerStatus('failed'),
    );
  });

  test('names the next action for every payment recovery branch', () => {
    expect(getFundingStatusNotice({ status: 'committing' }, 1)).toContain('Keep this page open');
    expect(getFundingStatusNotice({ status: 'funded' }, 0)).toBe(
      'Both wallets paid. Pack opening can start now.',
    );
    expect(getFundingStatusNotice({ status: 'committing' }, 0)).toBe(
      'Your payment completed. Waiting for the other wallet to pay.',
    );
    expect(getFundingStatusNotice({ status: 'failed' }, 0)).toContain('Refresh once');
  });

  test('turns recoverable failures into explicit player actions', () => {
    expect(getPlayerActionError(new Error('401 unauthorized'), 'Could not continue.')).toContain(
      'Re-authenticate',
    );
    expect(getPlayerActionError(new Error('Wallet rejected request'), 'Could not continue.')).toBe(
      'Nothing was submitted. Review the payment and approve it in your wallet when ready.',
    );
    expect(getPlayerActionError(new Error('RPC unavailable'), 'Could not continue.')).toContain(
      'Check your connection',
    );
    expect(getPlayerActionError(new Error('Unknown problem'), 'Could not continue.')).toBe(
      'Could not continue. Try again; your current duel progress is unchanged.',
    );
    expect(
      getPlayerActionError(new Error('No active matchmaking session'), 'Could not continue.'),
    ).toBe('Could not continue. Try again; your current duel progress is unchanged.');
  });

  test('keeps protocol jargon out of primary lobby, rules, payment, and lifecycle copy', () => {
    const payment = getDuelPaymentReviewCopy('0.001');
    const primaryCopy = [
      getLobbyEconomicsCopy(),
      payment.description,
      payment.heading,
      payment.safety,
      payment.title,
      ...payment.rows.flatMap((row) => [row.label, row.value]),
      ...duelRules.flatMap((rule) => [rule.title, rule.body]),
      ...statuses.flatMap((status) => Object.values(getDuelPlayerStatus(status))),
      ...Object.values(getDuelPlayerStatus('waiting', true)),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();

    for (const term of prohibitedPrimaryUiTerms) {
      expect(primaryCopy).not.toContain(term);
    }
  });
});
