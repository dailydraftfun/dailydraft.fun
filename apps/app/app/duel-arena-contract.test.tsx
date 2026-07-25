import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { journeyTestIds } from './e2e/journey-test-ids';

// Bun's module registry is process-wide, so this override reaches every later test file.
// Loading the real provider up front and spreading it keeps the rest of its surface
// intact — only the hook is swapped for a stub this file can drive. Pattern matches
// apps/app/app/duel/duel-entry-stepper.test.tsx.
const walletProvider = await import('./solana/wallet-provider');

const walletState = {
  account: null,
  address: null,
  canSignMessage: false,
  clearError: () => undefined,
  cluster: 'devnet' as const,
  connect: async () => true,
  disconnect: async () => undefined,
  error: null,
  networkStatus: 'online' as const,
  retryNetwork: async () => true,
  rpcUrl: 'https://api.devnet.solana.com',
  selectedWallet: null,
  shortAddress: null,
  signAndSendTransaction: async () => 'signature',
  signMessage: async () => new Uint8Array(),
  status: 'disconnected' as const,
  wallets: [],
};

const authenticationState = {
  challenge: null,
  clearError: () => undefined,
  error: null,
  sessionToken: null,
  signIn: async () => undefined,
  status: 'unauthenticated' as const,
};

mock.module('./solana/wallet-provider', () => ({
  ...walletProvider,
  useSolanaWallet: () => walletState,
}));

mock.module('./solana/wallet-auth-provider', () => ({
  useWalletAuth: () => authenticationState,
}));

const { DuelArena } = await import('./duel-arena');

describe('duel arena contract', () => {
  test('renders the default lobby view with no active duel', () => {
    const markup = renderToStaticMarkup(<DuelArena />);

    expect(markup).toContain(`data-testid="${journeyTestIds.lobby}"`);
    expect(markup).toContain('Rip together.');
    expect(markup).toContain('Winner takes all.');
    expect(markup).toContain('Solana devnet MVP');
  });
});
