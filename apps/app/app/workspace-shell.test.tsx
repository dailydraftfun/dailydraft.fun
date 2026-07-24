import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/navigation', () => ({
  usePathname: () => '/games',
}));

mock.module('./solana/wallet-control', () => ({
  WalletControl: () => <span>Wallet control</span>,
}));

const { isGamesNavigationActive, WorkspaceShell } = await import('./workspace-shell');

describe('workspace shell', () => {
  test('activates Games in both navigation layouts on the games route', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell>
        <main>Games content</main>
      </WorkspaceShell>,
    );

    expect(markup.match(/aria-current="page"/g)).toHaveLength(2);
    expect(markup).toContain('grid-cols-3');
    expect(markup).toContain('Games content');
    expect(markup).toContain('Wallet control');
  });

  test('keeps Games active throughout the preview routes', () => {
    expect(isGamesNavigationActive('/games')).toBe(true);
    expect(isGamesNavigationActive('/games/flip')).toBe(true);
    expect(isGamesNavigationActive('/games/activity')).toBe(true);
    expect(isGamesNavigationActive('/overview')).toBe(false);
  });
});
