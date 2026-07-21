import { SolanaSignAndSendTransaction, SolanaSignMessage } from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardDisconnect, StandardEvents } from '@wallet-standard/features';

import { SOLANA_CHAIN } from '../solana/config';

export type JourneyFixtureBootstrap = {
  failures: {
    walletTransactionRejections: number;
  };
  seed: string;
  transactionSignature: number[];
  version: 1;
  wallet: {
    address: string;
    messageSignature: number[];
    publicKey: number[];
  };
};

type JourneyWalletTelemetry = {
  transactionRequests: number;
  transactionSignatures: number;
};

declare global {
  interface Window {
    __OPENPACKSDUEL_JOURNEY__?: JourneyFixtureBootstrap;
  }
}

const fixtureIcon: NonNullable<WalletAccount['icon']> =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iI2I4ZmY1YSIvPjxwYXRoIGQ9Ik05IDEwaDE0djEySDl6IiBmaWxsPSIjMGMxNTEwIi8+PC9zdmc+';

export function readJourneyFixtureBootstrap(): JourneyFixtureBootstrap | null {
  if (process.env.NEXT_PUBLIC_E2E_FIXTURES !== '1' || typeof window === 'undefined') return null;
  const bootstrap = window.__OPENPACKSDUEL_JOURNEY__;
  if (!bootstrap) throw new Error('Journey fixture setup is missing its browser bootstrap.');
  assertBootstrap(bootstrap);
  return bootstrap;
}

export function createJourneyFixtureWallet(bootstrap: JourneyFixtureBootstrap): Wallet {
  assertBootstrap(bootstrap);
  let transactionAttempts = 0;
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
        signAndSendTransaction: async (...inputs: unknown[]) => {
          transactionAttempts += 1;
          recordTransactionTelemetry(bootstrap.seed, false);
          if (transactionAttempts <= bootstrap.failures.walletTransactionRejections) {
            throw Object.assign(new Error('Wallet rejected the transaction.'), { code: 4001 });
          }
          recordTransactionTelemetry(bootstrap.seed, true);
          return inputs.map(() => ({
            signature: Uint8Array.from(bootstrap.transactionSignature),
          }));
        },
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

export function journeyWalletTelemetryKey(seed: string): string {
  return `openpacksduel:journey-wallet:${seed}`;
}

function recordTransactionTelemetry(seed: string, signed: boolean): void {
  const key = journeyWalletTelemetryKey(seed);
  const stored = window.sessionStorage.getItem(key);
  let telemetry: JourneyWalletTelemetry = { transactionRequests: 0, transactionSignatures: 0 };
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<JourneyWalletTelemetry>;
      if (
        Number.isInteger(parsed.transactionRequests) &&
        Number.isInteger(parsed.transactionSignatures)
      ) {
        telemetry = {
          transactionRequests: parsed.transactionRequests as number,
          transactionSignatures: parsed.transactionSignatures as number,
        };
      }
    } catch {
      // Ignore malformed fixture-only telemetry and replace it with a clean counter.
    }
  }
  window.sessionStorage.setItem(
    key,
    JSON.stringify({
      transactionRequests: telemetry.transactionRequests + (signed ? 0 : 1),
      transactionSignatures: telemetry.transactionSignatures + (signed ? 1 : 0),
    } satisfies JourneyWalletTelemetry),
  );
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
  if (
    !Number.isInteger(value.failures.walletTransactionRejections) ||
    value.failures.walletTransactionRejections < 0 ||
    value.failures.walletTransactionRejections > 20
  ) {
    throw new Error('Journey fixture setup has an invalid wallet rejection count.');
  }
}

function assertBytes(value: number[], length: number, label: string): void {
  if (
    value.length !== length ||
    value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error(`Journey fixture setup has an invalid ${label}.`);
  }
}
