import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const { default: GamePreviewPage, generateMetadata, generateStaticParams } = await import('./page');

describe('game preview page contract', () => {
  test('prebuilds the established fixture preview modes', () => {
    expect(generateStaticParams()).toEqual([
      { mode: 'crash' },
      { mode: 'flip' },
      { mode: 'house' },
    ]);
  });

  test('publishes mode-specific metadata and content', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ mode: 'flip' }) });
    const page = await GamePreviewPage({ params: Promise.resolve({ mode: 'flip' }) });
    const markup = renderToStaticMarkup(page);

    expect(metadata.title).toBe('Sports Pack Gacha UX preview — Grail Devnet');
    expect(markup).toContain('Full UX preview');
    expect(markup).toContain('Sports Pack Gacha');
  });

  test('publishes Streak and House metadata', async () => {
    const crash = await generateMetadata({ params: Promise.resolve({ mode: 'crash' }) });
    const house = await generateMetadata({ params: Promise.resolve({ mode: 'house' }) });

    expect(crash.title).toBe('Card Streak UX preview — Grail Devnet');
    expect(house.title).toBe('Instant House UX preview — Grail Devnet');
  });
});
