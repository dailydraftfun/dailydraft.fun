'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { trackProductEvent } from '../analytics-client';
import {
  createWalletSession,
  requestWalletChallenge,
  revokeWalletSession,
  validateWalletSession,
  type WalletAuthChallenge,
  type WalletSession,
} from './wallet-auth-client';
import {
  createCurrentWalletSession,
  isCurrentOperation,
  reconcileWalletSession,
} from './wallet-auth-operations';
import {
  clearStoredWalletSession,
  readStoredWalletSession,
  writeStoredWalletSession,
} from './wallet-auth-session';
import { useSolanaWallet, type WalletContextValue } from './wallet-provider';

type WalletAuthStatus =
  | 'unauthenticated'
  | 'restoring'
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
  return (
    <WalletAuthRuntimeProvider wallet={useSolanaWallet()}>{children}</WalletAuthRuntimeProvider>
  );
}

export type WalletAuthRuntime = {
  cancelExpiration: (timer: number) => void;
  createSession: typeof createWalletSession;
  getStorage: () => Storage;
  now: () => number;
  requestChallenge: typeof requestWalletChallenge;
  revokeSession: typeof revokeWalletSession;
  scheduleExpiration: (expire: () => void, remainingMs: number) => number;
  trackAuthenticated: () => void;
  validateSession: typeof validateWalletSession;
};

const defaultRuntime: WalletAuthRuntime = {
  cancelExpiration: (timer) => window.clearTimeout(timer),
  createSession: createWalletSession,
  getStorage: () => window.sessionStorage,
  now: () => Date.now(),
  requestChallenge: requestWalletChallenge,
  revokeSession: revokeWalletSession,
  scheduleExpiration: (expire, remainingMs) => window.setTimeout(expire, remainingMs),
  trackAuthenticated: () => trackProductEvent({ name: 'wallet_authenticated' }),
  validateSession: validateWalletSession,
};

export function WalletAuthRuntimeProvider({
  children,
  runtime = defaultRuntime,
  wallet,
}: {
  children: React.ReactNode;
  runtime?: WalletAuthRuntime;
  wallet: WalletContextValue;
}) {
  const value = useWalletAuthRuntime(wallet, runtime);
  return <WalletAuthContext.Provider value={value}>{children}</WalletAuthContext.Provider>;
}

export function useWalletAuthRuntime(
  wallet: WalletContextValue,
  runtime: WalletAuthRuntime = defaultRuntime,
): WalletAuthContextValue {
  const [challenge, setChallenge] = useState<WalletAuthChallenge | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const sessionRef = useRef<WalletSession | null>(null);
  const authGeneration = useRef(0);
  const walletAddressRef = useRef(wallet.address);
  walletAddressRef.current = wallet.address;
  const [status, setStatus] = useState<WalletAuthStatus>('unauthenticated');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const generation = ++authGeneration.current;
    const controller = new AbortController();
    let cancelled = false;
    setChallenge(null);
    setError(null);
    const current = sessionRef.current;
    if (!wallet.address) {
      setStatus('unauthenticated');
    } else if (current?.wallet !== wallet.address) setStatus('restoring');
    void reconcileWalletSession({
      currentSession: current,
      revokeSession: runtime.revokeSession,
      signal: controller.signal,
      storage: runtime.getStorage(),
      validateSession: runtime.validateSession,
      wallet: wallet.address,
    })
      .then((result) => {
        if (cancelled || generation !== authGeneration.current) return;
        sessionRef.current = result.session;
        setSession(result.session);
        setStatus(result.status === 'authenticated' ? 'authenticated' : 'unauthenticated');
        if (result.status === 'unavailable') setError(result.error);
      })
      .catch((restoreError: unknown) => {
        if (
          cancelled ||
          generation !== authGeneration.current ||
          (restoreError instanceof DOMException && restoreError.name === 'AbortError')
        )
          return;
        setError(getErrorMessage(restoreError));
        setStatus('error');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runtime, wallet.address]);

  useEffect(() => {
    if (!session) return;
    const expireSession = () => {
      sessionRef.current = null;
      setSession(null);
      clearStoredWalletSession(runtime.getStorage());
      setChallenge(null);
      setError(null);
      setStatus('unauthenticated');
      void runtime.revokeSession(session.token);
    };
    const remainingMs = new Date(session.expiresAt).getTime() - runtime.now();
    if (remainingMs <= 0) {
      expireSession();
      return;
    }
    const timer = runtime.scheduleExpiration(expireSession, remainingMs);
    return () => runtime.cancelExpiration(timer);
  }, [runtime, session]);

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
    const generation = authGeneration.current;
    const address = wallet.address;
    try {
      const prepared = await runtime.requestChallenge(address);
      if (generation !== authGeneration.current || walletAddressRef.current !== address) return;
      if (prepared.chain !== 'solana:devnet')
        throw new Error('The API returned a non-devnet challenge.');
      setChallenge(prepared);
      setStatus('ready');
    } catch (preparationError) {
      if (generation !== authGeneration.current || walletAddressRef.current !== address) return;
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
    const operation = {
      generation: authGeneration.current,
      wallet: wallet.address,
    };
    try {
      const result = await createCurrentWalletSession({
        challenge,
        createSession: runtime.createSession,
        currentOperation: () => ({
          generation: authGeneration.current,
          wallet: walletAddressRef.current ?? '',
        }),
        operation,
        revokeSession: runtime.revokeSession,
        signMessage: wallet.signMessage,
      });
      if (result.status === 'stale') return false;
      const nextSession = result.session;
      sessionRef.current = nextSession;
      setSession(nextSession);
      writeStoredWalletSession(runtime.getStorage(), nextSession);
      runtime.trackAuthenticated();
      setChallenge(null);
      setStatus('authenticated');
      return true;
    } catch (signingError) {
      if (
        !isCurrentOperation(operation, {
          generation: authGeneration.current,
          wallet: walletAddressRef.current ?? '',
        })
      )
        return false;
      setError(getErrorMessage(signingError));
      setStatus('error');
      return false;
    }
  }

  async function signOut(): Promise<void> {
    authGeneration.current += 1;
    const storage = runtime.getStorage();
    const storedSession = walletAddressRef.current
      ? readStoredWalletSession(storage, walletAddressRef.current, runtime.now())
      : null;
    const token = sessionRef.current?.token ?? storedSession?.token;
    sessionRef.current = null;
    setSession(null);
    clearStoredWalletSession(storage);
    setChallenge(null);
    setError(null);
    setStatus('unauthenticated');
    if (token) await runtime.revokeSession(token);
  }

  return {
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
  };
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
