import { describe, expect, test } from 'bun:test';

import type { WalletSession } from './wallet-auth-client';
import {
  clearStoredWalletSession,
  readStoredWalletSession,
  restoreWalletSession,
  walletSessionStorageKey,
  writeStoredWalletSession,
} from './wallet-auth-session';

const wallet = '11111111111111111111111111111111';
const session: WalletSession = {
  expiresAt: '2099-01-01T01:00:00.000Z',
  network: 'solana-devnet',
  token: 'fixture_session_0123456789abcdef01234567',
  wallet,
};

describe('wallet authentication session storage', () => {
  test('round-trips a valid same-tab session', () => {
    const storage = createStorage();

    writeStoredWalletSession(storage, session);

    expect(
      readStoredWalletSession(storage, wallet, Date.parse('2099-01-01T00:00:00.000Z')),
    ).toEqual(session);
  });

  test.each([
    ['malformed JSON', '{'],
    ['JSON null', 'null'],
    [
      'wrong wallet',
      JSON.stringify({ ...session, wallet: 'So11111111111111111111111111111111111111112' }),
    ],
    ['wrong network', JSON.stringify({ ...session, network: 'solana-mainnet' })],
    ['invalid token', JSON.stringify({ ...session, token: 'too short' })],
  ])('rejects and removes %s', (_label, value) => {
    const storage = createStorage({ [walletSessionStorageKey]: value });

    expect(readStoredWalletSession(storage, wallet)).toBeNull();
    expect(storage.getItem(walletSessionStorageKey)).toBeNull();
  });

  test('removes an expired session', () => {
    const storage = createStorage({ [walletSessionStorageKey]: JSON.stringify(session) });

    expect(readStoredWalletSession(storage, wallet, Date.parse(session.expiresAt))).toBeNull();
    expect(storage.getItem(walletSessionStorageKey)).toBeNull();
  });

  test('fails safely when browser storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;

    expect(readStoredWalletSession(storage, wallet)).toBeNull();
    expect(() => writeStoredWalletSession(storage, session)).not.toThrow();
    expect(() => clearStoredWalletSession(storage)).not.toThrow();
  });

  test('restores only a server-validated session for the connected wallet', async () => {
    const storage = createStorage({ [walletSessionStorageKey]: JSON.stringify(session) });

    expect(
      await restoreWalletSession(storage, wallet, async () => ({
        network: session.network,
        wallet,
      })),
    ).toEqual({ session, status: 'restored' });
    expect(
      await restoreWalletSession(createStorage(), wallet, async () => {
        throw new Error('must not validate a missing session');
      }),
    ).toEqual({ status: 'missing' });
  });

  test.each([
    ['revoked token', null],
    ['wrong network', { network: 'solana-mainnet', wallet }],
    [
      'wrong wallet',
      { network: 'solana-devnet', wallet: 'So11111111111111111111111111111111111111112' },
    ],
  ])('clears a stored session rejected for %s', async (_label, identity) => {
    const storage = createStorage({ [walletSessionStorageKey]: JSON.stringify(session) });

    expect(
      await restoreWalletSession(
        storage,
        wallet,
        async () => identity as { network: 'solana-devnet'; wallet: string } | null,
      ),
    ).toEqual({ status: 'invalid' });
    expect(storage.getItem(walletSessionStorageKey)).toBeNull();
  });

  test('propagates a transient validation failure without deleting the session', async () => {
    const storage = createStorage({ [walletSessionStorageKey]: JSON.stringify(session) });

    await expect(
      restoreWalletSession(storage, wallet, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(storage.getItem(walletSessionStorageKey)).toBe(JSON.stringify(session));
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
