import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import RootLayout, { metadata } from './layout';

describe('marketing layout contract', () => {
  test('publishes the DailyDraft sports fantasy identity', () => {
    expect(metadata.title).toBe('DailyDraft — Own the cards. Field the squad.');
    expect(metadata.description).toContain('sports fantasy casino on Solana');
    expect(metadata.description).toContain('live match data');
  });

  test('keeps the keyword set aimed at sports fantasy rather than pack duels', () => {
    const keywords = metadata.keywords as string[];

    expect(keywords).toContain('sports fantasy');
    expect(keywords).toContain('Collector Crypt');
    expect(keywords).toContain('football');
    expect(keywords).toContain('basketball');
    expect(keywords).not.toContain('pack opening');
  });

  test('shares one rebranded story across Open Graph and Twitter cards', () => {
    expect(metadata.openGraph?.title).toBe('DailyDraft — Own the cards. Field the squad.');
    expect(metadata.openGraph?.siteName).toBe('DailyDraft');
    expect(metadata.openGraph?.description).toBe(
      'Rip real, vaulted sports cards from Collector Crypt and win tournaments scored by live match data on Solana.',
    );
    expect(metadata.twitter).toEqual(expect.objectContaining({ card: 'summary_large_image' }));
    expect(metadata.twitter?.title).toBe('DailyDraft — Own the cards. Field the squad.');
    expect(metadata.twitter?.description).toBe(metadata.openGraph?.description);
  });

  test('renders the document shell around page content', () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>Landing content</main>
      </RootLayout>,
    );

    expect(markup).toContain('<html lang="en">');
    expect(markup).toContain('Landing content');
  });
});
