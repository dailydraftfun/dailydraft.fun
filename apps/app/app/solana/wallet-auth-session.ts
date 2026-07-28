import type { WalletSession } from './wallet-auth-client';

export const walletSessionStorageKey = 'dailydraft.wallet-session.v1';

type RestoreWalletSessionResult =
  | { status: 'invalid' | 'missing' }
  | { session: WalletSession; status: 'restored' };

export async function restoreWalletSession(
  storage: Storage,
  wallet: string,
  validate: (
    token: string,
    signal?: AbortSignal,
  ) => Promise<Pick<WalletSession, 'network' | 'wallet'> | null>,
  signal?: AbortSignal,
): Promise<RestoreWalletSessionResult> {
  const session = readStoredWalletSession(storage, wallet);
  if (!session) return { status: 'missing' };
  const identity = await validate(session.token, signal);
  if (!identity || identity.network !== session.network || identity.wallet !== session.wallet) {
    clearStoredWalletSession(storage);
    return { status: 'invalid' };
  }
  return { session, status: 'restored' };
}

export function readStoredWalletSession(
  storage: Storage,
  wallet: string,
  now = Date.now(),
): WalletSession | null {
  try {
    const raw = storage.getItem(walletSessionStorageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isWalletSession(value) || value.wallet !== wallet) {
      storage.removeItem(walletSessionStorageKey);
      return null;
    }
    if (new Date(value.expiresAt).getTime() <= now) {
      storage.removeItem(walletSessionStorageKey);
      return null;
    }
    return value;
  } catch {
    try {
      storage.removeItem(walletSessionStorageKey);
    } catch {
      // Ignore storage access failures.
    }
    return null;
  }
}

export function writeStoredWalletSession(storage: Storage, session: WalletSession): void {
  try {
    storage.setItem(walletSessionStorageKey, JSON.stringify(session));
  } catch {
    // Authentication still works when storage is blocked or unavailable.
  }
}

export function clearStoredWalletSession(storage: Storage): void {
  try {
    storage.removeItem(walletSessionStorageKey);
  } catch {
    // The in-memory session can still be cleared when storage is unavailable.
  }
}

function isWalletSession(value: unknown): value is WalletSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WalletSession>;
  return (
    candidate.network === 'solana-devnet' &&
    typeof candidate.wallet === 'string' &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate.wallet) &&
    typeof candidate.token === 'string' &&
    /^[A-Za-z0-9_-]{16,200}$/.test(candidate.token) &&
    typeof candidate.expiresAt === 'string' &&
    Number.isFinite(new Date(candidate.expiresAt).getTime())
  );
}
