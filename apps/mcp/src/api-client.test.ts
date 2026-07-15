import { describe, expect, test } from 'bun:test';

import { OpenPacksApiClient, OpenPacksApiError } from './api-client.js';

const pack = {
  active: true,
  id: 'pokemon_50',
  name: 'Pokemon $50',
  price: { amount: '50000000', currency: 'USDC', decimals: 6 },
  provider: 'preview',
};

describe('OpenPacksApiClient', () => {
  test('encodes filters and authenticates without exposing the key', async () => {
    let request: Request | undefined;
    const client = new OpenPacksApiClient({
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
    const client = new OpenPacksApiClient({
      baseUrl: 'https://api.example.test/v1',
      fetch: async () =>
        Response.json(
          { detail: 'Duel does not exist', requestId: 'req_123', title: 'Not found' },
          { status: 404 },
        ),
    });

    const error = await client.getDuel('duel_missing').catch((value: unknown) => value);

    expect(error).toBeInstanceOf(OpenPacksApiError);
    expect(error).toMatchObject({ requestId: 'req_123', status: 404 });
  });

  test('rejects API responses that drift from the contract', async () => {
    const client = new OpenPacksApiClient({
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({ data: [{ ...pack, price: 50 }], hasMore: false }),
    });

    const error = await client.listPacks().catch((value: unknown) => value);

    expect(error).toMatchObject({ status: 502 });
  });

  test('prepares an unsigned transaction with an idempotency key', async () => {
    let request: Request | undefined;
    const client = new OpenPacksApiClient({
      apiKey: 'opd_test_secret',
      baseUrl: 'https://api.example.test/v1',
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({
          action: 'fund',
          encoding: 'base64',
          expiresAt: '2026-07-15T23:00:00.000Z',
          summary: 'Fund the devnet escrow fee deposit.',
          transaction: 'AQIDBA==',
        });
      },
    });

    const result = await client.prepareTransaction({
      action: 'fund',
      duelId: 'duel_123456789abc',
      idempotencyKey: 'mcp:test:fund:1234',
      wallet: '11111111111111111111111111111111',
    });

    expect(result.encoding).toBe('base64');
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
    const errorClient = new OpenPacksApiClient({
      apiKey,
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({ detail: `Do not leak ${apiKey}` }, { status: 502 }),
    });

    const upstreamError = await errorClient.getPack('pokemon_50').catch((value: unknown) => value);

    expect(String(upstreamError)).not.toContain(apiKey);

    const outputClient = new OpenPacksApiClient({
      apiKey,
      baseUrl: 'https://api.example.test/v1',
      fetch: async () => Response.json({ ...pack, name: apiKey }),
    });
    const outputError = await outputClient.getPack('pokemon_50').catch((value: unknown) => value);

    expect(outputError).toMatchObject({ status: 502 });
    expect(String(outputError)).not.toContain(apiKey);
  });

  test('requires an explicit API URL and reports upstream credential availability', () => {
    expect(() => new OpenPacksApiClient({ baseUrl: '' })).toThrow(
      'OPENPACKSDUEL_API_URL is required',
    );
    expect(
      new OpenPacksApiClient({
        apiKey: 'configured',
        baseUrl: 'https://api.example.test/v1',
      }).hasIntegrationCredential,
    ).toBe(true);
    expect(
      new OpenPacksApiClient({ baseUrl: 'https://api.example.test/v1' }).hasIntegrationCredential,
    ).toBe(false);
  });
});
