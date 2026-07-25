import { afterEach, describe, expect, test } from 'bun:test';

import { DailyDraftApiClient, DailyDraftApiError } from './api-client.js';

const pack = {
  active: true,
  id: 'pokemon_50',
  name: 'Pokemon $50',
  price: { amount: '50000000', currency: 'USDC', decimals: 6 },
  provider: 'preview',
};

const prepareInput = {
  action: 'fund',
  duelId: 'duel_123456789abc',
  idempotencyKey: 'mcp:test:fund:1234',
  wallet: '11111111111111111111111111111111',
} as const;

const originalApiUrl = process.env.DAILYDRAFT_API_URL;

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.DAILYDRAFT_API_URL;
  else process.env.DAILYDRAFT_API_URL = originalApiUrl;
});

describe('DailyDraftApiClient', () => {
  test('encodes filters and authenticates without exposing the key', async () => {
    let request: Request | undefined;
    const client = new DailyDraftApiClient({
      apiKey: 'opd_test_secret',
      baseUrl: 'https://api.example.test/v1',
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ data: [pack], hasMore: false });
      },
    });

    const result = await client.listPacks({ active: true, limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(request?.url).toBe('https://api.example.test/v1/packs?active=true&limit=10');
    expect(request?.headers.get('authorization')).toBe('Bearer opd_test_secret');
  });

  test('returns a bounded API error with request correlation', async () => {
    const client = new DailyDraftApiClient({
      baseUrl: 'https://api.example.test/v1',
      fetch: async () =>
        Response.json(
          { detail: 'Duel does not exist', requestId: 'req_123', title: 'Not found' },
          { status: 404 },
        ),
    });

    const error = await client.getDuel('duel_missing').catch((value: unknown) => value);

    expect(error).toBeInstanceOf(DailyDraftApiError);
    expect(error).toMatchObject({ requestId: 'req_123', status: 404 });
  });

  test('rejects API responses that drift from the contract', async () => {
    const client = new DailyDraftApiClient({
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({ data: [{ ...pack, price: 50 }], hasMore: false }),
    });

    const error = await client.listPacks().catch((value: unknown) => value);

    expect(error).toMatchObject({ status: 502 });
  });

  test('prepares an unsigned transaction with an idempotency key', async () => {
    let request: Request | undefined;
    const client = new DailyDraftApiClient({
      apiKey: 'opd_test_secret',
      baseUrl: 'https://api.example.test/v1',
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({
          action: 'fund',
          chain: 'solana:devnet',
          cluster: 'devnet',
          duelId: 'duel_123456789abc',
          escrowAddress: 'Escrow111111111111111111111111111111111',
          expiresAt: '2026-07-15T23:00:00.000Z',
          feeAmountLamports: '1000000',
          feeAmountSol: '0.001',
          feeRecipient: 'Fee1111111111111111111111111111111111111',
          fundingSide: 'creator',
          id: 'tx_123456789abc',
          lastValidBlockHeight: '12345',
          paymentMint: 'So11111111111111111111111111111111111111112',
          programId: 'Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS',
          recentBlockhash: '11111111111111111111111111111111',
          serializedTransactionBase64: 'AQIDBA==',
          status: 'prepared',
          wallet: '11111111111111111111111111111111',
          warnings: ['Pack purchase is not included.'],
        });
      },
    });

    const result = await client.prepareTransaction({
      action: 'fund',
      duelId: 'duel_123456789abc',
      idempotencyKey: 'mcp:test:fund:1234',
      wallet: '11111111111111111111111111111111',
    });

    expect(result.serializedTransactionBase64).toBe('AQIDBA==');
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('authorization')).toBe('Bearer opd_test_secret');
    expect(request?.headers.get('idempotency-key')).toBe('mcp:test:fund:1234');
    expect(await request?.json()).toEqual({
      action: 'fund',
      wallet: '11111111111111111111111111111111',
    });
  });

  test('redacts the upstream key from errors and rejects it in successful output', async () => {
    const apiKey = 'opd_server_only_12345678901234567890';
    const errorClient = new DailyDraftApiClient({
      apiKey,
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({ detail: `Do not leak ${apiKey}` }, { status: 502 }),
    });

    const upstreamError = await errorClient.getPack('pokemon_50').catch((value: unknown) => value);

    expect(String(upstreamError)).not.toContain(apiKey);

    const outputClient = new DailyDraftApiClient({
      apiKey,
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({ ...pack, name: apiKey }),
    });
    const outputError = await outputClient.getPack('pokemon_50').catch((value: unknown) => value);

    expect(outputError).toMatchObject({ status: 502 });
    expect(String(outputError)).not.toContain(apiKey);
  });

  test('requires an explicit API URL and reports upstream credential availability', () => {
    expect(() => new DailyDraftApiClient({ baseUrl: '' })).toThrow(
      'DAILYDRAFT_API_URL is required',
    );
    expect(
      new DailyDraftApiClient({
        apiKey: 'configured',
        baseUrl: 'https://api.example.test/v1',
      }).hasIntegrationCredential,
    ).toBe(true);
    expect(
      new DailyDraftApiClient({ baseUrl: 'https://api.example.test/v1' }).hasIntegrationCredential,
    ).toBe(false);
  });

  test('refuses base URLs that are not plain HTTP(S) endpoints', () => {
    const expected = 'DAILYDRAFT_API_URL must be an HTTP(S) URL without embedded credentials';

    expect(() => new DailyDraftApiClient({ baseUrl: 'ftp://api.example.test/v1' })).toThrow(
      expected,
    );
    expect(
      () => new DailyDraftApiClient({ baseUrl: 'https://user:secret@api.example.test/v1' }),
    ).toThrow(expected);
  });

  test('falls back to the environment when no base URL is supplied', async () => {
    process.env.DAILYDRAFT_API_URL = 'https://api.env.test/v1';
    let request: Request | undefined;
    const client = new DailyDraftApiClient({
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ data: [pack], hasMore: false });
      },
    });

    await client.listPacks();

    expect(request?.url).toBe('https://api.env.test/v1/packs');
  });

  test('surfaces transport failures as status-zero errors on reads and writes', async () => {
    const client = new DailyDraftApiClient({
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => {
        throw new Error('socket hang up');
      },
    });

    const readError = await client.listPacks().catch((value: unknown) => value);
    const writeError = await client
      .prepareTransaction(prepareInput)
      .catch((value: unknown) => value);

    expect(readError).toBeInstanceOf(DailyDraftApiError);
    expect(readError).toMatchObject({ status: 0 });
    expect(String(readError)).toContain('socket hang up');
    expect(writeError).toMatchObject({ status: 0 });
    expect(String(writeError)).toContain('socket hang up');
  });

  test('falls back to the status line when a problem document carries no text', async () => {
    const readClient = new DailyDraftApiClient({
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({}, { status: 500 }),
    });
    const writeClient = new DailyDraftApiClient({
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({}, { status: 409 }),
    });

    const readError = await readClient.listPacks().catch((value: unknown) => value);
    const writeError = await writeClient
      .prepareTransaction(prepareInput)
      .catch((value: unknown) => value);

    expect(readError).toMatchObject({ status: 500 });
    expect((readError as DailyDraftApiError).requestId).toBeUndefined();
    expect(String(readError)).toContain('DailyDraft API returned 500');
    expect(writeError).toMatchObject({ status: 409 });
    expect((writeError as DailyDraftApiError).requestId).toBeUndefined();
    expect(String(writeError)).toContain('DailyDraft API returned 409');
  });

  test('rejects prepared transactions that leak the key or drift from the contract', async () => {
    const apiKey = 'opd_server_only_12345678901234567890';
    const leakingClient = new DailyDraftApiClient({
      apiKey,
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({ escrowAddress: apiKey }),
    });
    const driftingClient = new DailyDraftApiClient({
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({ status: 'prepared' }),
    });

    const leakError = await leakingClient
      .prepareTransaction(prepareInput)
      .catch((value: unknown) => value);
    const driftError = await driftingClient
      .prepareTransaction(prepareInput)
      .catch((value: unknown) => value);

    expect(leakError).toMatchObject({ status: 502 });
    expect(String(leakError)).toContain('server-only credential');
    expect(String(leakError)).not.toContain(apiKey);
    expect(driftError).toMatchObject({ status: 502 });
    expect(String(driftError)).toContain('invalid response');
  });
});
