import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarketplaceFlipGame } from './marketplace-flip-game';
import {
  INITIAL_MARKETPLACE_FLIP_GAME_STATE,
  type MarketplaceFlipGameState,
} from './marketplace-flip-game-state';

function state(overrides: Partial<MarketplaceFlipGameState>): MarketplaceFlipGameState {
  return { ...INITIAL_MARKETPLACE_FLIP_GAME_STATE, ...overrides };
}

describe('Marketplace Flip game', () => {
  test('opens as a keyboard-native prediction table with explicit no-value boundaries', () => {
    const html = renderToStaticMarkup(<MarketplaceFlipGame />);

    expect(html).toContain('data-flip-phase="pick"');
    expect(html).toContain('aria-label="Marketplace Flip game"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Marketplace Flip');
    expect(html).toContain('Which band is behind the card?');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Lock Core call');
    expect(html).toContain('Entry');
    expect(html).toContain('$0.00');
    expect(html).toContain('No wallet, payment, marketplace order, custody, or ownership change');
    expect(html.indexOf('data-flip-phase="pick"')).toBeLessThan(
      html.indexOf('data-game-rules="flip"'),
    );
    expect(html).not.toContain('Connect wallet');
    expect(html).not.toContain('Buy card');
  });

  test('renders committed, result, and receipt stages without weakening fixture truth', () => {
    const committed = renderToStaticMarkup(
      <MarketplaceFlipGame initialState={state({ call: 'chase', phase: 'committed' })} />,
    );
    const result = renderToStaticMarkup(
      <MarketplaceFlipGame
        initialState={state({
          call: 'chase',
          lastPoints: 3,
          phase: 'result',
          score: 3,
          streak: 1,
        })}
      />,
    );
    const receipt = renderToStaticMarkup(
      <MarketplaceFlipGame
        initialState={state({
          call: 'chase',
          lastPoints: 3,
          phase: 'receipt',
          score: 3,
          streak: 1,
        })}
      />,
    );

    expect(committed).toContain('Call locked · Chase');
    expect(committed).toContain('Flip the card');
    expect(result).toContain('data-choreography-active="true"');
    expect(result).toContain('data-choreography-beat="settled"');
    expect(result).toContain('Charizard · Base Set');
    expect(result).toContain('$72.50');
    expect(result).toContain('Chase called correctly');
    expect(result).toContain('Review script summary');
    expect(result).toContain('Play next round');
    expect(receipt).toContain('Fixture result computed for this run');
    expect(receipt).toContain('Local UI state only');
    expect(receipt).toContain('Not submitted');
    expect(receipt).toContain('Unchanged');
  });

  test('keeps 390px, focus, and reduced-motion protections in the local stylesheet', () => {
    const css = readFileSync(
      new URL('./marketplace-flip-game.module.css', import.meta.url),
      'utf8',
    );

    expect(css).toContain('@media (max-width: 39.999rem)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/min-height: 3rem/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/animation: none !important/);
    expect(css).toMatch(/transition: none !important/);
  });
});
