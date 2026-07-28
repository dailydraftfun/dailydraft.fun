import { describe, expect, test } from 'bun:test';

import type { WalletAuthChallenge, WalletSession } from './wallet-auth-client';
import {
  createCurrentWalletSession,
  isCurrentOperation,
  reconcileWalletSession,
} from './wallet-auth-operations';
import { walletSessionStorageKey } from './wallet-auth-session';

const challenge: WalletAuthChallenge = {
  chain: 'solana:devnet',
  challengeId: 'authc_test',
  domain: 'app.dailydraft.fun',
  expiresAt: '2099-01-01T00:15:00.000Z',
  message: 'Sign in',
  uri: 'https://app.dailydraft.fun',
  wallet: '11111111111111111111111111111111',
};
const session: WalletSession = {
  expiresAt: '2099-01-01T01:00:00.000Z',
  network: 'solana-devnet',
  token: 'fixture_session_0123456789abcdef01234567',
  wallet: challenge.wallet,
};

describe('wallet authentication operation binding', () => {
  test('accepts only the same generation and wallet', () => {
    const expected = { generation: 4, wallet: challenge.wallet };

    expect(isCurrentOperation(expected, expected)).toBe(true);
    expect(isCurrentOperation(expected, { ...expected, generation: 5 })).toBe(false);
    expect(
      isCurrentOperation(expected, {
        ...expected,
        wallet: 'So11111111111111111111111111111111111111112',
      }),
    ).toBe(false);
  });

  test('creates a session while the wallet operation remains current', async () => {
    const operation = { generation: 4, wallet: challenge.wallet };

    expect(
      await createCurrentWalletSession({
        challenge,
        createSession: async () => session,
        currentOperation: () => operation,
        operation,
        revokeSession: async () => undefined,
        signMessage: async () => Uint8Array.from([1, 2, 3]),
      }),
    ).toEqual({ session, status: 'created' });
  });

  test('does not create a session when the wallet changes during signing', async () => {
    const operation = { generation: 4, wallet: challenge.wallet };
    let createCalls = 0;

    expect(
      await createCurrentWalletSession({
        challenge,
        createSession: async () => {
          createCalls += 1;
          return session;
        },
        currentOperation: () => ({ generation: 5, wallet: challenge.wallet }),
        operation,
        revokeSession: async () => undefined,
        signMessage: async () => Uint8Array.from([1, 2, 3]),
      }),
    ).toEqual({ status: 'stale' });
    expect(createCalls).toBe(0);
  });

  test('revokes a session completed after sign-out invalidates the operation', async () => {
    const operation = { generation: 4, wallet: challenge.wallet };
    let current = operation;
    const revoked: string[] = [];

    expect(
      await createCurrentWalletSession({
        challenge,
        createSession: async () => {
          current = { generation: 5, wallet: '' };
          return session;
        },
        currentOperation: () => current,
        operation,
        revokeSession: async (token) => {
          revoked.push(token);
        },
        signMessage: async () => Uint8Array.from([1, 2, 3]),
      }),
    ).toEqual({ status: 'stale' });
    expect(revoked).toEqual([session.token]);
  });

  test('keeps a current in-memory session without a validation request', async () => {
    let validationCalls = 0;

    expect(
      await reconcileWalletSession({
        currentSession: session,
        revokeSession: async () => undefined,
        signal: new AbortController().signal,
        storage: createStorage(),
        validateSession: async () => {
          validationCalls += 1;
          return null;
        },
        wallet: session.wallet,
      }),
    ).toEqual({ session, status: 'authenticated' });
    expect(validationCalls).toBe(0);
  });

  test('clears and revokes an in-memory session after disconnect', async () => {
    const storage = createStorage({ [walletSessionStorageKey]: JSON.stringify(session) });
    const revoked: string[] = [];

    expect(
      await reconcileWalletSession({
        currentSession: session,
        revokeSession: async (token) => {
          revoked.push(token);
        },
        signal: new AbortController().signal,
        storage,
        validateSession: async () => null,
        wallet: null,
      }),
    ).toEqual({ session: null, status: 'unauthenticated' });
    expect(storage.getItem(walletSessionStorageKey)).toBeNull();
    expect(revoked).toEqual([session.token]);
  });

  test('restores a valid stored session and rejects a revoked one', async () => {
    const validStorage = createStorage({
      [walletSessionStorageKey]: JSON.stringify(session),
    });
    expect(
      await reconcileWalletSession({
        currentSession: null,
        revokeSession: async () => undefined,
        signal: new AbortController().signal,
        storage: validStorage,
        validateSession: async () => ({ network: session.network, wallet: session.wallet }),
        wallet: session.wallet,
      }),
    ).toEqual({ session, status: 'authenticated' });

    const revokedStorage = createStorage({
      [walletSessionStorageKey]: JSON.stringify(session),
    });
    expect(
      await reconcileWalletSession({
        currentSession: null,
        revokeSession: async () => undefined,
        signal: new AbortController().signal,
        storage: revokedStorage,
        validateSession: async () => null,
        wallet: session.wallet,
      }),
    ).toEqual({ session: null, status: 'unauthenticated' });
    expect(revokedStorage.getItem(walletSessionStorageKey)).toBeNull();
  });

  test('reports transient validation failure but rethrows cancellation', async () => {
    const options = {
      currentSession: null,
      revokeSession: async () => undefined,
      signal: new AbortController().signal,
      storage: createStorage({ [walletSessionStorageKey]: JSON.stringify(session) }),
      wallet: session.wallet,
    };

    expect(
      await reconcileWalletSession({
        ...options,
        validateSession: async () => {
          throw new Error('offline');
        },
      }),
    ).toEqual({
      error: 'The existing wallet session could not be checked. Try again when online.',
      session: null,
      status: 'unavailable',
    });
    await expect(
      reconcileWalletSession({
        ...options,
        validateSession: async () => {
          throw new DOMException('cancelled', 'AbortError');
        },
      }),
    ).rejects.toHaveProperty('name', 'AbortError');
  });
});

function createStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}
