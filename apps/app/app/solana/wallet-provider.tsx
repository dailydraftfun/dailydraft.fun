'use client';

import {
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
import { createContext, useContext, useEffect, useEffectEvent, useState } from 'react';
import { trackProductEvent } from '../analytics-client';
import { SOLANA_CHAIN, SOLANA_CLUSTER, SOLANA_RPC_URL, shortenAddress } from './config';

type CompatibleWallet = WalletWithFeatures<
  StandardConnectFeature &
    StandardEventsFeature &
    SolanaSignTransactionFeature &
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
  error: string | null;
  cluster: typeof SOLANA_CLUSTER;
  rpcUrl: string;
  connect: (wallet: CompatibleWallet) => Promise<boolean>;
  disconnect: () => Promise<void>;
  clearError: () => void;
  canSignMessage: boolean;
  signMessage: (message: string) => Promise<Uint8Array>;
  signTransaction: (serializedTransaction: Uint8Array) => Promise<Uint8Array>;
};

const WalletContext = createContext<WalletContextValue | null>(null);
const walletStorageKey = 'openpacksduel.wallet';

function isCompatibleWallet(wallet: Wallet): wallet is CompatibleWallet {
  return (
    wallet.chains.includes(SOLANA_CHAIN) &&
    StandardConnect in wallet.features &&
    StandardEvents in wallet.features &&
    SolanaSignTransaction in wallet.features
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
  const [error, setError] = useState<string | null>(null);

  const syncWallets = useEffectEvent(() => {
    const compatibleWallets = getWallets().get().filter(isCompatibleWallet);
    setWallets(compatibleWallets);
    setStatus((currentStatus) =>
      currentStatus === 'discovering' ? 'disconnected' : currentStatus,
    );
  });

  useEffect(() => {
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
    const controller = new AbortController();
    fetch(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'openpacksduel-health', method: 'getHealth' }),
      signal: controller.signal,
    })
      .then((response) => {
        setNetworkStatus(response.ok ? 'online' : 'offline');
      })
      .catch((networkError) => {
        if (!(networkError instanceof DOMException && networkError.name === 'AbortError')) {
          setNetworkStatus('offline');
          trackProductEvent({ name: 'ui_error' });
        }
      });
    return () => controller.abort();
  }, []);

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

  async function signTransaction(serializedTransaction: Uint8Array) {
    if (!selectedWallet || !account) throw new Error('Connect a Solana wallet first.');
    const [output] = await selectedWallet.features[SolanaSignTransaction].signTransaction({
      account,
      transaction: serializedTransaction,
      chain: SOLANA_CHAIN,
      options: { preflightCommitment: 'confirmed' },
    });
    if (!output) throw new Error('The wallet did not return a signed transaction.');
    return output.signedTransaction;
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
    address: account?.address ?? null,
    shortAddress: account ? shortenAddress(account.address) : null,
    status,
    networkStatus,
    error,
    canSignMessage: Boolean(selectedWallet?.features[SolanaSignMessage]),
    cluster: SOLANA_CLUSTER,
    rpcUrl: SOLANA_RPC_URL,
    connect,
    disconnect,
    clearError: () => setError(null),
    signTransaction,
    signMessage,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
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
