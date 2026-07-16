import { describe, expect, test } from 'bun:test';

import { parseCard } from './pokemon-tcg.client.js';

describe('Pokémon TCG card snapshots', () => {
  test('converts the authoritative USD market price to exact USDC micro-units', () => {
    const observedAt = new Date('2026-07-16T00:16:35.000Z');
    expect(parseCard(card(), observedAt)).toEqual({
      cardId: 'base1-4',
      displayName: 'Charizard',
      imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
      marketValueMicroUsdc: '773510000',
      priceUpdatedAt: '2026/07/15',
      sourceTimestamp: observedAt,
    });
  });

  test('rejects missing market prices and noncanonical image hosts', () => {
    const missingPrice = card();
    missingPrice.data.tcgplayer.prices = {};
    expect(() => parseCard(missingPrice, new Date())).toThrow('no positive USD market price');

    const wrongImage = card();
    wrongImage.data.images.large = 'https://example.com/fake.png';
    expect(() => parseCard(wrongImage, new Date())).toThrow('lacks canonical market data');
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
