import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/navigation', () => ({
  usePathname: () => '/games',
}));

mock.module('./solana/wallet-control', () => ({
  WalletControl: () => <span>Wallet control</span>,
}));

const { WorkspaceShell } = await import('./workspace-shell');

describe('workspace shell contract', () => {
  test('publishes the DailyDraft brand in the header chrome', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    );

    expect(markup).toContain('aria-label="DailyDraft home"');
    expect(markup).toContain('DailyDraft');
    expect(markup).not.toContain('Pack Duel');
    expect(markup).toContain('Devnet');
  });
});
