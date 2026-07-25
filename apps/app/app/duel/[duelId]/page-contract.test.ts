import { describe, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPublicSurfaceReceipt } from '../../__journey/public-duel-receipt';
import { DuelPrimaryAction } from '../duel-primary-action';
import { DuelUnavailableProof } from '../duel-unavailable-proof';

mock.module('server-only', () => ({}));
mock.module('../duel-proof-refresh', () => ({ DuelProofRefresh: () => null }));

const { default: DuelPage } = await import('./page');

describe('public duel page contract', () => {
  test('renders exactly one canonical dominant receipt action', () => {
    const markup = renderToStaticMarkup(
      createElement(DuelPrimaryAction, {
        action: { href: '/overview', label: 'Open a duel' },
      }),
    );

    expect(markup.match(/proof-primary-action/g)).toHaveLength(1);
    expect(markup).toContain('href="/overview"');
    expect(markup).toContain('Open a duel');
  });

  test('keeps the unavailable-proof escape secondary', () => {
    const markup = renderToStaticMarkup(
      createElement(DuelUnavailableProof, { duelId: 'duel_unavailable' }),
    );

    expect(markup).not.toContain('proof-primary-action');
    expect(markup).toContain('proof-secondary-action');
    expect(markup).toContain('duel_unavailable');
  });

  test('renders settled per-card capabilities and the ownership gate from receipts', async () => {
    const originalFetch = globalThis.fetch;
    const availableReceipt = createPublicSurfaceReceipt('duel_fixture_card_actions');
    const hiddenReceipt = createPublicSurfaceReceipt('duel_public_settled');
    if (!availableReceipt?.result || !hiddenReceipt) throw new Error('Missing public duel fixture');

    const creatorOutcome = availableReceipt.result.outcomes[0];
    availableReceipt.cardActions = {
      availability: 'available',
      cards: [
        {
          actionStateId: 'card-action:duel_fixture_card_actions:creator',
          actions: [
            {
              action: 'keep',
              alternative: null,
              availability: 'available',
              capability: 'ownership-receipt',
              detail: 'Keep performs no custody change.',
              label: 'Keep card',
              reason: null,
              requiresSignature: false,
              transaction: null,
            },
            {
              action: 'list',
              alternative: { action: 'keep', label: 'Keep card' },
              availability: 'unavailable',
              capability: 'collector-crypt-marketplace-listing',
              detail: 'Listing requires the marketplace capability.',
              label: 'List card',
              reason: 'partner-onboarding-required',
              requiresSignature: false,
              transaction: null,
            },
          ],
          assetReference: creatorOutcome.assetReference,
          displayName: creatorOutcome.displayName,
          duelId: availableReceipt.duel.id,
          imageUrl: creatorOutcome.imageUrl,
          insuredValue: creatorOutcome.insuredValue,
          owner: availableReceipt.participants.creator,
          ownership: {
            basis: 'finalized-settlement-reference',
            settlementSignature: 'fixture-settlement-signature',
            status: 'reconciled',
          },
          providerReference: 'fixture-provider-reference',
          receiptHref: `/v1/duels/${availableReceipt.duel.id}/receipt`,
          side: 'creator',
        },
      ],
      reason: null,
      receiptHref: `/v1/duels/${availableReceipt.duel.id}/receipt`,
      schemaVersion: 'dailydraft.card-actions.v1',
    };

    globalThis.fetch = (async (input) => {
      const url = String(input);
      const receipt = url.includes(availableReceipt.duel.id) ? availableReceipt : hiddenReceipt;
      return Response.json(receipt);
    }) as typeof fetch;

    try {
      const availableMarkup = renderToStaticMarkup(
        await DuelPage({ params: Promise.resolve({ duelId: availableReceipt.duel.id }) }),
      );
      const hiddenMarkup = renderToStaticMarkup(
        await DuelPage({ params: Promise.resolve({ duelId: hiddenReceipt.duel.id }) }),
      );

      expect(availableMarkup).toContain('Charizard fixture pull supported actions');
      expect(availableMarkup).toContain('Keep card');
      expect(availableMarkup).toContain('List card unavailable for Charizard fixture pull');
      expect(hiddenMarkup).toContain('finalized settlement reference reconciles ownership');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
