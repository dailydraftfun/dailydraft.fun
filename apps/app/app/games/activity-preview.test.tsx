import { describe, expect, test } from 'bun:test';
import {
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivityPage,
  verifiedGameActivityContractFixtures,
} from '@dailydraft/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityPreview } from './activity-preview';

describe('verified activity surface', () => {
  test('defaults to an honest projection loading state without fixture activity', () => {
    const markup = renderToStaticMarkup(<ActivityPreview />);

    expect(markup).toContain('Recent play you can verify');
    expect(markup).toContain('Checking durable outcomes');
    expect(markup).toContain('No fabricated live counts');
    expect(markup).toContain('No verified activity shown');
    expect(markup).not.toContain('duel_activity000001');
    expect(markup).not.toContain('players online');
  });

  test('renders only canonical settled proof rows with pseudonymous participants', () => {
    const markup = renderToStaticMarkup(
      <ActivityPreview initialPage={activityPage()} initialState="ready" />,
    );

    expect(markup).toContain('Verified recent activity');
    expect(markup).toContain('Sports Pack Duel settled');
    expect(markup).toContain('Verified win');
    expect(markup).toContain('9xQe…9gJ1 · Gk8Z…MQyW');
    expect(markup).toContain('View verified receipt');
    expect(markup).toContain('aria-label="View verified receipt for Sports Pack Duel settled"');
    expect(markup).toContain('/v1/duels/duel_activity000001/receipt');
    expect(markup).toContain('<span class="sr-only">Settled </span>');
    expect(markup).not.toContain('9xQeWvG816bUx9EPfEzF3F7PVhZVW5R1N9gJ1');
  });

  test('distinguishes completed single-player modes and exact fractional tiers', () => {
    const flip = {
      ...verifiedGameActivityContractFixtures.flip,
      tier: { amount: '50001234', currency: 'USDC', decimals: 6 } as const,
    };
    const markup = renderToStaticMarkup(<ActivityPreview initialPage={activityPage([flip])} />);

    expect(markup).toContain('Marketplace Flip');
    expect(markup).toContain('Completed');
    expect(markup).toContain('50.001234 USDC tier');
    expect(markup).toContain('Player P4Q9');
  });

  test('renders honest empty, stale, degraded, and unavailable states', () => {
    const empty = renderToStaticMarkup(
      <ActivityPreview initialPage={emptyPage()} initialState="empty" />,
    );
    const stale = renderToStaticMarkup(
      <ActivityPreview initialPage={emptyPage()} initialState="stale" />,
    );
    const degraded = renderToStaticMarkup(<ActivityPreview initialState="degraded" />);
    const unavailable = renderToStaticMarkup(<ActivityPreview initialState="unavailable" />);
    const readyWithoutRows = renderToStaticMarkup(<ActivityPreview initialState="ready" />);
    const staleWithoutRows = renderToStaticMarkup(<ActivityPreview initialState="stale" />);

    expect(empty).toContain('does not invent players, wins, or volume');
    expect(stale).toContain('Cached');
    expect(stale).toContain('Jul 28 at 12:00 PM UTC');
    expect(stale).toContain('could not be refreshed');
    expect(degraded).toContain('Proof service degraded');
    expect(degraded).toContain('without inferred participation');
    expect(unavailable).toContain('Proof service unavailable');
    expect(unavailable).toContain('No activity or participation is inferred');
    expect(readyWithoutRows).toContain('>Verified<');
    expect(staleWithoutRows).toContain('Cached result');
  });
});

function activityPage(
  data: VerifiedGameActivityPage['data'] = [verifiedGameActivityContractFixtures.duel],
): VerifiedGameActivityPage {
  return {
    asOf: '2026-07-28T12:00:00.000Z',
    data,
    hasMore: false,
    nextCursor: null,
    schemaVersion: VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  };
}

function emptyPage(): VerifiedGameActivityPage {
  return { ...activityPage(), data: [] };
}
