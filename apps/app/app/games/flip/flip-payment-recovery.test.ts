import { describe, expect, test } from 'bun:test';
import { readSignedTransactionSignature } from '../../solana/wallet-transaction';

import {
  attachFlipPaymentSignature,
  attachFlipSignedTransaction,
  clearFlipPaymentRecovery,
  createAwaitingFlipPaymentRecovery,
  FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY,
  FLIP_PAYMENT_RECOVERY_STALE_AFTER_MS,
  FLIP_PAYMENT_RECOVERY_STORAGE_KEY,
  FLIP_PAYMENT_RECOVERY_V2_STORAGE_KEY,
  readFlipPaymentRecovery,
  storeFlipPaymentRecovery,
} from './flip-payment-recovery';

type TestStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const NOW = Date.parse('2026-07-26T00:00:00.000Z');
const INPUT = {
  commitmentId: 'gachaseed_123',
  intentId: 'gachapay_123',
  machineKey: 'dailydraft-devnet-football-50000000',
  mint: 'M'.repeat(32),
  oddsVersion: 3,
  payerWallet: 'P'.repeat(32),
  serverSeedHash: 'a'.repeat(64),
  sourceTokenAccount: 'S'.repeat(32),
};
const SIGNATURE = 'Z'.repeat(88);
const SIGNED_TRANSACTION = Uint8Array.from([1, ...new Uint8Array(64).fill(7), 2]);
const SIGNED_TRANSACTION_BASE64 = Buffer.from(SIGNED_TRANSACTION).toString('base64');
const SIGNED_SIGNATURE = readSignedTransactionSignature(SIGNED_TRANSACTION);
const LOSING_TRANSACTION_BASE64 = Buffer.from(
  Uint8Array.from([1, ...new Uint8Array(64).fill(9), 2]),
).toString('base64');

