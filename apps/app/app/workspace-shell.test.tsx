import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { journeyTestIds } from './e2e/journey-test-ids';

mock.module('next/navigation', () => ({
  usePathname: () => '/games',
}));

// The wallet control renders for real here rather than behind a stub. A
// mock.module override of it is process-wide, so stubbing the component in this
// file would reach app/solana/wallet-control.test.tsx too and leave the real one
// unexecuted for the whole run. Both providers are effect-driven, so a static
// render resolves them to their initial state without any network access.
const { SolanaWalletProvider } = await import('./solana/wallet-provider');
const { WalletAuthProvider } = await import('./solana/wallet-auth-provider');
const { isGamesNavigationActive, WorkspaceShell } = await import('./workspace-shell');

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
  test('activates Games in both navigation layouts on the games route', () => {
    const markup = renderShell(<main>Games content</main>);

    expect(markup.match(/aria-current="page"/g)).toHaveLength(2);
    expect(markup).toContain('grid-cols-2');
    expect(markup).not.toContain('Card Duels');
    expect(markup).toContain('Games content');
    expect(markup).toContain(`data-testid="${journeyTestIds.walletMenu}"`);
  });

  test('opens with no balance claim before a wallet is connected', () => {
    // Discovery has not run under a static render, so the chip must fall back to
    // the connect prompt instead of showing a stale or placeholder figure.
    const markup = renderShell(<main>Games content</main>);

    expect(markup).toContain('Connect wallet');
    expect(markup).not.toContain(`data-testid="${journeyTestIds.walletBalance}"`);
  });

  test('keeps Games active throughout the preview routes', () => {
    expect(isGamesNavigationActive('/games')).toBe(true);
    expect(isGamesNavigationActive('/games/flip')).toBe(true);
    expect(isGamesNavigationActive('/games/duel')).toBe(true);
    expect(isGamesNavigationActive('/games/duel?challenge=duel_123')).toBe(true);
    expect(isGamesNavigationActive('/games/activity')).toBe(true);
    expect(isGamesNavigationActive('/overview')).toBe(false);
  });
});
