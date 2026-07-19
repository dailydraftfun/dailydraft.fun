import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { DuelTransactionIntent } from '../solana/duel-client';

let walletState = wallet();
let authenticationState = authentication();

mock.module('../solana/wallet-provider', () => ({
  useSolanaWallet: () => walletState,
}));

mock.module('../solana/wallet-auth-provider', () => ({
  useWalletAuth: () => authenticationState,
}));

const { DuelEntryStepper } = await import('./duel-entry-stepper');

describe('duel entry stepper', () => {
  test('guides a disconnected player into wallet connection', () => {
    walletState = wallet({ address: null, status: 'disconnected' });
    authenticationState = authentication();

    const html = renderStepper();

    expect(html).toContain('Connect your Solana wallet');
    expect(html).toContain('No compatible Solana wallet found');
    expect(html).toContain('Continue later');
    expect(html).toContain('data-stage="connect"');
    expect(html).toContain('data-testid="duel-entry-stepper"');
  });

  test('identifies authentication as a non-value-bearing signature', () => {
    walletState = wallet();
    authenticationState = authentication({
      status: 'signing',
      challenge: {
        chain: 'solana:devnet',
        challengeId: 'challenge',
        domain: 'openpacksduel.vercel.app',
        expiresAt: '2026-07-17T09:15:00.000Z',
        message: 'Sign in to Pack Duel',
        uri: 'https://openpacksduel.vercel.app',
        wallet: 'wallet',
      },
    });

    const html = renderStepper();

    expect(html).toContain('Authentication signature');
    expect(html).toContain('No transaction · no fee · no asset movement');
    expect(html).toContain('Waiting for authentication signature');
  });

  test('shows one exact money summary before the transaction wallet prompt', () => {
    walletState = wallet();
    authenticationState = authentication({
      sessionToken: 'session',
      status: 'authenticated',
    });

    const html = renderStepper({ intent: fundingIntent() });

    expect(html).toContain('Value-bearing transaction');
    expect(html).toContain('0.015 SOL');
    expect(html).toContain('Not charged in this devnet step');
    expect(html).toContain('Approve 0.015 SOL in wallet');
    expect(html).toContain('data-testid="duel-entry-confirm-funding"');
  });

  test('keeps a rejected funding intent available for an explicit retry', () => {
    walletState = wallet();
    authenticationState = authentication({
      sessionToken: 'session',
      status: 'authenticated',
    });

    const html = renderStepper({
      error: 'Wallet rejected the transaction.',
      intent: fundingIntent(),
    });

    expect(html).toContain('Wallet rejected the transaction.');
    expect(html).toContain('Approve 0.015 SOL in wallet');
  });

  test('distinguishes broadcast confirmation from wallet signing', () => {
    walletState = wallet();
    authenticationState = authentication({
      sessionToken: 'session',
      status: 'authenticated',
    });

    const html = renderStepper({
      fundingPhase: 'confirming',
      intent: fundingIntent(),
      pending: true,
    });

    expect(html).toContain('Confirming escrow funding');
    expect(html).toContain('transaction was broadcast');
    expect(html).toContain('advance automatically');
  });

  test('reconciles a broadcast timeout without asking for another signature', () => {
    walletState = wallet();
    authenticationState = authentication({
      sessionToken: 'session',
      status: 'authenticated',
    });

    const html = renderStepper({
      error: 'Confirmation timed out.',
      fundingPhase: 'recovering',
      intent: fundingIntent(),
    });

    expect(html).toContain('wallet may already have broadcast');
    expect(html).toContain('Resume confirmation without signing');
    expect(html).not.toContain('Approve 0.015 SOL in wallet');
  });

  test('offers a specific retry when the devnet RPC is offline', () => {
    walletState = wallet({ networkStatus: 'offline' });
    authenticationState = authentication({
      sessionToken: 'session',
      status: 'authenticated',
    });

    const html = renderStepper();

    expect(html).toContain('Solana devnet is unreachable');
    expect(html).toContain('Retry devnet connection');
    expect(html).toContain('No transaction will open');
  });

  test('keeps post-broadcast recovery explicit while devnet is offline', () => {
    walletState = wallet({ networkStatus: 'offline' });
    authenticationState = authentication({
      sessionToken: 'session',
      status: 'authenticated',
    });

    const html = renderStepper({
      fundingPhase: 'recovering',
      intent: fundingIntent(),
    });

    expect(html).toContain('Confirm the broadcast transaction');
    expect(html).toContain('without signing or sending again');
    expect(html).toContain('Retry devnet to resume confirmation');
    expect(html).not.toContain('Approve 0.015 SOL in wallet');
  });
});

function renderStepper(
  overrides: Partial<React.ComponentProps<typeof DuelEntryStepper>> = {},
): string {
  return renderToStaticMarkup(
    <DuelEntryStepper
      error={null}
      fundingPhase="idle"
      intent={null}
      mode="direct"
      notice={null}
      onCancel={async () => undefined}
      onClose={() => undefined}
      onConfirm={async () => undefined}
      onPrepare={async () => undefined}
      onResume={async () => undefined}
      pending={false}
      persistedDuel={null}
      tier={50}
      {...overrides}
    />,
  );
}

function wallet(
  overrides: Partial<{
    address: string | null;
    networkStatus: 'checking' | 'online' | 'offline';
    status: 'discovering' | 'disconnected' | 'connecting' | 'connected' | 'error';
  }> = {},
) {
  return {
    account: null,
    address: 'wallet',
    canSignMessage: true,
    clearError: () => undefined,
    cluster: 'devnet' as const,
    connect: async () => true,
    disconnect: async () => undefined,
    error: null,
    networkStatus: 'online' as const,
    retryNetwork: async () => true,
    rpcUrl: 'https://api.devnet.solana.com',
    selectedWallet: null,
    shortAddress: 'wall…llet',
    signAndSendTransaction: async () => 'signature',
    signMessage: async () => new Uint8Array(),
    status: 'connected' as const,
    wallets: [],
    ...overrides,
  };
}

function authentication(
  overrides: Partial<{
    challenge: {
      chain: 'solana:devnet';
      challengeId: string;
      domain: string;
      expiresAt: string;
      message: string;
      uri: string;
      wallet: string;
    } | null;
    sessionToken: string | null;
    status: 'unauthenticated' | 'preparing' | 'ready' | 'signing' | 'authenticated' | 'error';
  }> = {},
) {
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
    ...overrides,
  };
}

function fundingIntent(): DuelTransactionIntent {
  return {
    action: 'fund',
    chain: 'solana:devnet',
    cluster: 'devnet',
    duelId: 'duel_123',
    escrowAddress: 'escrow',
    expiresAt: '2026-07-17T09:15:00.000Z',
    feeAmountLamports: '15000000',
    feeAmountSol: '0.015',
    feeRecipient: 'recipient',
    fundingSide: 'creator',
    id: 'intent_123',
    lastValidBlockHeight: '123',
    paymentMint: 'So11111111111111111111111111111111111111112',
    programId: 'program',
    recentBlockhash: 'blockhash',
    serializedTransactionBase64: 'dHJhbnNhY3Rpb24=',
    status: 'prepared',
    wallet: 'wallet',
    warnings: [],
  };
}
