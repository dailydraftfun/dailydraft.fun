import { describe, expect, test } from 'bun:test';

import { fetchCard, parseCard } from './pokemon-tcg.client.js';

describe('Pokémon TCG card snapshots', () => {
  test('converts the authoritative USD market price to exact USDC micro-units', () => {
    expect(parseCard(card())).toEqual({
      cardId: 'base1-4',
      displayName: 'Charizard',
      imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
      marketValueMicroUsdc: '773510000',
      priceVariant: 'holofoil',
      priceUpdatedAt: '2026-07-15T00:00:00.000Z',
      sourceTimestamp: new Date('2026-07-15T00:00:00.000Z'),
    });
  });

  test('rejects missing market prices and noncanonical image hosts', () => {
    const missingPrice = card();
    missingPrice.data.tcgplayer.prices = {};
    expect(() => parseCard(missingPrice)).toThrow('no positive USD market price');

    const wrongImage = card();
    wrongImage.data.images.large = 'https://example.com/fake.png';
    expect(() => parseCard(wrongImage)).toThrow('lacks canonical market data');

    const unknownVariant = card();
    unknownVariant.data.tcgplayer.prices = { unlimitedHolofoil: { market: 10 } };
    expect(() => parseCard(unknownVariant)).toThrow('no positive USD market price');
  });
});

describe('Pokémon TCG requests', () => {
  test('retries after the per-attempt deadline expires', async () => {
    let requests = 0;
    const retries: unknown[] = [];

    const result = await fetchCard('base1-4', {
      fetcher: async (_input, init) => {
        requests += 1;
        if (requests > 1) return Response.json(card(), { status: 200 });
        if (!init?.signal) throw new Error('Expected an abort signal');
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      },
      onRetry: (event) => retries.push(event),
      retries: 1,
      retryDelayMs: 0,
      timeoutMs: 1,
    });

    expect(result.cardId).toBe('base1-4');
    expect(requests).toBe(2);
    expect(retries).toEqual([
      {
        attempt: 1,
        event: 'pokemon_tcg_request_retry',
        failure: 'timeout',
        maxAttempts: 2,
      },
    ]);
  });

  test('retries a transient provider failure before accepting a canonical card', async () => {
    let requests = 0;
    const retries: unknown[] = [];

    const result = await fetchCard('base1-4', {
      fetcher: async () => {
        requests += 1;
        return requests === 1
          ? new Response(null, { status: 503 })
          : Response.json(card(), { status: 200 });
      },
      onRetry: (event) => retries.push(event),
      retries: 1,
      retryDelayMs: 0,
      timeoutMs: 20_000,
    });

    expect(result.cardId).toBe('base1-4');
    expect(requests).toBe(2);
    expect(retries).toEqual([
      {
        attempt: 1,
        event: 'pokemon_tcg_request_retry',
        failure: 'http_503',
        maxAttempts: 2,
      },
    ]);
  });

  test('does not retry a non-transient response', async () => {
    let requests = 0;

    await expect(
      fetchCard('base1-4', {
        fetcher: async () => {
          requests += 1;
          return new Response(null, { status: 404 });
        },
        retries: 2,
        retryDelayMs: 0,
        timeoutMs: 20_000,
      }),
    ).rejects.toThrow('Pokémon TCG API returned 404');

    expect(requests).toBe(1);
  });
});

function card(): {
  data: {
    id: string;
    images: { large: string };
    name: string;
    tcgplayer: { prices: Record<string, { market: number }>; updatedAt: string };
  };
} {
  return {
    data: {
      id: 'base1-4',
      images: { large: 'https://images.pokemontcg.io/base1/4_hires.png' },
      name: 'Charizard',
      tcgplayer: {
        prices: { holofoil: { market: 773.51 } },
        updatedAt: '2026/07/15',
      },
    },
  };
}
