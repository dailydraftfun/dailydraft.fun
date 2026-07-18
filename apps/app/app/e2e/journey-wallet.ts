import { SolanaSignAndSendTransaction, SolanaSignMessage } from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardDisconnect, StandardEvents } from '@wallet-standard/features';

import { SOLANA_CHAIN } from '../solana/config';

export type JourneyFixtureBootstrap = {
  seed: string;
  transactionSignature: number[];
  version: 1;
  wallet: {
    address: string;
    messageSignature: number[];
    publicKey: number[];
  };
};

declare global {
  interface Window {
    __OPENPACKSDUEL_JOURNEY__?: JourneyFixtureBootstrap;
  }
}

const fixtureIcon =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" rx="8" fill="%23b8ff5a"/%3E%3Cpath d="M9 10h14v12H9z" fill="%230c1510"/%3E%3C/svg%3E';

export function readJourneyFixtureBootstrap(): JourneyFixtureBootstrap | null {
  if (process.env.NEXT_PUBLIC_E2E_FIXTURES !== '1' || typeof window === 'undefined') return null;
  const bootstrap = window.__OPENPACKSDUEL_JOURNEY__;
  if (!bootstrap) throw new Error('Journey fixture setup is missing its browser bootstrap.');
  assertBootstrap(bootstrap);
  return bootstrap;
}

export function createJourneyFixtureWallet(bootstrap: JourneyFixtureBootstrap): Wallet {
  assertBootstrap(bootstrap);
  const account: WalletAccount = {
    address: bootstrap.wallet.address,
    chains: [SOLANA_CHAIN],
    features: [SolanaSignAndSendTransaction, SolanaSignMessage],
    icon: fixtureIcon,
    label: `Journey ${bootstrap.seed}`,
    publicKey: Uint8Array.from(bootstrap.wallet.publicKey),
  };

  return {
    accounts: [],
    chains: [SOLANA_CHAIN],
    features: {
      [SolanaSignAndSendTransaction]: {
        signAndSendTransaction: async (...inputs: unknown[]) =>
          inputs.map(() => ({
            signature: Uint8Array.from(bootstrap.transactionSignature),
          })),
        supportedTransactionVersions: ['legacy', 0],
        version: '1.0.0',
      },
      [SolanaSignMessage]: {
        signMessage: async (...inputs: Array<{ account: WalletAccount; message: Uint8Array }>) =>
          inputs.map((input) => ({
            signature: Uint8Array.from(bootstrap.wallet.messageSignature),
            signedMessage: input.message,
          })),
        version: '1.0.0',
      },
      [StandardConnect]: {
        connect: async () => ({ accounts: [account] }),
        version: '1.0.0',
      },
      [StandardDisconnect]: {
        disconnect: async () => undefined,
        version: '1.0.0',
      },
      [StandardEvents]: {
        on: () => () => undefined,
        version: '1.0.0',
      },
    },
    icon: fixtureIcon,
    name: 'Pack Duel Journey Fixture',
    version: '1.0.0',
  } as unknown as Wallet;
}

function assertBootstrap(value: JourneyFixtureBootstrap): void {
  if (value.version !== 1) throw new Error('Journey fixture setup has an unsupported version.');
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(value.seed)) {
    throw new Error('Journey fixture setup has an invalid seed.');
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.wallet.address)) {
    throw new Error('Journey fixture setup has an invalid wallet address.');
  }
  assertBytes(value.wallet.publicKey, 32, 'wallet public key');
  assertBytes(value.wallet.messageSignature, 64, 'message signature');
  assertBytes(value.transactionSignature, 64, 'transaction signature');
}

function assertBytes(value: number[], length: number, label: string): void {
  if (
    value.length !== length ||
    value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error(`Journey fixture setup has an invalid ${label}.`);
  }
}
