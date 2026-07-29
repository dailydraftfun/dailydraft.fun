import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { journeyTestIds } from './e2e/journey-test-ids';

mock.module('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  },
  redirect: (target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  },
  usePathname: () => '/games',
}));

// The wallet control renders for real here rather than behind a stub. A
// mock.module override of it is process-wide, so stubbing the component in this
// file would reach app/solana/wallet-control.test.tsx too and leave the real one
// unexecuted for the whole run. Both providers are effect-driven, so a static
// render resolves them to their initial state without any network access.
const { SolanaWalletProvider } = await import('./solana/wallet-provider');
const { WalletAuthProvider } = await import('./solana/wallet-auth-provider');
const { default: GamesLayout } = await import('./games/layout');
const { default: Home } = await import('./page');
const { WorkspaceShell } = await import('./workspace-shell');

function renderShell(children: React.ReactNode) {
  return renderToStaticMarkup(
    <SolanaWalletProvider>
      <WalletAuthProvider>
        <WorkspaceShell>{children}</WorkspaceShell>
      </WalletAuthProvider>
    </SolanaWalletProvider>,
  );
}

describe('workspace shell', () => {
  test('uses the brand as the gallery destination without a redundant Games link', () => {
    const markup = renderShell(<main>Games content</main>);

    expect(markup).not.toContain('aria-current="page"');
    expect(markup.match(/href="\/games"/g)).toHaveLength(1);
    expect(markup).not.toContain('grid-cols-2');
    expect(markup).toContain('justify-center');
    expect(markup).not.toContain('Card Duels');
    expect(markup).toContain('Games content');
    expect(markup).toContain('Devnet preview uses test SOL and test assets only');
    expect(markup).not.toContain('devnet-disclosure');
    expect(markup).toContain(`data-testid="${journeyTestIds.walletMenu}"`);
  });

  test('opens with no balance claim before a wallet is connected', () => {
    // Discovery has not run under a static render, so the chip must fall back to
    // the connect prompt instead of showing a stale or placeholder figure.
    const markup = renderShell(<main>Games content</main>);

    expect(markup).toContain('Connect wallet');
    expect(markup).not.toContain(`data-testid="${journeyTestIds.walletBalance}"`);
  });

  test('renders the Games layout and executes the canonical home redirect', () => {
    const markup = renderToStaticMarkup(
      <GamesLayout>
        <main>Games route</main>
      </GamesLayout>,
    );

    expect(markup).toContain('Games route');
    expect(markup).toContain('Pack Gacha');
    expect(() => Home()).toThrow('NEXT_REDIRECT:/games');
  });
});
