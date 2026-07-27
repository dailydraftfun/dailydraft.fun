import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const { default: GamePreviewPage, generateMetadata, generateStaticParams } = await import('./page');

describe('game preview page contract', () => {
  test('prebuilds the established fixture preview modes', () => {
    // `flip` is owned by the static `games/flip` route, so claiming it here
    // would fail the build.
    expect(generateStaticParams()).toEqual([{ mode: 'crash' }, { mode: 'house' }]);
  });

  test('publishes mode-specific metadata and content', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ mode: 'crash' }) });
    const page = await GamePreviewPage({ params: Promise.resolve({ mode: 'crash' }) });
    const markup = renderToStaticMarkup(page);

    expect(metadata.title).toBe('Card Streak UX preview — DailyDraft Devnet');
    expect(markup).toContain('Full UX preview');
    expect(markup).toContain('Card Streak');
  });

  test('publishes Streak and House metadata', async () => {
    const crash = await generateMetadata({ params: Promise.resolve({ mode: 'crash' }) });
    const house = await generateMetadata({ params: Promise.resolve({ mode: 'house' }) });

    expect(crash.title).toBe('Card Streak UX preview — DailyDraft Devnet');
    expect(house.title).toBe('Instant House UX preview — DailyDraft Devnet');
  });

  test('publishes no preview metadata for an unsupported dynamic mode', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ mode: 'flip' }) })).resolves.toEqual(
      {},
    );
  });
});
