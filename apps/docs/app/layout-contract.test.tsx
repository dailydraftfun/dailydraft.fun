import { describe, expect, mock, test } from 'bun:test';
import type { ReactNode } from 'react';

// The layout is under test for its published metadata and brand wiring, not for the
// nextra theme itself, so the theme surface is stubbed the same way
// apps/app/app/layout-contract.test.tsx stubs its providers.
mock.module('nextra/components', () => ({
  Head: () => null,
}));

mock.module('nextra/page-map', () => ({
  getPageMap: async () => [],
}));

mock.module('nextra-theme-docs', () => ({
  Footer: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  // The brand chrome reaches the page through the navbar and footer slots, so the stub
  // has to render them or the wordmark under test never appears in the markup.
  Layout: ({
    children,
    footer,
    navbar,
  }: {
    children: ReactNode;
    footer: ReactNode;
    navbar: ReactNode;
  }) => (
    <div>
      {navbar}
      {children}
      {footer}
    </div>
  ),
  Navbar: ({ logo }: { logo: ReactNode }) => <nav>{logo}</nav>,
}));

const { default: RootLayout, metadata } = await import('./layout');

describe('docs layout contract', () => {
  test('publishes the DailyDraft docs identity', () => {
    expect(metadata.title).toEqual({
      default: 'DailyDraft Docs',
      template: '%s — DailyDraft',
    });
    expect(metadata.openGraph?.siteName).toBe('DailyDraft Docs');
    expect(metadata.twitter).toEqual(expect.objectContaining({ card: 'summary_large_image' }));
  });

  test('anchors relative metadata against an absolute docs origin', () => {
    // Next declares metadataBase as `string | URL | null`, so the scheme is read back
    // through a URL built from the value instead of off the union directly.
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(new URL(String(metadata.metadataBase)).protocol).toBe('https:');
  });

  test('renders the rebranded shell around page content', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const markup = renderToStaticMarkup(await RootLayout({ children: <main>Docs content</main> }));

    expect(markup).toContain('DAILYDRAFT');
    expect(markup).not.toContain('PACK DUEL');
    expect(markup).toContain('Docs content');
  });

  test('points contributors at the renamed repository', async () => {
    const markup = (await import('node:fs')).readFileSync(
      new URL('./layout.tsx', import.meta.url),
      'utf8',
    );

    expect(markup).toContain('https://github.com/dailydraftfun/dailydraft.fun');
    expect(markup).not.toContain('openpacksduel');
  });
});
