'use client';

import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount, WalletWithFeatures } from '@wallet-standard/base';
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardDisconnect,
  type StandardDisconnectFeature,
  StandardEvents,
  type StandardEventsFeature,
} from '@wallet-standard/features';
import bs58 from 'bs58';
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useState } from 'react';
import { trackProductEvent } from '../analytics-client';
import { createJourneyFixtureWallet, readJourneyFixtureBootstrap } from '../e2e/journey-wallet';
import type { BalanceStatus, WalletBalances } from './balance';
import { SOLANA_CHAIN, SOLANA_CLUSTER, SOLANA_RPC_URL, shortenAddress } from './config';
import { refreshWalletBalances } from './read-balances';
import {
  isExplicitWalletRejection,
  WalletTransactionNotBroadcastError,
} from './wallet-transaction-error';

type CompatibleWallet = WalletWithFeatures<
  StandardConnectFeature &
    StandardEventsFeature &
    Partial<SolanaSignAndSendTransactionFeature> &
    Partial<SolanaSignTransactionFeature> &
    Partial<SolanaSignMessageFeature> &
    Partial<StandardDisconnectFeature>
>;

type WalletStatus = 'discovering' | 'disconnected' | 'connecting' | 'connected' | 'error';
type NetworkStatus = 'checking' | 'online' | 'offline';

type WalletContextValue = {
  wallets: readonly CompatibleWallet[];
  selectedWallet: CompatibleWallet | null;
  account: WalletAccount | null;
  address: string | null;
  shortAddress: string | null;
  status: WalletStatus;
  networkStatus: NetworkStatus;
  balances: WalletBalances | null;
  balanceStatus: BalanceStatus;
  refreshBalances: (mint?: string | null) => Promise<WalletBalances | null>;
  error: string | null;
  cluster: typeof SOLANA_CLUSTER;
  rpcUrl: string;
  retryNetwork: () => Promise<boolean>;
  connect: (wallet: CompatibleWallet) => Promise<boolean>;
  disconnect: () => Promise<void>;
  clearError: () => void;
  canSignMessage: boolean;
  signMessage: (message: string) => Promise<Uint8Array>;
  signAndSendTransaction: (serializedTransaction: Uint8Array) => Promise<string>;
};

const WalletContext = createContext<WalletContextValue | null>(null);
const walletStorageKey = 'dailydraft.wallet';

