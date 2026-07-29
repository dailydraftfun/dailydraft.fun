import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import MarketplaceFlipPage, { metadata } from './page';

describe('marketplace flip demo route', () => {
  test('keeps the no-value prediction game distinct from Sports Pack Gacha', () => {
    const markup = renderToStaticMarkup(<MarketplaceFlipPage />);

    expect(markup).toContain('Marketplace Flip');
    expect(markup).toContain('Which band is behind the card?');
    expect(markup).toContain('No wallet, payment, marketplace order, custody, or ownership change');
    expect(metadata.title).toBe('Marketplace Flip — DailyDraft Devnet');
    expect(metadata.description).toContain('no-value');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });
});
