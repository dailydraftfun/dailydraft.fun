import { describe, expect, test } from 'bun:test';

import {
  parseFinalizedAddressSignature,
  parseLegacyTokenAccount,
  requestSolanaRpc,
  resolveSolanaRpcRequestPolicy,
  SolanaRpcUnavailableError,
} from './solana-rpc.client.js';

const RPC_URL = 'https://rpc.example.test';

describe('Solana RPC transport faults', () => {
  test('aborts every hung attempt and stops at the configured retry bound', async () => {
    let requests = 0;
    const delays: number[] = [];

    await expect(
      requestSolanaRpc('getBlockHeight', [], {
        delay: async (milliseconds) => {
          delays.push(milliseconds);
        },
        fetcher: async (_input, init) => {
          requests += 1;
          if (!init?.signal) throw new Error('Expected an abort signal');
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Request aborted', 'AbortError')),
              { once: true },
            );
          });
        },
        retries: 2,
        rpcUrl: RPC_URL,
        timeoutMs: 1,
      }),
    ).rejects.toThrow('getBlockHeight');

    expect(requests).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  test('retries HTTP, JSON-RPC, and malformed failures before returning a later result', async () => {
    const responses = [
      new Response(null, { status: 429 }),
      new Response(null, { status: 503 }),
      Response.json({ error: { code: -32_000, message: 'upstream unavailable' }, id: 1 }),
      Response.json({ id: 1, jsonrpc: '2.0' }),
      Response.json({ id: 1, jsonrpc: '2.0', result: 123 }),
    ];
    const delays: number[] = [];
    let requests = 0;

    const result = await requestSolanaRpc('getBlockHeight', [], {
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
      fetcher: async () => {
        const response = responses[requests];
        requests += 1;
        if (!response) throw new Error('Unexpected extra request');
        return response;
      },
      retries: 4,
      rpcUrl: RPC_URL,
      timeoutMs: 20_000,
    });

    expect(result).toBe(123);
    expect(requests).toBe(5);
    expect(delays).toEqual([100, 200, 300, 400]);
  });

  test('redacts transaction payloads when all attempts are exhausted', async () => {
    const serializedTransaction = 'sensitive-serialized-transaction';
    let requests = 0;

    let failure: unknown;
    try {
      await requestSolanaRpc('sendTransaction', [serializedTransaction], {
        delay: async () => {},
        fetcher: async () => {
          requests += 1;
          return Response.json({ error: { code: -32_000, data: serializedTransaction }, id: 1 });
        },
        retries: 1,
        rpcUrl: RPC_URL,
        timeoutMs: 20_000,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SolanaRpcUnavailableError);
    expect((failure as Error).message).toContain('sendTransaction');
    expect((failure as Error).message).not.toContain(serializedTransaction);
    expect(requests).toBe(2);
  });
});

describe('Solana RPC request policy', () => {
  test('clamps configured timeout and retry counts to documented bounds', () => {
    expect(resolveSolanaRpcRequestPolicy({})).toEqual({ retries: 2, timeoutMs: 5_000 });
    expect(
      resolveSolanaRpcRequestPolicy({
        SOLANA_RPC_RETRIES: '99',
        SOLANA_RPC_TIMEOUT_MS: '60000',
      }),
    ).toEqual({ retries: 4, timeoutMs: 30_000 });
    expect(
      resolveSolanaRpcRequestPolicy({
        SOLANA_RPC_RETRIES: '0',
        SOLANA_RPC_TIMEOUT_MS: '1',
      }),
    ).toEqual({ retries: 0, timeoutMs: 1 });
  });

  test.each([
    { SOLANA_RPC_RETRIES: '-1', SOLANA_RPC_TIMEOUT_MS: '0' },
    { SOLANA_RPC_RETRIES: '1.5', SOLANA_RPC_TIMEOUT_MS: '12.5' },
    { SOLANA_RPC_RETRIES: '2retries', SOLANA_RPC_TIMEOUT_MS: '5000ms' },
  ])('defaults invalid request policy values', (environment) => {
    expect(resolveSolanaRpcRequestPolicy(environment)).toEqual({
      retries: 2,
      timeoutMs: 5_000,
    });
  });
});

describe('finalized signature parsing', () => {
  test('preserves failed signatures so recovery can detect a truncated raw page', () => {
    expect(
      parseFinalizedAddressSignature({
        blockTime: 1_784_155_260,
        confirmationStatus: 'finalized',
        err: { InstructionError: [0, 'Custom'] },
        signature: '4'.repeat(88),
      }),
    ).toEqual([
      {
        blockTime: 1_784_155_260,
        confirmationStatus: 'finalized',
        signature: '4'.repeat(88),
      },
    ]);
  });
});

describe('legacy SPL token-account parsing', () => {
  test('accepts an exactly initialized finalized account payload', () => {
    expect(parseLegacyTokenAccount(parsedAccount('initialized'))).toEqual({
      amount: 1n,
      delegate: null,
      delegatedAmount: 0n,
      mint: 'mint',
      owner: 'owner',
    });
  });

  test('rejects frozen, uninitialized, and missing account states', () => {
    for (const state of ['frozen', 'uninitialized', undefined]) {
      expect(() => parseLegacyTokenAccount(parsedAccount(state))).toThrow(
        SolanaRpcUnavailableError,
      );
    }
  });
});

function parsedAccount(state: string | undefined): { info: Record<string, unknown>; type: string } {
  return {
    info: {
      mint: 'mint',
      owner: 'owner',
      ...(state ? { state } : {}),
      tokenAmount: { amount: '1' },
    },
    type: 'account',
  };
}
