import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  },
  redirect: (target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  },
  usePathname: () => '/games',
}));

// Rendered against the real providers rather than a wallet-control stub: a
// mock.module override is process-wide and would suppress the real component in
// every other test file too. See app/workspace-shell.test.tsx.
const { SolanaWalletProvider } = await import('./solana/wallet-provider');
const { WalletAuthProvider } = await import('./solana/wallet-auth-provider');
const { WorkspaceShell } = await import('./workspace-shell');

describe('workspace shell contract', () => {
  test('publishes the DailyDraft brand in the header chrome', () => {
    const markup = renderToStaticMarkup(
      <SolanaWalletProvider>
        <WalletAuthProvider>
          <WorkspaceShell>
            <main>Route content</main>
          </WorkspaceShell>
        </WalletAuthProvider>
      </SolanaWalletProvider>,
    );

    expect(markup).toContain('aria-label="DailyDraft home"');
    expect(markup).toContain('href="/games"');
    expect(markup).toContain('DailyDraft');
    expect(markup).not.toContain('Pack Duel');
    expect(markup).not.toContain('Card Duels');
    expect(markup).toContain('hidden sm:inline');
    expect(markup).toContain(
      'Devnet preview uses test SOL and test assets only; no mainnet funds.',
    );
    expect(markup).not.toContain('devnet-disclosure');
  });
});
