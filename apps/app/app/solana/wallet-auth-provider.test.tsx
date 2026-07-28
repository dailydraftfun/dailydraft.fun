import { describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { WalletAuthChallenge, WalletSession } from './wallet-auth-client';
import { useWalletAuthRuntime, type WalletAuthRuntime } from './wallet-auth-provider';
import { walletSessionStorageKey } from './wallet-auth-session';
import type { WalletContextValue } from './wallet-provider';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const address = '11111111111111111111111111111111';
const otherAddress = 'So11111111111111111111111111111111111111112';
const challenge: WalletAuthChallenge = {
  chain: 'solana:devnet',
  challengeId: 'authc_provider_test',
  domain: 'app.dailydraft.fun',
  expiresAt: '2099-01-01T00:15:00.000Z',
  message: 'Sign in to DailyDraft',
  uri: 'https://app.dailydraft.fun',
  wallet: address,
};
const session: WalletSession = {
  expiresAt: '2099-01-01T01:00:00.000Z',
  network: 'solana-devnet',
  token: 'fixture_session_0123456789abcdef01234567',
  wallet: address,
};

describe('wallet authentication provider', () => {
  test('restores a valid same-tab session and invalidates it on account change', async () => {
    const storage = createStorage({ [walletSessionStorageKey]: JSON.stringify(session) });
    const revoked: string[] = [];
    const runtime = createRuntime({
      revokeSession: async (token) => {
        revoked.push(token);
      },
      storage,
      validateSession: async () => ({ network: session.network, wallet: address }),
    });
    const harness = await renderProvider(wallet(), runtime);

    expect(harness.auth.status).toBe('authenticated');
    expect(harness.auth.sessionToken).toBe(session.token);

    await harness.update(wallet({ address: otherAddress, shortAddress: 'othe…ress' }));

    expect(harness.auth.status).toBe('unauthenticated');
    expect(harness.auth.sessionToken).toBeNull();
    expect(storage.getItem(walletSessionStorageKey)).toBeNull();
    expect(revoked).toEqual([session.token]);
    harness.unmount();
  });

  test('prepares, signs, persists, and explicitly revokes one current session', async () => {
    const storage = createStorage();
    const revoked: string[] = [];
    let tracked = 0;
    const runtime = createRuntime({
      revokeSession: async (token) => {
        revoked.push(token);
      },
      storage,
      trackAuthenticated: () => {
        tracked += 1;
      },
    });
    const harness = await renderProvider(wallet(), runtime);

    await act(async () => harness.auth.prepare());
    expect(harness.auth.status).toBe('ready');
    expect(harness.auth.challenge).toEqual(challenge);

    let signedIn = false;
    await act(async () => {
      signedIn = await harness.auth.signIn();
    });
    expect(signedIn).toBe(true);
    expect(harness.auth.status).toBe('authenticated');
    expect(JSON.parse(storage.getItem(walletSessionStorageKey) ?? '')).toEqual(session);
    expect(tracked).toBe(1);

    await act(async () => harness.auth.signOut());
    expect(harness.auth.status).toBe('unauthenticated');
    expect(harness.auth.sessionToken).toBeNull();
    expect(storage.getItem(walletSessionStorageKey)).toBeNull();
    expect(revoked).toEqual([session.token]);
    harness.unmount();
  });

  test('reports disconnected, unsupported, rejected, and unavailable authentication states', async () => {
    const disconnectedHarness = await renderProvider(
      wallet({ address: null, canSignMessage: false, shortAddress: null }),
      createRuntime(),
    );
    await act(async () => disconnectedHarness.auth.prepare());
    expect(disconnectedHarness.auth.error).toContain('Connect a Solana wallet');
    await act(async () => disconnectedHarness.auth.clearError());
    expect(disconnectedHarness.auth.error).toBeNull();
    disconnectedHarness.unmount();

    const unsupportedHarness = await renderProvider(
      wallet({ canSignMessage: false }),
      createRuntime(),
    );
    await act(async () => unsupportedHarness.auth.prepare());
    expect(unsupportedHarness.auth.error).toContain('cannot sign authentication messages');
    unsupportedHarness.unmount();

    const rejectedHarness = await renderProvider(
      wallet(),
      createRuntime({
        requestChallenge: async () => {
          throw new Error('Challenge rejected.');
        },
      }),
    );
    await act(async () => rejectedHarness.auth.prepare());
    expect(rejectedHarness.auth.status).toBe('error');
    expect(rejectedHarness.auth.error).toBe('Challenge rejected.');
    let rejectedSignIn = true;
    await act(async () => {
      rejectedSignIn = await rejectedHarness.auth.signIn();
    });
    expect(rejectedSignIn).toBe(false);
    rejectedHarness.unmount();

    const unavailableHarness = await renderProvider(
      wallet(),
      createRuntime({
        storage: createStorage({ [walletSessionStorageKey]: JSON.stringify(session) }),
        validateSession: async () => {
          throw new Error('offline');
        },
      }),
    );
    expect(unavailableHarness.auth.status).toBe('unauthenticated');
    expect(unavailableHarness.auth.error).toContain('could not be checked');
    unavailableHarness.unmount();
  });

  test('expires restored sessions and rejects non-devnet or failed signatures', async () => {
    const storage = createStorage({ [walletSessionStorageKey]: JSON.stringify(session) });
    const revoked: string[] = [];
    const expiredHarness = await renderProvider(
      wallet(),
      createRuntime({
        now: () => Date.parse(session.expiresAt),
        revokeSession: async (token) => {
          revoked.push(token);
        },
        storage,
        validateSession: async () => ({ network: session.network, wallet: address }),
      }),
    );
    expect(expiredHarness.auth.status).toBe('unauthenticated');
    expect(expiredHarness.auth.sessionToken).toBeNull();
    expect(revoked).toEqual([session.token]);
    expiredHarness.unmount();

    const wrongChainHarness = await renderProvider(
      wallet(),
      createRuntime({
        requestChallenge: async () => ({
          ...challenge,
          chain: 'solana:mainnet' as WalletAuthChallenge['chain'],
        }),
      }),
    );
    await act(async () => wrongChainHarness.auth.prepare());
    expect(wrongChainHarness.auth.error).toBe('The API returned a non-devnet challenge.');
    wrongChainHarness.unmount();

    const signingFailureHarness = await renderProvider(
      wallet({
        signMessage: async () => {
          throw 'wallet failed';
        },
      }),
      createRuntime(),
    );
    await act(async () => signingFailureHarness.auth.prepare());
    let signedIn = true;
    await act(async () => {
      signedIn = await signingFailureHarness.auth.signIn();
    });
    expect(signedIn).toBe(false);
    expect(signingFailureHarness.auth.error).toContain('Wallet authentication did not complete');
    signingFailureHarness.unmount();
  });

  test('discards challenge and session completions invalidated by an account switch', async () => {
    const pendingChallenge = deferred<WalletAuthChallenge>();
    const challengeHarness = await renderProvider(
      wallet(),
      createRuntime({ requestChallenge: async () => pendingChallenge.promise }),
    );
    let preparePromise = Promise.resolve();
    await act(async () => {
      preparePromise = challengeHarness.auth.prepare();
    });
    await challengeHarness.update(wallet({ address: otherAddress, shortAddress: 'othe…ress' }));
    await act(async () => {
      pendingChallenge.resolve(challenge);
      await preparePromise;
    });
    expect(challengeHarness.auth.challenge).toBeNull();
    expect(challengeHarness.auth.status).toBe('unauthenticated');
    challengeHarness.unmount();

    const pendingSignature = deferred<Uint8Array>();
    const sessionHarness = await renderProvider(
      wallet({ signMessage: async () => pendingSignature.promise }),
      createRuntime(),
    );
    await act(async () => sessionHarness.auth.prepare());
    let signInPromise = Promise.resolve(false);
    await act(async () => {
      signInPromise = sessionHarness.auth.signIn();
    });
    await sessionHarness.update(
      wallet({ address: null, canSignMessage: false, shortAddress: null, status: 'disconnected' }),
    );
    let signedIn = true;
    await act(async () => {
      pendingSignature.resolve(Uint8Array.from([1, 2, 3]));
      signedIn = await signInPromise;
    });
    expect(signedIn).toBe(false);
    expect(sessionHarness.auth.sessionToken).toBeNull();
    await act(async () => sessionHarness.auth.signOut());
    sessionHarness.unmount();
  });

  test('expires an authenticated session on schedule and cancels its timer', async () => {
    const revoked: string[] = [];
    const cancelled: number[] = [];
    let expire: (() => void) | null = null;
    const harness = await renderProvider(
      wallet(),
      createRuntime({
        cancelExpiration: (timer) => {
          cancelled.push(timer);
        },
        revokeSession: async (token) => {
          revoked.push(token);
        },
        scheduleExpiration: (callback) => {
          expire = callback;
          return 42;
        },
      }),
    );

    await act(async () => harness.auth.prepare());
    await act(async () => {
      await harness.auth.signIn();
    });
    expect(harness.auth.status).toBe('authenticated');
    expect(expire).not.toBeNull();

    await act(async () => {
      expire?.();
    });

    expect(harness.auth.status).toBe('unauthenticated');
    expect(harness.auth.sessionToken).toBeNull();
    expect(revoked).toEqual([session.token]);
    expect(cancelled).toEqual([42]);
    harness.unmount();
  });

  test('ignores stale challenge and signature failures after an account switch', async () => {
    const pendingChallenge = deferred<WalletAuthChallenge>();
    const challengeHarness = await renderProvider(
      wallet(),
      createRuntime({ requestChallenge: async () => pendingChallenge.promise }),
    );
    let preparePromise = Promise.resolve();
    await act(async () => {
      preparePromise = challengeHarness.auth.prepare();
    });
    await challengeHarness.update(wallet({ address: otherAddress, shortAddress: 'othe…ress' }));
    await act(async () => {
      pendingChallenge.reject(new Error('stale challenge'));
      await preparePromise;
    });
    expect(challengeHarness.auth.status).toBe('unauthenticated');
    expect(challengeHarness.auth.error).toBeNull();
    challengeHarness.unmount();

    const pendingSignature = deferred<Uint8Array>();
    const signatureHarness = await renderProvider(
      wallet({ signMessage: async () => pendingSignature.promise }),
      createRuntime(),
    );
    await act(async () => signatureHarness.auth.prepare());
    let signInPromise = Promise.resolve(false);
    await act(async () => {
      signInPromise = signatureHarness.auth.signIn();
    });
    await signatureHarness.update(
      wallet({ address: null, canSignMessage: false, shortAddress: null, status: 'disconnected' }),
    );
    await act(async () => {
      pendingSignature.reject(new Error('stale signature'));
      expect(await signInPromise).toBe(false);
    });
    expect(signatureHarness.auth.status).toBe('unauthenticated');
    expect(signatureHarness.auth.error).toBeNull();
    signatureHarness.unmount();
  });

  test('requires a current-wallet challenge and makes unauthenticated sign-out a no-op', async () => {
    const revoked: string[] = [];
    const harness = await renderProvider(
      wallet(),
      createRuntime({
        requestChallenge: async () => ({ ...challenge, wallet: otherAddress }),
        revokeSession: async (token) => {
          revoked.push(token);
        },
      }),
    );

    await act(async () => harness.auth.prepare());
    let signedIn = true;
    await act(async () => {
      signedIn = await harness.auth.signIn();
    });
    expect(signedIn).toBe(false);
    expect(harness.auth.error).toContain('fresh authentication message');

    await act(async () => harness.auth.signOut());
    expect(harness.auth.status).toBe('unauthenticated');
    expect(revoked).toEqual([]);
    harness.unmount();
  });

  test('surfaces the current wallet signing error message', async () => {
    const harness = await renderProvider(
      wallet({
        signMessage: async () => {
          throw new Error('Phantom declined the message.');
        },
      }),
      createRuntime(),
    );

    await act(async () => harness.auth.prepare());
    let signedIn = true;
    await act(async () => {
      signedIn = await harness.auth.signIn();
    });

    expect(signedIn).toBe(false);
    expect(harness.auth.status).toBe('error');
    expect(harness.auth.error).toBe('Phantom declined the message.');
    harness.unmount();
  });

  test('ignores an aborted server restoration', async () => {
    const storage = createStorage({ [walletSessionStorageKey]: JSON.stringify(session) });
    const harness = await renderProvider(
      wallet(),
      createRuntime({
        storage,
        validateSession: async () => {
          throw new DOMException('cancelled', 'AbortError');
        },
      }),
    );

    expect(harness.auth.status).toBe('restoring');
    expect(harness.auth.error).toBeNull();
    expect(storage.getItem(walletSessionStorageKey)).not.toBeNull();
    harness.unmount();
  });

  test('discards a restoration response completed after its effect was replaced', async () => {
    const pendingValidation = deferred<{
      network: WalletSession['network'];
      wallet: string;
    } | null>();
    let validations = 0;
    const harness = await renderProvider(
      wallet(),
      createRuntime({
        storage: createStorage({ [walletSessionStorageKey]: JSON.stringify(session) }),
        validateSession: async () => {
          validations += 1;
          return validations === 1 ? pendingValidation.promise : null;
        },
      }),
    );

    await harness.update(wallet({ address: otherAddress, shortAddress: 'othe…ress' }));
    await act(async () => {
      pendingValidation.resolve({ network: session.network, wallet: address });
    });

    expect(harness.auth.status).toBe('unauthenticated');
    expect(harness.auth.sessionToken).toBeNull();
    harness.unmount();
  });

  test('revokes the stored backend session when signing out during restoration', async () => {
    const pendingValidation = deferred<{
      network: WalletSession['network'];
      wallet: string;
    } | null>();
    const revoked: string[] = [];
    const storage = createStorage({ [walletSessionStorageKey]: JSON.stringify(session) });
    const harness = await renderProvider(
      wallet(),
      createRuntime({
        revokeSession: async (token) => {
          revoked.push(token);
        },
        storage,
        validateSession: async () => pendingValidation.promise,
      }),
    );

    expect(harness.auth.status).toBe('restoring');
    await act(async () => harness.auth.signOut());
    expect(storage.getItem(walletSessionStorageKey)).toBeNull();
    expect(revoked).toEqual([session.token]);

    await act(async () => {
      pendingValidation.resolve({ network: session.network, wallet: address });
    });
    expect(harness.auth.status).toBe('unauthenticated');
    expect(harness.auth.sessionToken).toBeNull();
    harness.unmount();
  });

  test('keeps an authenticated session active when runtime wiring is replaced', async () => {
    const harness = await renderProvider(wallet(), createRuntime());
    await act(async () => harness.auth.prepare());
    await act(async () => {
      await harness.auth.signIn();
    });

    expect(harness.auth.status).toBe('authenticated');
    await harness.updateRuntime(createRuntime());
    expect(harness.auth.status).toBe('authenticated');
    expect(harness.auth.sessionToken).toBe(session.token);
    harness.unmount();
  });
});

function Probe({
  capture,
  runtime,
  wallet: walletValue,
}: {
  capture: (auth: ReturnType<typeof useWalletAuthRuntime>) => void;
  runtime: WalletAuthRuntime;
  wallet: WalletContextValue;
}) {
  capture(useWalletAuthRuntime(walletValue, runtime));
  return null;
}

async function renderProvider(initialWallet: WalletContextValue, runtime: WalletAuthRuntime) {
  let auth: ReturnType<typeof useWalletAuthRuntime> | null = null;
  let renderer: ReactTestRenderer;
  let currentRuntime = runtime;
  let currentWallet = initialWallet;
  const render = () => (
    <Probe capture={(value) => (auth = value)} runtime={currentRuntime} wallet={currentWallet} />
  );
  await act(async () => {
    renderer = create(render());
  });
  return {
    get auth() {
      if (!auth) throw new Error('Wallet auth probe did not render.');
      return auth;
    },
    unmount: () => {
      act(() => renderer.unmount());
    },
    update: async (walletValue: WalletContextValue) => {
      currentWallet = walletValue;
      await act(async () => renderer.update(render()));
    },
    updateRuntime: async (runtimeValue: WalletAuthRuntime) => {
      currentRuntime = runtimeValue;
      await act(async () => renderer.update(render()));
    },
  };
}

function createRuntime(
  overrides: Partial<WalletAuthRuntime> & { storage?: Storage } = {},
): WalletAuthRuntime {
  const { storage = createStorage(), ...runtimeOverrides } = overrides;
  return {
    cancelExpiration: () => undefined,
    createSession: async () => session,
    getStorage: () => storage,
    now: () => Date.parse('2099-01-01T00:00:00.000Z'),
    requestChallenge: async () => challenge,
    revokeSession: async () => undefined,
    scheduleExpiration: () => 1,
    trackAuthenticated: () => undefined,
    validateSession: async () => null,
    ...runtimeOverrides,
  };
}

function wallet(overrides: Partial<WalletContextValue> = {}): WalletContextValue {
  return {
    account: null,
    address,
    balanceStatus: 'idle',
    balances: null,
    canSignMessage: true,
    canSignTransaction: true,
    clearError: () => undefined,
    cluster: 'devnet',
    connect: async () => true,
    disconnect: async () => undefined,
    error: null,
    networkStatus: 'online',
    refreshBalances: async () => null,
    retryNetwork: async () => true,
    rpcUrl: 'https://api.devnet.solana.com',
    selectedWallet: null,
    shortAddress: '1111…1111',
    signAndSendTransaction: async () => 'signature',
    signMessage: async () => Uint8Array.from([1, 2, 3]),
    signTransaction: async () => ({
      serializedTransaction: new Uint8Array(),
      signature: 'signature',
      signedTransactionBase64: '',
    }),
    status: 'connected',
    wallets: [],
    ...overrides,
  };
}

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}
