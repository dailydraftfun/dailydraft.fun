import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DuelPrimaryAction } from '../duel-primary-action';
import { DuelUnavailableProof } from '../duel-unavailable-proof';

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
});
