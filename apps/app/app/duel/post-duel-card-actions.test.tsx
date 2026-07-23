import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  PostDuelCardActionCapability,
  PostDuelCardCapabilityState,
} from './post-duel-card-actions';
import { CardActionGate, CardActionState, toCardActionState } from './post-duel-card-actions';
import type { PublicPostDuelCardActionState } from './public-proof-client';

describe('post-duel card actions', () => {
  test('renders capability-specific controls and keeps value meanings separate', () => {
    const markup = renderToStaticMarkup(
      <CardActionState
        state={cardState({
          actions: [
            action('keep', 'available'),
            action('list', 'available', {
              href: '/cards/creator/list',
              value: money('68000000'),
            }),
            action('sell-back', 'available', {
              href: '/cards/creator/sell-back',
              value: money('61000000'),
            }),
            action('redeem', 'unavailable', { reason: 'unsupported' }),
          ],
          displayedValue: money('70000000'),
        })}
      />,
    );

    expect(markup).toContain('aria-label="Charizard value fields"');
    expect(markup).toContain('Displayed value</dt><dd>USDC 70');
    expect(markup).toContain('Insured value</dt><dd>USDC 72.5');
    expect(markup).toContain('Listing price</dt><dd>USDC 68');
    expect(markup).toContain('Buyback quote</dt><dd>USDC 61');
    expect(markup).toContain('href="/cards/creator/list"');
    expect(markup).toContain('href="/cards/creator/sell-back"');
    expect(markup).toContain('aria-label="List card for Charizard"');
    expect(markup).toContain('aria-label="Sell back for Charizard"');
    expect(markup).toContain('Redeem physical card unavailable for Charizard');
    expect(markup).not.toContain('href="javascript:');
  });

  test.each([
    undefined,
    '',
    'javascript:alert(1)',
    '//example.com/cards/creator/list',
    '/\\evil.example/cards/creator/list',
    '/cards/creator/list\nmalformed',
  ])('%s fails closed as an unsafe or missing custodial target', (href) => {
    const markup = renderToStaticMarkup(
      <CardActionState
        state={cardState({
          actions: [action('keep', 'available'), action('list', 'available', { href })],
        })}
      />,
    );

    expect(markup).toContain('List card unavailable for Charizard');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('href="javascript:');
    expect(markup).not.toContain('href="//example.com');
    expect(markup).not.toContain('href="/\\evil.example');
  });

  test('a non-string custodial target fails closed without crashing the render', () => {
    // The public proof fetch casts JSON with a bare `as T`, so a malformed upstream
    // payload can deliver a non-string href at runtime despite the TypeScript type.
    // The action must fail closed (render disabled) rather than throw on String methods.
    const unsafe = { href: 42 } as unknown as Partial<PostDuelCardActionCapability>;
    const markup = renderToStaticMarkup(
      <CardActionState
        state={cardState({
          actions: [action('keep', 'available'), action('list', 'available', unsafe)],
        })}
      />,
    );

    expect(markup).toContain('List card unavailable for Charizard');
    expect(markup).toContain('disabled=""');
  });

  test.each([
    ['ownership-pending', 'status', 'finalized settlement reference reconciles ownership'],
    ['ownership-mismatch', 'alert', 'recorded ownership disagrees'],
    ['duel-not-settled', 'status', 'until the duel reaches settled state'],
    ['mock-assets', 'status', 'mock results do not transfer real cards'],
    [null, 'status', 'Card actions are unavailable'],
  ] as const)('announces the %s ownership gate before exposing actions', (reason, role, copy) => {
    const markup = renderToStaticMarkup(<CardActionGate reason={reason} />);

    expect(markup).toContain(`role="${role}"`);
    expect(markup).toContain(copy);
    expect(markup).not.toContain('<button');
  });

  test('renders expired buyback evidence with a stable disabled reason and alternative', () => {
    const markup = renderToStaticMarkup(
      <CardActionState
        state={cardState({
          actions: [
            action('keep', 'available'),
            action('sell-back', 'expired', {
              expiresAt: '2026-07-23T10:00:00.000Z',
              reason: 'buyback-expired',
              value: money('61000000'),
            }),
          ],
        })}
      />,
    );

    expect(markup).toContain('data-availability="expired"');
    expect(markup).toContain('>Expired</button>');
    expect(markup).toContain('Quote expires:');
    expect(markup).toContain('Available alternative: Keep card');
  });

  test('keeps pending ownership capabilities disabled and handles malformed expiry evidence', () => {
    const markup = renderToStaticMarkup(
      <CardActionState
        state={cardState({
          actions: [
            action('list', 'pending', { reason: 'ownership-pending' }),
            action('sell-back', 'expired', {
              expiresAt: 'not-a-date',
              reason: 'buyback-expired',
            }),
          ],
        })}
      />,
    );

    expect(markup).toContain('data-availability="pending"');
    expect(markup).toContain('>Pending</button>');
    expect(markup).toContain('Invalid expiry');
  });

  test('preserves independent action groups for every won card', () => {
    const markup = renderToStaticMarkup(
      <>
        <CardActionState state={cardState()} />
        <CardActionState
          state={cardState({
            actionStateId: 'card-action:duel:opponent',
            assetReference: 'asset-opponent',
            displayName: 'Blastoise',
            side: 'opponent',
          })}
        />
      </>,
    );

    expect(markup.match(/aria-label="[^"]+ supported actions"/g)).toHaveLength(2);
    expect(markup).toContain('Charizard supported actions');
    expect(markup).toContain('Blastoise supported actions');
    expect(markup).toContain('card-action-duel-creator-title');
    expect(markup).toContain('card-action-duel-opponent-title');
  });

  test('adapts the canonical receipt contract without inventing provider capabilities', () => {
    const fixture = cardState();
    const canonical: PublicPostDuelCardActionState = {
      actionStateId: fixture.actionStateId,
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
      ],
      assetReference: fixture.assetReference,
      displayName: fixture.displayName,
      duelId: fixture.duelId,
      imageUrl: fixture.imageUrl,
      insuredValue: fixture.insuredValue,
      owner: fixture.owner,
      ownership: fixture.ownership,
      providerReference: fixture.providerReference,
      receiptHref: fixture.receiptHref,
      side: fixture.side,
    };

    const adapted = toCardActionState(canonical);

    expect(adapted.actions).toEqual(canonical.actions);
    expect(adapted).not.toHaveProperty('displayedValue');
    expect(adapted.actions[0]).not.toHaveProperty('href');
    expect(adapted.actions[0]).not.toHaveProperty('value');
  });
});

