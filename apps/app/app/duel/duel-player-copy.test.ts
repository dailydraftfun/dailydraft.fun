import { describe, expect, test } from 'bun:test';

import type { DurableDuel } from '../solana/duel-client';
import {
  duelRules,
  getDuelPaymentReviewCopy,
  getDuelPlayerStatus,
  getFundingStatusNotice,
  getLobbyEconomicsCopy,
  getMatchmakingSearchCopy,
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
        nextAction: 'The challenge creator approves first; the other wallet is prompted next.',
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
        headline: 'Result committed; settlement is finishing',
        nextAction: 'Keep this page open until the final settlement completes.',
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

  test('shows search guidance only while matchmaking is still searching', () => {
    const session = {
      queue: { tier: 50 },
      state: 'searching',
    } as const;

    expect(getMatchmakingSearchCopy(session)).toBe(
      'Searching for the same $50 pack. You can continue or cancel before funding starts.',
    );
    expect(getMatchmakingSearchCopy({ ...session, state: 'matched' })).toBeNull();
  });

  test('keeps payment, outcome, and demo-pool claims scoped to known facts', () => {
    const payment = getDuelPaymentReviewCopy('0.001');
    const poolRule = duelRules.find((rule) => rule.title === 'Pack source and odds');
    const winnerRule = duelRules.find((rule) => rule.title === 'How the winner is chosen');

    expect(payment.description).toContain('The platform fee is exactly 0.001 SOL');
    expect(payment.description).toContain('network fee and any recoverable rent');
    expect(getDuelPlayerStatus('settled').detail).toContain(
      'whether one pull led or the values tied',
    );
    expect(getDuelPlayerStatus('settling').headline).toBe(
      'Result committed; settlement is finishing',
    );
    expect(getDuelPlayerStatus('matched').nextAction).toBe(
      'The challenge creator approves first; the other wallet is prompted next.',
    );
    expect(poolRule?.body).toContain('server-provided');
    expect(poolRule?.body).not.toMatch(/five-card|1-in-5/);
    expect(winnerRule?.body).toContain('higher verified value snapshot');
    expect(winnerRule?.body).not.toContain('TCGPlayer');
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
    expect(
      getPlayerActionError(new Error('RPC unavailable'), 'The payment did not complete.', true),
    ).toBe(
      'The payment may have been sent to Solana devnet, but confirmation could not be verified. Refresh this duel before retrying so you do not submit a duplicate payment.',
    );
    expect(
      getPlayerActionError(
        new Error('Wallet rejected request'),
        'The payment did not complete.',
        true,
      ),
    ).toBe('Nothing was submitted. Review the payment and approve it in your wallet when ready.');
    expect(
      getPlayerActionError(
        new Error('Signed transaction rejected by escrow validation'),
        'The payment did not complete.',
        true,
        true,
      ),
    ).toBe(
      'The payment may have been sent to Solana devnet, but confirmation could not be verified. Refresh this duel before retrying so you do not submit a duplicate payment.',
    );
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
