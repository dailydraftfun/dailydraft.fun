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
});
