import { describe, expect, test } from 'bun:test';

import type { BalanceStatus, WalletBalances } from './balance';
import { readWalletBalances, refreshWalletBalances } from './read-balances';

const wallet = '4Nd1mB1TrE9gJ2vQ8mHc1oQ5m8y1Y7xZoK3rWpTf6xTk';
const usdc = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

describe('readWalletBalances', () => {
  test('reads SOL alone when no mint is requested', async () => {
    const tokenCalls: string[] = [];

    const balances = await readWalletBalances(wallet, null, {
      readLamports: async () => 2_000_000_000n,
      readToken: async (_address, mint) => {
        tokenCalls.push(mint);
        return { amount: 5n, decimals: 6 };
      },
    });

    expect(balances).toEqual({ lamports: 2_000_000_000n, token: null });
    // Skipping the token read is the point: an omitted mint means "no token
    // balance", not "reuse whatever was read last".
    expect(tokenCalls).toEqual([]);
  });

  test('resolves SOL and the requested SPL balance together', async () => {
    const balances = await readWalletBalances(wallet, usdc, {
      readLamports: async () => 1_000n,
      readToken: async (address, mint) => {
        expect(address).toBe(wallet);
        expect(mint).toBe(usdc);
        return { amount: 42_000_000n, decimals: 6 };
      },
    });

    expect(balances).toEqual({
      lamports: 1_000n,
      token: { amount: 42_000_000n, decimals: 6 },
    });
  });

  test('reports a wallet holding no account for the mint', async () => {
    const balances = await readWalletBalances(wallet, usdc, {
      readLamports: async () => 7n,
      readToken: async () => null,
    });

    expect(balances).toEqual({ lamports: 7n, token: null });
  });

  test('resolves null rather than throwing when the SOL read fails', async () => {
    const balances = await readWalletBalances(wallet, null, {
      readLamports: async () => {
        throw new Error('Solana RPC getBalance responded 503.');
      },
    });

    expect(balances).toBeNull();
  });

  test('resolves null when only the token read fails', async () => {
    // Partial success is still a failure: a lamport figure paired with an
    // unknown token amount would let a preflight clear a payment it cannot
    // actually price.
    const balances = await readWalletBalances(wallet, usdc, {
      readLamports: async () => 2_000_000_000n,
      readToken: async () => {
        throw new Error('Solana RPC getTokenAccountsByOwner returned no result.');
      },
    });

    expect(balances).toBeNull();
  });
});

/** Records every write the provider would make, in order. */
function sink() {
  const balances: Array<WalletBalances | null> = [];
  const statuses: BalanceStatus[] = [];
  return {
    balances,
    statuses,
    setBalances: (next: WalletBalances | null) => balances.push(next),
    setBalanceStatus: (next: BalanceStatus) => statuses.push(next),
  };
}

describe('refreshWalletBalances', () => {
  test('moves through loading to ready with the read figures', async () => {
    const state = sink();
    const read = async () => ({ lamports: 3_000_000_000n, token: null });

    const result = await refreshWalletBalances(wallet, null, state, read);

    expect(result).toEqual({ lamports: 3_000_000_000n, token: null });
    // Order matters: 'loading' has to land before the await so the chip can show
    // a pending state instead of sitting on a stale number.
    expect(state.statuses).toEqual(['loading', 'ready']);
    expect(state.balances).toEqual([{ lamports: 3_000_000_000n, token: null }]);
  });

  test('passes the requested mint straight through to the read', async () => {
    const state = sink();
    const seen: Array<string | null | undefined> = [];

    await refreshWalletBalances(wallet, usdc, state, async (address, mint) => {
      expect(address).toBe(wallet);
      seen.push(mint);
      return { lamports: 1n, token: { amount: 5n, decimals: 6 } };
    });

    expect(seen).toEqual([usdc]);
  });

  test('clears to idle without a network read when no wallet is connected', async () => {
    const state = sink();
    let reads = 0;

    const result = await refreshWalletBalances(null, usdc, state, async () => {
      reads += 1;
      return { lamports: 1n, token: null };
    });

    expect(result).toBeNull();
    expect(reads).toBe(0);
    expect(state.statuses).toEqual(['idle']);
    expect(state.balances).toEqual([null]);
  });

  test('keeps the last known figure on screen when a read fails', async () => {
    const state = sink();

    const result = await refreshWalletBalances(wallet, null, state, async () => null);

    expect(result).toBeNull();
    expect(state.statuses).toEqual(['loading', 'error']);
    // No setBalances call at all: a failed read is not evidence the wallet
    // emptied, and blanking the number would read as exactly that.
    expect(state.balances).toEqual([]);
  });

  test('defaults to the real read when none is injected', async () => {
    // Guards the wiring the provider actually runs on, which every other case
    // here substitutes away.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ id: '1', jsonrpc: '2.0', result: { value: 12n.toString() } })) as never;
    const state = sink();

    try {
      const result = await refreshWalletBalances(wallet, null, state);

      expect(result).toEqual({ lamports: 12n, token: null });
      expect(state.statuses).toEqual(['loading', 'ready']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
