import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
} from '@solana/wallet-standard-features';
import { sendWalletTransaction, signWalletTransaction } from './wallet-provider';
import { inspectSignedWalletTransaction } from './wallet-transaction';

const SIGNED_TRANSACTION = Uint8Array.from([
  1,
  ...Uint8Array.from({ length: 64 }, (_, index) => index + 1),
  2,
  3,
]);
const ACCOUNT = {} as NonNullable<Parameters<typeof signWalletTransaction>[1]>;

function wallet(
  signTransaction?: (...inputs: unknown[]) => Promise<Array<{ signedTransaction: Uint8Array }>>,
) {
  return {
    features: signTransaction
      ? {
          [SolanaSignTransaction]: {
            signTransaction,
            version: '1.0.0',
          },
        }
      : {},
    name: 'Test Wallet',
  } as unknown as NonNullable<Parameters<typeof signWalletTransaction>[0]>;
}

// The provider is loaded and rendered through apps/app/app/duel/duel-entry-stepper.test.tsx,
// which imports the real module before stubbing the hook, so a second render harness here
// would only see that stub. What it cannot catch is a regression in the persisted key,
// which would silently strand every saved wallet choice.
describe('solana wallet provider', () => {
  test('persists the selected wallet under the rebranded storage namespace', () => {
    const source = readFileSync(new URL('./wallet-provider.tsx', import.meta.url), 'utf8');

    expect(source).toContain("const walletStorageKey = 'dailydraft.wallet';");
    expect(source).not.toContain('openpacksduel');
  });

  test('derives signed bytes without broadcasting from a sign-only wallet', async () => {
    const result = await signWalletTransaction(
      wallet(async () => [{ signedTransaction: SIGNED_TRANSACTION }]),
      ACCOUNT,
      new Uint8Array([9]),
    );

    expect(result.serializedTransaction).toBe(SIGNED_TRANSACTION);
    expect(result.signature).toBeTruthy();
    expect(result.signedTransactionBase64).toBeTruthy();
  });

  test('uses a combined wallet signature directly and reports it before returning', async () => {
    const expected = inspectSignedWalletTransaction(SIGNED_TRANSACTION).signature;
    const observed: string[] = [];
    const combinedWallet = {
      features: {
        [SolanaSignAndSendTransaction]: {
          signAndSendTransaction: async () => [{ signature: SIGNED_TRANSACTION.slice(1, 65) }],
          version: '1.0.0',
        },
      },
      name: 'Combined Wallet',
    } as unknown as NonNullable<Parameters<typeof sendWalletTransaction>[0]>;

    await expect(
      sendWalletTransaction(combinedWallet, ACCOUNT, new Uint8Array([9]), (signature) =>
        observed.push(signature),
      ),
    ).resolves.toBe(expected);
    expect(observed).toEqual([expected]);
  });

  test('falls back from a sign-only wallet to broadcasting the exact signed bytes', async () => {
    const expected = inspectSignedWalletTransaction(SIGNED_TRANSACTION).signature;
    const observed: string[] = [];
    const broadcasted: Uint8Array[] = [];

    await expect(
      sendWalletTransaction(
        wallet(async () => [{ signedTransaction: SIGNED_TRANSACTION }]),
        ACCOUNT,
        new Uint8Array([9]),
        (signature) => observed.push(signature),
        async (serializedTransaction, onSignature) => {
          broadcasted.push(serializedTransaction);
          onSignature?.(expected);
          return expected;
        },
      ),
    ).resolves.toBe(expected);
    expect(broadcasted).toEqual([SIGNED_TRANSACTION]);
    expect(observed).toEqual([expected]);
  });

  test('fails safely for disconnected, combined-only, empty, and rejected signers', async () => {
    await expect(signWalletTransaction(null, null, new Uint8Array())).rejects.toThrow(
      'Connect a Solana wallet first.',
    );
    await expect(signWalletTransaction(wallet(), ACCOUNT, new Uint8Array())).rejects.toMatchObject({
      message: expect.stringContaining('only supports combined sign-and-send'),
      reason: 'pre-broadcast-failure',
    });
    await expect(
      signWalletTransaction(
        wallet(async () => []),
        ACCOUNT,
        new Uint8Array(),
      ),
    ).rejects.toMatchObject({
      message: 'The wallet returned no signed transaction. Nothing was broadcast.',
      reason: 'pre-broadcast-failure',
    });
    await expect(
      signWalletTransaction(
        wallet(async () => {
          throw { code: 4001 };
        }),
        ACCOUNT,
        new Uint8Array(),
      ),
    ).rejects.toMatchObject({ reason: 'rejected' });
  });
});
