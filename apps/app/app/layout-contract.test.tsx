import { describe, expect, mock, test } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The root layout only needs its own metadata and shell wiring under test, so the
// wallet-bearing providers are stubbed the same way workspace-shell.test.tsx does.
mock.module('./providers', () => ({
  Providers: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

mock.module('./workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { default: RootLayout, metadata } = await import('./layout');

describe('root layout contract', () => {
  test('publishes the Grail sports fantasy identity', () => {
    expect(metadata.title).toBe('Grail Devnet — Own the cards. Field the squad.');
    expect(metadata.description).toContain('Collector Crypt');
    expect(metadata.description).toContain('sports fantasy loops on Solana');
    expect(metadata.openGraph?.siteName).toBe('Grail Devnet');
    expect(metadata.twitter?.card).toBe('summary_large_image');
  });

  test('wraps every route in the workspace shell', () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>Route content</main>
      </RootLayout>,
    );

    expect(markup).toContain('<html lang="en">');
    expect(markup).toContain('Route content');
  });
});
