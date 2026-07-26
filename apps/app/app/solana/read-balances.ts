import type { BalanceStatus, WalletBalances } from './balance';
import { fetchLamportBalance, fetchTokenBalance } from './rpc-client';

// Extracted from the provider's refreshBalances callback so the read policy is
// testable without a DOM: a hook body never executes under renderToStaticMarkup,
// and this is the part with the decisions in it. Mirrors the pure/impure split
// already used by confirmation.ts and track-confirmation.ts in this directory.

type BalanceReaders = {
  readLamports?: (address: string) => Promise<bigint>;
  readToken?: (address: string, mint: string) => Promise<WalletBalances['token']>;
};

/**
 * Resolves SOL and, when a mint is supplied, that SPL balance for one address.
 *
 * Both reads are issued together because a serial pair would show the wallet
 * chip a half-updated balance for a full round trip. Omitting `mint` clears any
 * previously read token amount rather than leaving a stale figure from another
 * mint on screen.
 *
 * Returns null instead of throwing on any RPC failure: balance is advisory
 * everywhere it is consumed, and an RPC hiccup must never be able to block a
 * funding flow that would otherwise succeed.
 */
export async function readWalletBalances(
  address: string,
  mint?: string | null,
  readers: BalanceReaders = {},
): Promise<WalletBalances | null> {
  const readLamports = readers.readLamports ?? fetchLamportBalance;
  const readToken = readers.readToken ?? fetchTokenBalance;
  try {
    const [lamports, token] = await Promise.all([
      readLamports(address),
      mint ? readToken(address, mint) : Promise.resolve(null),
    ]);
    return { lamports, token };
  } catch {
    return null;
  }
}

type BalanceSink = {
  setBalances: (balances: WalletBalances | null) => void;
  setBalanceStatus: (status: BalanceStatus) => void;
};

type BalanceRefreshGuard = {
  getCurrentAddress?: () => string | null;
  isCurrent?: () => boolean;
};

/**
 * Runs one balance read for the connected address and mirrors the outcome into
 * whatever holds the UI state. Split out of the provider's useCallback so the
 * three outcomes below are reachable from a test: a hook body never executes
 * under renderToStaticMarkup, and this is the part with the decisions in it.
 *
 * A disconnected wallet clears to `idle` without touching the network. A failed
 * read leaves the last known figure on screen behind an `error` status — a read
 * that could not complete is not evidence the wallet emptied, and blanking the
 * number would read as exactly that. The optional guard lets the provider reject
 * an out-of-order completion or a callback captured for a previously connected
 * wallet.
 */
export async function refreshWalletBalances(
  address: string | null,
  mint: string | null | undefined,
  sink: BalanceSink,
  read: typeof readWalletBalances = readWalletBalances,
  guard: BalanceRefreshGuard = {},
): Promise<WalletBalances | null> {
  const isCurrent = () =>
    (guard.isCurrent?.() ?? true) &&
    (guard.getCurrentAddress ? guard.getCurrentAddress() === address : true);
  if (!isCurrent()) return null;
  if (!address) {
    sink.setBalances(null);
    sink.setBalanceStatus('idle');
    return null;
  }
  sink.setBalanceStatus('loading');
  const next = await read(address, mint);
  if (!isCurrent()) return null;
  if (!next) {
    sink.setBalanceStatus('error');
    return null;
  }
  sink.setBalances(next);
  sink.setBalanceStatus('ready');
  return next;
}