describe('flip payment recovery storage', () => {
  test('survives a reload with only the fields needed to resume one known signature', () => {
    const storage = memoryStorage();
    const unknown = createAwaitingFlipPaymentRecovery(INPUT, '2026-07-26T00:00:00.000Z');
    const known = attachFlipPaymentSignature(unknown, SIGNATURE, '2026-07-26T00:00:01.000Z');

    expect(storeFlipPaymentRecovery(storage, known)).toBe(true);

    const reloaded = readFlipPaymentRecovery(storage, NOW + 2_000);
    expect(reloaded).toEqual({ record: known, stale: false, status: 'valid' });
    const raw = storage.getItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY) as string;
    expect(raw).not.toContain('serializedTransaction');
    expect(raw).not.toContain('memoNonce');
    expect(raw).not.toContain('destinationTokenAccount');
    expect(raw).not.toContain('session');
  });

  test('persists exact signed bytes before claim so reload can retry without the wallet', () => {
    const storage = memoryStorage();
    const signed = attachFlipSignedTransaction(createAwaitingFlipPaymentRecovery(INPUT), {
      signature: SIGNED_SIGNATURE,
      signedTransactionBase64: SIGNED_TRANSACTION_BASE64,
    });

    expect(storeFlipPaymentRecovery(storage, signed)).toBe(true);
    expect(readFlipPaymentRecovery(storage)).toMatchObject({
      record: {
        signature: SIGNED_SIGNATURE,
        signedTransactionBase64: SIGNED_TRANSACTION_BASE64,
        status: 'signed-claim-pending',
        version: 3,
      },
      status: 'valid',
    });
  });

  test('fails a signed record closed when its bytes encode a different transaction signature', () => {
    const storage = memoryStorage();
    const corrupt = attachFlipSignedTransaction(createAwaitingFlipPaymentRecovery(INPUT), {
      signature: SIGNED_SIGNATURE,
      signedTransactionBase64: LOSING_TRANSACTION_BASE64,
    });
    const raw = JSON.stringify(corrupt);
    storage.setItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY, raw);

    expect(readFlipPaymentRecovery(storage)).toEqual({ status: 'invalid' });
    expect(storage.getItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY)).toBe(raw);
  });

  test('migrates a valid v1 record to v3 without inventing signed bytes', () => {
    const storage = memoryStorage();
    const current = attachFlipPaymentSignature(
      createAwaitingFlipPaymentRecovery(INPUT, '2026-07-26T00:00:00.000Z'),
      SIGNATURE,
      '2026-07-26T00:00:01.000Z',
    );
    const { signedTransactionBase64: _signedBytes, ...legacy } = current;
    storage.setItem(
      FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY,
      JSON.stringify({ ...legacy, version: 1 }),
    );

    expect(readFlipPaymentRecovery(storage, NOW + 2_000)).toMatchObject({
      record: {
        signature: SIGNATURE,
        signedTransactionBase64: null,
        status: 'signature-known',
        version: 3,
      },
      status: 'valid',
    });
    expect(storage.getItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY)).toBeNull();
  });

  test('keeps a v1 broadcast-unknown record locked because it may already be on chain', () => {
    const storage = memoryStorage();
    const legacy = {
      ...createAwaitingFlipPaymentRecovery(INPUT, '2026-07-26T00:00:00.000Z'),
      status: 'broadcast-unknown',
      version: 1,
    };
    const raw = JSON.stringify(legacy);
    storage.setItem(FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY, raw);

    expect(readFlipPaymentRecovery(storage, NOW)).toEqual({ status: 'invalid' });
    expect(storage.getItem(FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY)).toBe(raw);
    expect(storage.getItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull();
  });

  test('migrates signed v2 recovery into v3 without changing its signed bytes', () => {
    const storage = memoryStorage();
    const current = attachFlipSignedTransaction(createAwaitingFlipPaymentRecovery(INPUT), {
      signature: SIGNED_SIGNATURE,
      signedTransactionBase64: SIGNED_TRANSACTION_BASE64,
    });
    storage.setItem(
      FLIP_PAYMENT_RECOVERY_V2_STORAGE_KEY,
      JSON.stringify({ ...current, version: 2 }),
    );

    expect(readFlipPaymentRecovery(storage)).toMatchObject({
      record: {
        signature: SIGNED_SIGNATURE,
        signedTransactionBase64: SIGNED_TRANSACTION_BASE64,
        status: 'signed-claim-pending',
        version: 3,
      },
      status: 'valid',
    });
    expect(storage.getItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(FLIP_PAYMENT_RECOVERY_V2_STORAGE_KEY)).toBeNull();
  });

  test('marks a stale pre-sign record without silently deleting it at the storage boundary', () => {
    const storage = memoryStorage();
    const record = createAwaitingFlipPaymentRecovery(INPUT, '2026-07-24T00:00:00.000Z');
    storeFlipPaymentRecovery(storage, record);

    expect(readFlipPaymentRecovery(storage, NOW + FLIP_PAYMENT_RECOVERY_STALE_AFTER_MS)).toEqual({
      record,
      stale: true,
      status: 'valid',
    });
    expect(storage.getItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY)).not.toBeNull();
  });

  test('fails corrupt, future, and unsupported-version records closed without deleting them', () => {
    for (const raw of [
      '{not-json',
      JSON.stringify({ ...createAwaitingFlipPaymentRecovery(INPUT), version: 0 }),
      JSON.stringify({
        ...attachFlipSignedTransaction(createAwaitingFlipPaymentRecovery(INPUT), {
          signature: SIGNATURE,
          signedTransactionBase64: 'not-base64',
        }),
      }),
      JSON.stringify({
        ...attachFlipSignedTransaction(createAwaitingFlipPaymentRecovery(INPUT), {
          signature: SIGNATURE,
          signedTransactionBase64: '%'.repeat(88),
        }),
      }),
      JSON.stringify({
        ...attachFlipSignedTransaction(createAwaitingFlipPaymentRecovery(INPUT), {
          signature: SIGNED_SIGNATURE,
          signedTransactionBase64: `${SIGNED_TRANSACTION_BASE64}\n`,
        }),
      }),
      JSON.stringify(createAwaitingFlipPaymentRecovery(INPUT, '2026-07-26T00:02:00.000Z')),
    ]) {
      const storage = memoryStorage();
      storage.setItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY, raw);

      expect(readFlipPaymentRecovery(storage, NOW)).toEqual({ status: 'invalid' });
      expect(storage.getItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY)).toBe(raw);
    }
  });

  test('clears only through the explicit terminal operation and handles denied storage', () => {
    const storage = memoryStorage();
    storeFlipPaymentRecovery(storage, createAwaitingFlipPaymentRecovery(INPUT));
    expect(clearFlipPaymentRecovery(storage)).toBe(true);
    expect(readFlipPaymentRecovery(storage)).toEqual({ status: 'empty' });

    const denied: TestStorage = {
      getItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
      removeItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    };
    expect(readFlipPaymentRecovery(denied)).toEqual({ status: 'invalid' });
    expect(storeFlipPaymentRecovery(denied, createAwaitingFlipPaymentRecovery(INPUT))).toBe(false);
    expect(clearFlipPaymentRecovery(denied)).toBe(false);
  });
});

function memoryStorage(): TestStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
