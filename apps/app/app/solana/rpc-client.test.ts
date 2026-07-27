import { describe, expect, test } from 'bun:test';
import {
  fetchLamportBalance,
  fetchSignatureCommitment,
  fetchTokenAccountBalance,
  fetchTokenBalance,
  SolanaRpcError,
} from './rpc-client';

type RpcCall = { method: string; params: unknown[] };

/**
 * Swaps globalThis.fetch for the duration of one call and hands back both the
 * result and the JSON-RPC envelope the client sent, so the request shape is
 * asserted alongside the parsed response. Same save/restore idiom as
 * app/duel/[duelId]/page-contract.test.ts.
 */
async function withRpc<T>(
  respond: (call: RpcCall) => Response,
  run: () => Promise<T>,
): Promise<{ calls: RpcCall[]; result: T }> {
  const originalFetch = globalThis.fetch;
  const calls: RpcCall[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RpcCall;
    calls.push(body);
    return respond(body);
  }) as unknown as typeof fetch;
  try {
    return { calls, result: await run() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const wallet = '4Nd1mB1TrE9gJ2vQ8mHc1oQ5m8y1Y7xZoK3rWpTf6xTk';

describe('fetchLamportBalance', () => {
  test('asks for the confirmed commitment and returns lamports as a bigint', async () => {
    const { calls, result } = await withRpc(
      () => Response.json({ id: '1', jsonrpc: '2.0', result: { value: 2_500_000_000 } }),
      () => fetchLamportBalance(wallet),
    );

    expect(result).toBe(2_500_000_000n);
    expect(calls[0]?.method).toBe('getBalance');
    expect(calls[0]?.params).toEqual([wallet, { commitment: 'confirmed' }]);
  });

  test('treats a missing value as an empty wallet rather than throwing', async () => {
    const { result } = await withRpc(
      () => Response.json({ id: '1', jsonrpc: '2.0', result: {} }),
      () => fetchLamportBalance(wallet),
    );

    expect(result).toBe(0n);
  });
});

describe('fetchTokenBalance', () => {
  const mint = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

  function tokenAccount(amount: string, decimals = 6) {
    return { account: { data: { parsed: { info: { tokenAmount: { amount, decimals } } } } } };
  }

  test('sums every account the owner holds for the mint', async () => {
    const { calls, result } = await withRpc(
      () =>
        Response.json({
          id: '1',
          jsonrpc: '2.0',
          result: { value: [tokenAccount('25000000'), tokenAccount('5000000')] },
        }),
      () => fetchTokenBalance(wallet, mint),
    );

    expect(result).toEqual({ amount: 30_000_000n, decimals: 6 });
    expect(calls[0]?.method).toBe('getTokenAccountsByOwner');
    expect(calls[0]?.params).toEqual([
      wallet,
      { mint },
      { commitment: 'confirmed', encoding: 'jsonParsed' },
    ]);
  });

  test('returns null when the wallet has no token account for the mint', async () => {
    const { result } = await withRpc(
      () => Response.json({ id: '1', jsonrpc: '2.0', result: { value: [] } }),
      () => fetchTokenBalance(wallet, mint),
    );

    expect(result).toBeNull();
  });

  test('treats a result with no value key as no token account', async () => {
    // Some RPC providers omit `value` entirely rather than sending an empty
    // array; reading `.length` off that would throw inside a balance read that
    // is contractually non-throwing.
    const { result } = await withRpc(
      () => Response.json({ id: '1', jsonrpc: '2.0', result: {} }),
      () => fetchTokenBalance(wallet, mint),
    );

    expect(result).toBeNull();
  });
});

describe('fetchTokenAccountBalance', () => {
  test('reads only the prepared source account', async () => {
    const sourceTokenAccount = 'Ata111111111111111111111111111111111111111';
    const { calls, result } = await withRpc(
      () =>
        Response.json({
          id: '1',
          jsonrpc: '2.0',
          result: {
            value: {
              data: {
                parsed: { info: { tokenAmount: { amount: '25000000', decimals: 6 } } },
              },
            },
          },
        }),
      () => fetchTokenAccountBalance(sourceTokenAccount),
    );

    expect(result).toEqual({ amount: 25_000_000n, decimals: 6 });
    expect(calls[0]).toMatchObject({
      method: 'getAccountInfo',
      params: [sourceTokenAccount, { commitment: 'confirmed', encoding: 'jsonParsed' }],
    });
  });

  test('rejects a malformed exact-account balance', async () => {
    const attempt = withRpc(
      () => Response.json({ id: '1', jsonrpc: '2.0', result: { value: {} } }),
      () => fetchTokenAccountBalance('Ata111111111111111111111111111111111111111'),
    );

    await expect(attempt).rejects.toThrow('returned an invalid token balance');
  });

  test('treats a missing source account as a zero token balance', async () => {
    const { result } = await withRpc(
      () => Response.json({ id: '1', jsonrpc: '2.0', result: { value: null } }),
      () => fetchTokenAccountBalance('Ata111111111111111111111111111111111111111'),
    );

    expect(result).toBeNull();
  });
});

describe('fetchSignatureCommitment', () => {
  const signature = '5j7s1QzqC5S1oJ8nJ2gGkQvJ4aVn8rTz9wXyB3cD4eF6';

  function statusResponse(value: unknown) {
    return Response.json({ id: '1', jsonrpc: '2.0', result: { value: [value] } });
  }

  test('maps a known confirmation status through', async () => {
    const { calls, result } = await withRpc(
      () => statusResponse({ confirmationStatus: 'confirmed', err: null }),
      () => fetchSignatureCommitment(signature),
    );

    expect(result).toEqual({ commitment: 'confirmed', failed: false });
    expect(calls[0]?.params).toEqual([[signature], { searchTransactionHistory: true }]);
  });

  test('reports an on-chain error as failed', async () => {
    const { result } = await withRpc(
      () => statusResponse({ confirmationStatus: 'processed', err: { InstructionError: [0, {}] } }),
      () => fetchSignatureCommitment(signature),
    );

    expect(result).toEqual({ commitment: null, failed: true });
  });

  test('an unknown signature is pending, not failed', async () => {
    const { result } = await withRpc(
      () => statusResponse(null),
      () => fetchSignatureCommitment(signature),
    );

    expect(result).toEqual({ commitment: null, failed: false });
  });

  test('an unrecognised confirmationStatus is discarded instead of trusted', async () => {
    const { result } = await withRpc(
      () => statusResponse({ confirmationStatus: 'somethingElse', err: null }),
      () => fetchSignatureCommitment(signature),
    );

    expect(result).toEqual({ commitment: null, failed: false });
  });
});

describe('rpc failures', () => {
  test('a non-2xx response raises SolanaRpcError naming the method', async () => {
    const attempt = withRpc(
      () => new Response(null, { status: 503 }),
      () => fetchLamportBalance(wallet),
    );

    await expect(attempt).rejects.toThrow(/getBalance responded 503/);
  });

  test('a JSON-RPC error body carries its code through', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        error: { code: -32_602, message: 'Invalid param: WrongSize' },
        id: '1',
        jsonrpc: '2.0',
      })) as unknown as typeof fetch;
    try {
      await fetchLamportBalance('not-an-address');
      throw new Error('expected fetchLamportBalance to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(SolanaRpcError);
      expect((error as SolanaRpcError).code).toBe(-32_602);
      expect((error as SolanaRpcError).message).toBe('Invalid param: WrongSize');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('a bare error body still names the method it came from', async () => {
    // Not every provider returns message/code. The fallbacks are what keep the
    // surfaced error attributable instead of an empty string.
    const attempt = withRpc(
      () => Response.json({ error: {}, id: '1', jsonrpc: '2.0' }),
      () => fetchLamportBalance(wallet),
    );

    await expect(attempt).rejects.toThrow('Solana RPC getBalance failed.');

    const { result: code } = await withRpc(
      () => Response.json({ error: {}, id: '1', jsonrpc: '2.0' }),
      async () => {
        try {
          await fetchLamportBalance(wallet);
          return 'did-not-throw' as const;
        } catch (error) {
          return (error as SolanaRpcError).code;
        }
      },
    );

    expect(code).toBeNull();
  });

  test('a 200 with no result is an error, not a silent zero', async () => {
    const attempt = withRpc(
      () => Response.json({ id: '1', jsonrpc: '2.0' }),
      () => fetchLamportBalance(wallet),
    );

    await expect(attempt).rejects.toThrow(/returned no result/);
  });
});
