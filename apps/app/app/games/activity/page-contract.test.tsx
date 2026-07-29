import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ActivityPage, { metadata } from './page';

describe('activity page contract', () => {
  test('publishes the no-index verified activity projection', () => {
    const markup = renderToStaticMarkup(<ActivityPage />);

    expect(markup).toContain('Activity');
    expect(markup).toContain('Recent play.');
    expect(metadata.title).toBe('Verified game activity — DailyDraft Devnet');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });
});
