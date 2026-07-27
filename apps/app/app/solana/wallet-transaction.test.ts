import { describe, expect, test } from 'bun:test';
import bs58 from 'bs58';

import {
  broadcastSignedTransaction,
  inspectSignedWalletTransaction,
  readCompiledTransactionMessage,
  readSignedTransactionSignature,
} from './wallet-transaction';
import { WalletTransactionNotBroadcastError } from './wallet-transaction-error';

const SIGNATURE_BYTES = Uint8Array.from({ length: 64 }, (_, index) => index + 1);
const SIGNED_TRANSACTION = Uint8Array.from([1, ...SIGNATURE_BYTES, 2, 3, 4]);

describe('wallet transaction broadcast', () => {
  test('derives the claim proof before any broadcast', () => {
    const inspected = inspectSignedWalletTransaction(SIGNED_TRANSACTION);

    expect(inspected.signature).toBe(bs58.encode(SIGNATURE_BYTES));
    expect(inspected.serializedTransaction).toBe(SIGNED_TRANSACTION);
    expect(inspected.signedTransactionBase64).toBe(
      Buffer.from(SIGNED_TRANSACTION).toString('base64'),
    );
    expect(readCompiledTransactionMessage(SIGNED_TRANSACTION)).toEqual(new Uint8Array([2, 3, 4]));
  });

  test('persists the wire signature before an RPC response can be lost', async () => {
    const sequence: string[] = [];
    const signature = bs58.encode(SIGNATURE_BYTES);

    const attempt = broadcastSignedTransaction(
      SIGNED_TRANSACTION,
      (observed) => sequence.push(`signature:${observed}`),
      async () => {
        sequence.push('rpc');
        throw new TypeError('Response lost after broadcast.');
      },
    );

    await expect(attempt).rejects.toThrow('Response lost after broadcast.');
    expect(readSignedTransactionSignature(SIGNED_TRANSACTION)).toBe(signature);
    expect(sequence).toEqual([`signature:${signature}`, 'rpc']);
  });

  test('returns the wire signature only when the RPC confirms the same transaction', async () => {
    const signature = bs58.encode(SIGNATURE_BYTES);
    let body: unknown;

    const result = await broadcastSignedTransaction(
      SIGNED_TRANSACTION,
      undefined,
      async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ result: signature }));
      },
    );

    expect(result).toBe(signature);
    expect(body).toMatchObject({
      method: 'sendTransaction',
      params: [expect.any(String), { encoding: 'base64', preflightCommitment: 'confirmed' }],
    });
  });

  test('surfaces a rejected broadcast and a mismatched RPC signature', async () => {
    await expect(
      broadcastSignedTransaction(
        SIGNED_TRANSACTION,
        undefined,
        async () =>
          new Response(JSON.stringify({ error: { message: 'Preflight rejected.' } }), {
            status: 400,
          }),
      ),
    ).rejects.toThrow('Preflight rejected.');

    await expect(
      broadcastSignedTransaction(
        SIGNED_TRANSACTION,
        undefined,
        async () => new Response(JSON.stringify({ result: 'different-signature' })),
      ),
    ).rejects.toThrow('different transaction signature');
  });

  test('blocks broadcast when signature persistence fails', async () => {
    let fetches = 0;
    await expect(
      broadcastSignedTransaction(
        SIGNED_TRANSACTION,
        () => {
          throw new Error('Storage denied.');
        },
        async () => {
          fetches += 1;
          return Response.json({});
        },
      ),
    ).rejects.toMatchObject({
      message: 'The wallet returned invalid signed transaction bytes. Nothing was broadcast.',
      reason: 'pre-broadcast-failure',
    });

    await expect(
      broadcastSignedTransaction(
        SIGNED_TRANSACTION,
        () => {
          throw new WalletTransactionNotBroadcastError(
            'Durable recovery unavailable.',
            'pre-broadcast-failure',
          );
        },
        async () => {
          fetches += 1;
          return Response.json({});
        },
      ),
    ).rejects.toThrow('Durable recovery unavailable.');
    expect(fetches).toBe(0);
  });

  test('uses safe fallback copy when the RPC rejects without an error message', async () => {
    await expect(
      broadcastSignedTransaction(
        SIGNED_TRANSACTION,
        undefined,
        async () => new Response(JSON.stringify({}), { status: 503 }),
      ),
    ).rejects.toThrow('The signed devnet transaction was not broadcast.');
  });

  test('rejects unsigned and truncated wallet responses', async () => {
    await expect(
      broadcastSignedTransaction(new Uint8Array([0x80]), undefined, async () => {
        throw new Error('fetch must not run');
      }),
    ).rejects.toMatchObject({
      message: 'The wallet returned invalid signed transaction bytes. Nothing was broadcast.',
      reason: 'pre-broadcast-failure',
    });
    expect(() => readSignedTransactionSignature(new Uint8Array([0x80]))).toThrow(
      'invalid signature count',
    );
    expect(() => readSignedTransactionSignature(new Uint8Array([0x80, 0x80, 0x80]))).toThrow(
      'invalid signature count',
    );
    expect(() => readSignedTransactionSignature(new Uint8Array([0]))).toThrow(
      'without a complete signature',
    );
    expect(() => readSignedTransactionSignature(new Uint8Array([1, 2, 3]))).toThrow(
      'without a complete signature',
    );
    expect(() =>
      readCompiledTransactionMessage(new Uint8Array([1, ...new Uint8Array(64)])),
    ).toThrow('does not contain a compiled message');
  });
});
