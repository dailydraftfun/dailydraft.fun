import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { BalanceStatus, WalletBalances } from './balance';

// The dialog body is behind a useState click and this workspace has no DOM test
// environment, so the chip is what a static render can reach. That is also the
// surface the balance read exists for: it has to be legible before the player
// opens anything.
const walletProvider = await import('./wallet-provider');

let walletState = wallet();

mock.module('./wallet-provider', () => ({
  ...walletProvider,
  useSolanaWallet: () => walletState,
}));

mock.module('./wallet-auth-provider', () => ({
  useWalletAuth: () => authentication(),
}));

const { WalletControl } = await import('./wallet-control');

describe('wallet control', () => {
  test('shows a read balance beside the connected address', () => {
    walletState = wallet({
      balanceStatus: 'ready',
      balances: { lamports: 2_500_000_000n, token: null },
    });

    const html = renderToStaticMarkup(<WalletControl />);

    expect(html).toContain('data-testid="journey-wallet-balance"');
    expect(html).toContain('2.5 SOL');
    expect(html).toContain('wallet-button-connected');
    expect(html).toContain('wall…llet');
  });

  test('withholds the chip balance until a read actually resolves', () => {
    walletState = wallet({ balanceStatus: 'loading' });

    const html = renderToStaticMarkup(<WalletControl />);

    // 'Reading balance…' is dialog-only copy: an in-flight read must not put a
    // number-shaped placeholder where a real balance goes.
    expect(html).not.toContain('data-testid="journey-wallet-balance"');
    expect(html).not.toContain('wallet-button-balance');
    expect(html).toContain('data-testid="journey-wallet-menu"');
  });

  test('falls back to the connect prompt with no wallet selected', () => {
    walletState = wallet({ address: null, shortAddress: null, status: 'connecting' });

    const html = renderToStaticMarkup(<WalletControl />);

    expect(html).toContain('Connect wallet');
    expect(html).toContain('wallet-spinner');
    expect(html).not.toContain('wallet-button-connected');
  });
});

function wallet(
  overrides: Partial<{
    address: string | null;
    balanceStatus: BalanceStatus;
    balances: WalletBalances | null;
    networkStatus: 'checking' | 'online' | 'offline';
    shortAddress: string | null;
    status: 'discovering' | 'disconnected' | 'connecting' | 'connected' | 'error';
  }> = {},
) {
  return {
    account: null,
    address: 'wallet' as string | null,
    balanceStatus: 'idle' as BalanceStatus,
    balances: null as WalletBalances | null,
    canSignMessage: true,
    canSignTransaction: true,
    clearError: () => undefined,
    cluster: 'devnet' as const,
    connect: async () => true,
    disconnect: async () => undefined,
    error: null,
    networkStatus: 'online' as const,
    refreshBalances: async () => null,
    retryNetwork: async () => true,
    rpcUrl: 'https://api.devnet.solana.com',
    selectedWallet: null,
    shortAddress: 'wall…llet' as string | null,
    signTransaction: async () => ({
      serializedTransaction: new Uint8Array(),
      signature: 'signature',
      signedTransactionBase64: '',
    }),
    signAndSendTransaction: async () => 'signature',
    signMessage: async () => new Uint8Array(),
    status: 'connected' as const,
    wallets: [],
    ...overrides,
  };
}

function authentication() {
  return {
    challenge: null,
    clearError: () => undefined,
    error: null,
    expiresAt: null,
    prepare: async () => undefined,
    sessionToken: null,
    signIn: async () => true,
    signOut: async () => undefined,
    status: 'unauthenticated' as const,
  };
}