function isCompatibleWallet(wallet: Wallet): wallet is CompatibleWallet {
  return (
    wallet.chains.includes(SOLANA_CHAIN) &&
    StandardConnect in wallet.features &&
    StandardEvents in wallet.features &&
    (SolanaSignAndSendTransaction in wallet.features || SolanaSignTransaction in wallet.features)
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'The wallet request did not complete. Check the wallet and try again.';
}

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<readonly CompatibleWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<CompatibleWallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [status, setStatus] = useState<WalletStatus>('discovering');
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('checking');
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const address = account?.address ?? null;

  /**
   * Binds the balance read to the connected address. Both the read policy and
   * the status it resolves to live in read-balances.ts, which is reachable from
   * a test; this only supplies the address and the two state setters.
   */
  const refreshBalances = useCallback(
    (mint?: string | null): Promise<WalletBalances | null> =>
      refreshWalletBalances(address, mint, { setBalanceStatus, setBalances }),
    [address],
  );

  const checkNetwork = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    setNetworkStatus('checking');
    try {
      const response = await fetch(SOLANA_RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'dailydraft-genesis',
          method: 'getGenesisHash',
        }),
        signal,
      });
      const payload = (await response.json()) as { result?: unknown };
      const online =
        response.ok && payload.result === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
      setNetworkStatus(online ? 'online' : 'offline');
      return online;
    } catch (networkError) {
      if (!(networkError instanceof DOMException && networkError.name === 'AbortError')) {
        setNetworkStatus('offline');
        trackProductEvent({ name: 'ui_error' });
      }
      return false;
    }
  }, []);

  const syncWallets = useEffectEvent(() => {
    const compatibleWallets = getWallets().get().filter(isCompatibleWallet);
    setWallets(compatibleWallets);
    setStatus((currentStatus) =>
      currentStatus === 'discovering' ? 'disconnected' : currentStatus,
    );
  });

  useEffect(() => {
    const fixtureBootstrap = readJourneyFixtureBootstrap();
    if (fixtureBootstrap) {
      const fixtureWallet = createJourneyFixtureWallet(fixtureBootstrap);
      if (!isCompatibleWallet(fixtureWallet)) {
        throw new Error('Journey fixture wallet does not satisfy the application wallet contract.');
      }
      setWallets([fixtureWallet]);
      setStatus('disconnected');
      return;
    }

    const walletRegistry = getWallets();
    syncWallets();
    const offRegister = walletRegistry.on('register', syncWallets);
    const offUnregister = walletRegistry.on('unregister', syncWallets);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  useEffect(() => {
    if (account) trackProductEvent({ name: 'wallet_connected' });
  }, [account]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    const controller = new AbortController();
    void checkNetwork(controller.signal);
    return () => controller.abort();
  }, [checkNetwork]);

  useEffect(() => {
    if (!selectedWallet) return;
    const offChange = selectedWallet.features[StandardEvents].on('change', (properties) => {
      if (!properties.accounts) return;
      const nextAccount =
        properties.accounts.find((candidate) => candidate.chains.includes(SOLANA_CHAIN)) ?? null;
      setAccount(nextAccount);
      setStatus(nextAccount ? 'connected' : 'disconnected');
    });
    return offChange;
  }, [selectedWallet]);

  useEffect(() => {
    if (wallets.length === 0 || selectedWallet) return;
    const previousWalletName = window.localStorage.getItem(walletStorageKey);
    if (!previousWalletName) return;
    const previousWallet = wallets.find((wallet) => wallet.name === previousWalletName);
    if (!previousWallet) return;

    let cancelled = false;
    previousWallet.features[StandardConnect]
      .connect({ silent: true })
      .then(({ accounts }) => {
        if (cancelled) return;
        const nextAccount = accounts.find((candidate) => candidate.chains.includes(SOLANA_CHAIN));
        if (!nextAccount) return;
        setSelectedWallet(previousWallet);
        setAccount(nextAccount);
        setStatus('connected');
      })
      .catch(() => {
        window.localStorage.removeItem(walletStorageKey);
      });
    return () => {
      cancelled = true;
    };
  }, [wallets, selectedWallet]);

  async function connect(wallet: CompatibleWallet) {
    setStatus('connecting');
    setError(null);
    try {
      const { accounts } = await wallet.features[StandardConnect].connect();
      const nextAccount = accounts.find((candidate) => candidate.chains.includes(SOLANA_CHAIN));
      if (!nextAccount) throw new Error(`${wallet.name} did not provide a Solana devnet account.`);
      setSelectedWallet(wallet);
      setAccount(nextAccount);
      setStatus('connected');
      window.localStorage.setItem(walletStorageKey, wallet.name);
      return true;
    } catch (connectionError) {
      setError(getErrorMessage(connectionError));
      setStatus('error');
      return false;
    }
  }

  async function disconnect() {
    try {
      const disconnectFeature = selectedWallet?.features[StandardDisconnect];
      if (disconnectFeature) {
        await disconnectFeature.disconnect();
      }
    } finally {
      window.localStorage.removeItem(walletStorageKey);
      setSelectedWallet(null);
      setAccount(null);
      setError(null);
      setStatus('disconnected');
    }
  }

  async function signAndSendTransaction(serializedTransaction: Uint8Array) {
    if (!selectedWallet || !account) throw new Error('Connect a Solana wallet first.');
    const sendFeature = selectedWallet.features[SolanaSignAndSendTransaction];
    if (sendFeature) {
      try {
        const [output] = await sendFeature.signAndSendTransaction({
          account,
          chain: SOLANA_CHAIN,
          options: { preflightCommitment: 'confirmed', skipPreflight: false },
          transaction: serializedTransaction,
        });
        if (!output) throw new Error('The wallet did not broadcast the devnet transaction.');
        return bs58.encode(output.signature);
      } catch (transactionError) {
        if (isExplicitWalletRejection(transactionError)) {
          throw new WalletTransactionNotBroadcastError();
        }
        throw transactionError;
      }
    }

    const signFeature = selectedWallet.features[SolanaSignTransaction];
    if (!signFeature) throw new Error(`${selectedWallet.name} cannot sign Solana transactions.`);
    let signedTransaction: Uint8Array;
    try {
      const [signed] = await signFeature.signTransaction({
        account,
        chain: SOLANA_CHAIN,
        options: { preflightCommitment: 'confirmed' },
        transaction: serializedTransaction,
      });
      if (!signed) throw new WalletTransactionNotBroadcastError();
      signedTransaction = signed.signedTransaction;
    } catch {
      throw new WalletTransactionNotBroadcastError();
    }
    return broadcastSignedTransaction(signedTransaction);
  }

  async function signMessage(message: string) {
    if (!selectedWallet || !account) throw new Error('Connect a Solana wallet first.');
    const feature = selectedWallet.features[SolanaSignMessage];
    if (!feature) {
      throw new Error(`${selectedWallet.name} does not support Wallet Standard message signing.`);
    }
    const encodedMessage = new TextEncoder().encode(message);
    const [output] = await feature.signMessage({ account, message: encodedMessage });
    if (!output) throw new Error('The wallet did not return a signed message.');
    if (!bytesEqual(output.signedMessage, encodedMessage)) {
      throw new Error('The wallet changed the authentication message. No session was created.');
    }
    return output.signature;
  }

  const value: WalletContextValue = {
    wallets,
    selectedWallet,
    account,
    address,
    shortAddress: account ? shortenAddress(account.address) : null,
    status,
    networkStatus,
    balances,
    balanceStatus,
    refreshBalances,
    error,
    canSignMessage: Boolean(selectedWallet?.features[SolanaSignMessage]),
    cluster: SOLANA_CLUSTER,
    rpcUrl: SOLANA_RPC_URL,
    retryNetwork: () => checkNetwork(),
    connect,
    disconnect,
    clearError: () => setError(null),
    signAndSendTransaction,
    signMessage,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

async function broadcastSignedTransaction(signedTransaction: Uint8Array): Promise<string> {
  const response = await fetch(SOLANA_RPC_URL, {
    body: JSON.stringify({
      id: 'dailydraft-send',
      jsonrpc: '2.0',
      method: 'sendTransaction',
      params: [
        toBase64(signedTransaction),
        { encoding: 'base64', preflightCommitment: 'confirmed' },
      ],
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const payload = (await response.json()) as { error?: { message?: string }; result?: unknown };
  if (!response.ok || typeof payload.result !== 'string') {
    throw new Error(payload.error?.message ?? 'The signed devnet transaction was not broadcast.');
  }
  return payload.result;
}

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function useSolanaWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useSolanaWallet must be used inside SolanaWalletProvider.');
  return context;
}
