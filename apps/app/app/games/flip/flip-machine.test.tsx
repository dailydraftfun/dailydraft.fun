import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SOLANA_CLUSTER, SOLANA_RPC_URL } from '../../solana/config';
import { WalletAuthProvider } from '../../solana/wallet-auth-provider';
import { SolanaWalletProvider } from '../../solana/wallet-provider';
import { inspectSignedWalletTransaction } from '../../solana/wallet-transaction';
import {
  bindFlipSession,
  clearTerminalFlipRecovery,
  FlipMachine,
  FlipMachineController,
  hydrateRecovery,
} from './flip-machine';
import {
  attachFlipSignedTransaction,
  createAwaitingFlipPaymentRecovery,
  FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY,
  FLIP_PAYMENT_RECOVERY_STORAGE_KEY,
  FLIP_PAYMENT_RECOVERY_V2_STORAGE_KEY,
} from './flip-payment-recovery';

describe('flip machine controller', () => {
  test('binds preparation, confirmation, and refresh clients to one session', async () => {
    const session = bindFlipSession('session_secret');
    const confirmIo = session.createFlipConfirmIo(async () => {
      throw new Error('The signer is not used by this binding test.');
    });

    await expect(
      session.prepareFlipRip({
        address: 'payer',
        machineKey: 'dailydraft-devnet-football-10000',
      }),
    ).resolves.toEqual({
      message: 'The Sports Pack Gacha API is not configured.',
      status: 'failed',
    });
    await expect(session.prepareGachaPaymentTransaction('gachapay_1')).rejects.toThrow(
      'The Sports Pack Gacha API is not configured.',
    );
    await expect(confirmIo.verifyPayment('gachapay_1', 'signature')).rejects.toThrow(
      'The Sports Pack Gacha API is not configured.',
    );
  });

  test('reads the active wallet session from the application providers', () => {
    const html = renderToStaticMarkup(
      <SolanaWalletProvider>
        <WalletAuthProvider>
          <FlipMachine />
        </WalletAuthProvider>
      </SolanaWalletProvider>,
    );

    expect(html).toContain('data-stage="loading"');
  });

  test('server-renders the disconnected live controller without a wallet provider', () => {
    const html = renderToStaticMarkup(
      <FlipMachineController
        wallet={{
          account: null,
          address: null,
          balanceStatus: 'idle',
          balances: null,
          canSignMessage: false,
          canSignTransaction: false,
          clearError: () => undefined,
          cluster: SOLANA_CLUSTER,
          connect: async () => false,
          disconnect: async () => undefined,
          error: null,
          networkStatus: 'online',
          refreshBalances: async () => null,
          retryNetwork: async () => true,
          rpcUrl: SOLANA_RPC_URL,
          selectedWallet: null,
          shortAddress: null,
          signTransaction: async () => {
            throw new Error('The signer must not run during render.');
          },
          signAndSendTransaction: async () => {
            throw new Error('The signer must not run during render.');
          },
          signMessage: async () => {
            throw new Error('The signer must not run during render.');
          },
          status: 'disconnected',
          wallets: [],
        }}
      />,
    );

    expect(html).toContain('data-stage="loading"');
    expect(html).toContain('Warming up');
    expect(html).not.toContain('<button');
  });

  test('clears browser recovery only for a proven terminal outcome', () => {
    const record = createAwaitingFlipPaymentRecovery({
      commitmentId: 'gachaseed_123',
      intentId: 'gachapay_123',
      machineKey: 'dailydraft-devnet-football-10000',
      mint: 'M'.repeat(32),
      oddsVersion: 3,
      payerWallet: 'P'.repeat(32),
      serverSeedHash: 'a'.repeat(64),
      sourceTokenAccount: 'S'.repeat(32),
    });
    const recoveryRef = { current: record };
    const removed: string[] = [];
    const storage = { removeItem: (key: string) => removed.push(key) };

    clearTerminalFlipRecovery(
      { message: 'Still reconciling.', status: 'failed' },
      recoveryRef,
      storage,
    );
    expect(recoveryRef.current).toBe(record);
    expect(removed).toEqual([]);

    clearTerminalFlipRecovery(
      { message: 'Failed on-chain.', status: 'retryable' },
      recoveryRef,
      storage,
    );
    expect(recoveryRef.current).toBeNull();
    expect(removed).toEqual([
      FLIP_PAYMENT_RECOVERY_STORAGE_KEY,
      FLIP_PAYMENT_RECOVERY_V2_STORAGE_KEY,
      FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY,
    ]);
  });

  test('clears a pre-sign reload record because sign-only wallets cannot have broadcast it', () => {
    const record = createAwaitingFlipPaymentRecovery({
      commitmentId: 'gachaseed_123',
      intentId: 'gachapay_123',
      machineKey: 'dailydraft-devnet-football-10000',
      mint: 'M'.repeat(32),
      oddsVersion: 3,
      payerWallet: 'P'.repeat(32),
      serverSeedHash: 'a'.repeat(64),
      sourceTokenAccount: 'S'.repeat(32),
    });
    const values = new Map([[FLIP_PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(record)]]);
    const actions: unknown[] = [];
    const recoveryRef = { current: record };

    hydrateRecovery(
      {
        getItem: (key) => values.get(key) ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value),
      },
      recoveryRef,
      (action) => actions.push(action),
    );

    expect(recoveryRef.current).toBeNull();
    expect(actions).toEqual([{ type: 'recovery-cleared' }]);
    expect(values.size).toBe(0);
  });

  test('hydrates mismatched signed bytes as an invalid fail-closed recovery state', () => {
    const authority = inspectSignedWalletTransaction(
      Uint8Array.from([1, ...new Uint8Array(64).fill(7), 2]),
    );
    const losing = inspectSignedWalletTransaction(
      Uint8Array.from([1, ...new Uint8Array(64).fill(9), 2]),
    );
    const corrupt = attachFlipSignedTransaction(
      createAwaitingFlipPaymentRecovery({
        commitmentId: 'gachaseed_123',
        intentId: 'gachapay_123',
        machineKey: 'dailydraft-devnet-football-10000',
        mint: 'M'.repeat(32),
        oddsVersion: 3,
        payerWallet: 'P'.repeat(32),
        serverSeedHash: 'a'.repeat(64),
        sourceTokenAccount: 'S'.repeat(32),
      }),
      {
        signature: authority.signature,
        signedTransactionBase64: losing.signedTransactionBase64,
      },
    );
    const actions: unknown[] = [];
    const recoveryRef = { current: corrupt };
    const values = new Map([[FLIP_PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(corrupt)]]);

    hydrateRecovery(
      {
        getItem: (key) => values.get(key) ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value),
      },
      recoveryRef,
      (action) => actions.push(action),
    );

    expect(recoveryRef.current).toBeNull();
    expect(actions).toEqual([{ type: 'recovery-invalid' }]);
    expect(values.get(FLIP_PAYMENT_RECOVERY_STORAGE_KEY)).toBe(JSON.stringify(corrupt));
  });
});
