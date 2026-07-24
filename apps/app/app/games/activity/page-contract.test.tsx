import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ActivityPage, { metadata } from './page';

describe('activity page contract', () => {
  test('publishes the no-index activity receipt lab', () => {
    const markup = renderToStaticMarkup(<ActivityPage />);

    expect(markup).toContain('Lobby activity');
    expect(metadata.title).toBe('Activity receipt lab — Grail Devnet');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });
});
