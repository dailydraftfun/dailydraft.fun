import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import GamesPage, { metadata } from './page';

describe('games page contract', () => {
  test('publishes the card games lobby with no-index preview metadata', () => {
    const markup = renderToStaticMarkup(<GamesPage />);

    expect(markup).toContain('DailyDraft Arena');
    expect(markup).toContain('Pick a game.');
    expect(markup).toContain('Card Duel');
    expect(metadata.title).toBe('Card games — DailyDraft Devnet');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });
});
