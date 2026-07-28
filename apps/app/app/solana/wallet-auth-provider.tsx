'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { trackProductEvent } from '../analytics-client';
import {
  createWalletSession,
  requestWalletChallenge,
  revokeWalletSession,
  type WalletAuthChallenge,
  type WalletSession,
} from './wallet-auth-client';
import { useSolanaWallet } from './wallet-provider';

type WalletAuthStatus =
  | 'unauthenticated'
  | 'preparing'
  | 'ready'
  | 'signing'
  | 'authenticated'
  | 'error';

type WalletAuthContextValue = {
  challenge: WalletAuthChallenge | null;
  clearError: () => void;
  error: string | null;
  expiresAt: string | null;
  prepare: () => Promise<void>;
  sessionToken: string | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  status: WalletAuthStatus;
  walletAddress: string | null;
};

const WalletAuthContext = createContext<WalletAuthContextValue | null>(null);

export function WalletAuthProvider({ children }: { children: React.ReactNode }) {
  const wallet = useSolanaWallet();
  const [challenge, setChallenge] = useState<WalletAuthChallenge | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [status, setStatus] = useState<WalletAuthStatus>('unauthenticated');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChallenge(null);
    setError(null);
    setSession((current) => {
      if (current && current.wallet !== wallet.address) void revokeWalletSession(current.token);
      return current?.wallet === wallet.address ? current : null;
    });
    setStatus('unauthenticated');
  }, [wallet.address]);

  useEffect(() => {
    if (!session) return;
    const expireSession = () => {
      setSession(null);
      setChallenge(null);
      setError(null);
      setStatus('unauthenticated');
      void revokeWalletSession(session.token);
    };
    const remainingMs = new Date(session.expiresAt).getTime() - Date.now();
    if (remainingMs <= 0) {
      expireSession();
      return;
    }
    const timer = window.setTimeout(expireSession, remainingMs);
    return () => window.clearTimeout(timer);
  }, [session]);

  async function prepare(): Promise<void> {
    if (!wallet.address) {
      setError('Connect a Solana wallet before requesting an authentication message.');
      setStatus('error');
      return;
    }
    if (!wallet.canSignMessage) {
      setError(
        `${wallet.selectedWallet?.name ?? 'This wallet'} cannot sign authentication messages.`,
      );
      setStatus('error');
      return;
    }
    setError(null);
    setStatus('preparing');
    try {
      const prepared = await requestWalletChallenge(wallet.address);
      if (prepared.chain !== 'solana:devnet')
        throw new Error('The API returned a non-devnet challenge.');
      setChallenge(prepared);
      setStatus('ready');
    } catch (preparationError) {
      setError(getErrorMessage(preparationError));
      setStatus('error');
    }
  }

  async function signIn(): Promise<boolean> {
    if (!challenge || challenge.wallet !== wallet.address) {
      setError('Request a fresh authentication message for the connected wallet.');
      setStatus('error');
      return false;
    }
    setError(null);
    setStatus('signing');
    try {
      const signature = await wallet.signMessage(challenge.message);
      const nextSession = await createWalletSession(challenge, signature);
      setSession(nextSession);
      trackProductEvent({ name: 'wallet_authenticated' });
      setChallenge(null);
      setStatus('authenticated');
      return true;
    } catch (signingError) {
      setError(getErrorMessage(signingError));
      setStatus('error');
      return false;
    }
  }

  async function signOut(): Promise<void> {
    const token = session?.token;
    setSession(null);
    setChallenge(null);
    setError(null);
    setStatus('unauthenticated');
    if (token) await revokeWalletSession(token);
  }

  return (
    <WalletAuthContext.Provider
      value={{
        challenge,
        clearError: () => setError(null),
        error,
        expiresAt: session?.expiresAt ?? null,
        prepare,
        sessionToken: session?.token ?? null,
        signIn,
        signOut,
        status,
        walletAddress: wallet.address,
      }}
    >
      {children}
    </WalletAuthContext.Provider>
  );
}

export function useWalletAuth() {
  const context = useContext(WalletAuthContext);
  if (!context) throw new Error('useWalletAuth must be used inside WalletAuthProvider.');
  return context;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Wallet authentication did not complete. Check the message and try again.';
}