function cardState(
  overrides: Partial<PostDuelCardCapabilityState> = {},
): PostDuelCardCapabilityState {
  return {
    actionStateId: 'card-action:duel:creator',
    actions: [
      action('keep', 'available'),
      action('list', 'unavailable'),
      action('sell-back', 'unavailable'),
      action('redeem', 'unavailable'),
    ],
    assetReference: 'asset-creator',
    displayName: 'Charizard',
    displayedValue: null,
    duelId: 'duel',
    imageUrl: null,
    insuredValue: money('72500000'),
    owner: { address: 'creator', display: 'Creator', role: 'creator' },
    ownership: {
      basis: 'finalized-settlement-reference',
      settlementSignature: 'settlement-signature',
      status: 'reconciled',
    },
    providerReference: 'provider-creator',
    receiptHref: '/v1/duels/duel/receipt',
    side: 'creator',
    ...overrides,
  };
}

function action(
  name: PostDuelCardActionCapability['action'],
  availability: PostDuelCardActionCapability['availability'],
  overrides: Partial<PostDuelCardActionCapability> = {},
): PostDuelCardActionCapability {
  const capability = {
    keep: 'ownership-receipt',
    list: 'collector-crypt-marketplace-listing',
    redeem: 'collector-crypt-shipping',
    'sell-back': 'collector-crypt-buyback',
  } as const;
  const label = {
    keep: 'Keep card',
    list: 'List card',
    redeem: 'Redeem physical card',
    'sell-back': 'Sell back',
  } as const;

  return {
    action: name,
    alternative: name === 'keep' ? null : { action: 'keep', label: 'Keep card' },
    availability,
    capability: capability[name],
    detail: `${label[name]} capability detail.`,
    label: label[name],
    reason: availability === 'available' ? null : 'partner-onboarding-required',
    requiresSignature: false,
    transaction: null,
    ...overrides,
  };
}

function money(amount: string) {
  return { amount, currency: 'USDC' as const, decimals: 6 as const };
}
