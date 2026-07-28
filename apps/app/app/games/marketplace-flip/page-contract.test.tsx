import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import MarketplaceFlipPage, { metadata } from './page';

describe('marketplace flip preview route', () => {
  test('keeps the future market game distinct from Sports Pack Gacha', () => {
    const markup = renderToStaticMarkup(<MarketplaceFlipPage />);

    expect(markup).toContain('Marketplace Flip');
    expect(metadata.title).toBe('Marketplace Flip preview — DailyDraft Devnet');
    expect(metadata.description).toContain('Fixture-only');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });
});
