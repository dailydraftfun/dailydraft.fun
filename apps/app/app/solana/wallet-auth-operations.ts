import type { WalletAuthChallenge, WalletSession } from './wallet-auth-client';
import { clearStoredWalletSession, restoreWalletSession } from './wallet-auth-session';

type AuthOperation = {
  generation: number;
  wallet: string;
};

type CreateCurrentWalletSessionOptions = {
  challenge: WalletAuthChallenge;
  createSession: (challenge: WalletAuthChallenge, signature: Uint8Array) => Promise<WalletSession>;
  currentOperation: () => AuthOperation;
  operation: AuthOperation;
  revokeSession: (token: string) => Promise<void>;
  signMessage: (message: string) => Promise<Uint8Array>;
};

type CreateCurrentWalletSessionResult =
  | { session: WalletSession; status: 'created' }
  | { status: 'stale' };

type ReconcileWalletSessionOptions = {
  currentSession: WalletSession | null;
  revokeSession: (token: string) => Promise<void>;
  signal: AbortSignal;
  storage: Storage;
  validateSession: (
    token: string,
    signal?: AbortSignal,
  ) => Promise<Pick<WalletSession, 'network' | 'wallet'> | null>;
  wallet: string | null;
};

export type ReconcileWalletSessionResult =
  | { session: null; status: 'unauthenticated' }
  | { error: string; session: null; status: 'unavailable' }
  | { session: WalletSession; status: 'authenticated' };

export async function createCurrentWalletSession({
  challenge,
  createSession,
  currentOperation,
  operation,
  revokeSession,
  signMessage,
}: CreateCurrentWalletSessionOptions): Promise<CreateCurrentWalletSessionResult> {
  const signature = await signMessage(challenge.message);
  if (!isCurrentOperation(operation, currentOperation())) return { status: 'stale' };

  const session = await createSession(challenge, signature);
  if (!isCurrentOperation(operation, currentOperation())) {
    await revokeSession(session.token);
    return { status: 'stale' };
  }
  return { session, status: 'created' };
}

export function isCurrentOperation(expected: AuthOperation, current: AuthOperation): boolean {
  return expected.generation === current.generation && expected.wallet === current.wallet;
}

export async function reconcileWalletSession({
  currentSession,
  revokeSession,
  signal,
  storage,
  validateSession,
  wallet,
}: ReconcileWalletSessionOptions): Promise<ReconcileWalletSessionResult> {
  if (currentSession?.wallet === wallet) {
    return { session: currentSession, status: 'authenticated' };
  }
  if (currentSession) {
    clearStoredWalletSession(storage);
    void revokeSession(currentSession.token);
  }
  if (!wallet) return { session: null, status: 'unauthenticated' };

  try {
    const restored = await restoreWalletSession(storage, wallet, validateSession, signal);
    return restored.status === 'restored'
      ? { session: restored.session, status: 'authenticated' }
      : { session: null, status: 'unauthenticated' };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      error: 'The existing wallet session could not be checked. Try again when online.',
      session: null,
      status: 'unavailable',
    };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
