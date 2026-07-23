import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import GamesPage, { metadata } from './page';

describe('games page contract', () => {
  test('publishes the card games lobby with no-index preview metadata', () => {
    const markup = renderToStaticMarkup(<GamesPage />);

    expect(markup).toContain('Three card loops');
    expect(markup).toContain('Duels');
    expect(metadata.title).toBe('Card games — Pack Duel Devnet');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });
});
