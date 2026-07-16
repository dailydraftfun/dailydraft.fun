import { BadGatewayException, Injectable } from '@nestjs/common';

const API_BASE_URL = 'https://api.pokemontcg.io/v2';
const REQUEST_TIMEOUT_MS = 8_000;
const PRICE_VARIANTS = ['holofoil', 'reverseHolofoil', 'normal', '1stEditionHolofoil'] as const;

export interface PokemonTcgCardSnapshot {
  cardId: string;
  displayName: string;
  imageUrl: string;
  marketValueMicroUsdc: string;
  priceVariant: (typeof PRICE_VARIANTS)[number];
  priceUpdatedAt: string;
  sourceTimestamp: Date;
}

@Injectable()
export class PokemonTcgClient {
  async getCard(cardId: string): Promise<PokemonTcgCardSnapshot> {
    if (!/^[A-Za-z0-9-]{2,32}$/.test(cardId)) {
      throw new BadGatewayException('Pokémon TCG card ID is invalid');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const apiKey = process.env.POKEMON_TCG_API_KEY?.trim();
      const response = await fetch(
        `${API_BASE_URL}/cards/${encodeURIComponent(cardId)}?select=id,name,images,tcgplayer`,
        {
          headers: apiKey ? { 'x-api-key': apiKey } : undefined,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new BadGatewayException(`Pokémon TCG API returned ${response.status}`);
      }
      return parseCard(await response.json());
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('Pokémon TCG API is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseCard(value: unknown): PokemonTcgCardSnapshot {
  if (!isObject(value) || !isObject(value.data)) {
    throw new BadGatewayException('Pokémon TCG API returned an invalid card');
  }
  const card = value.data;
  if (
    typeof card.id !== 'string' ||
    !/^[A-Za-z0-9-]{2,32}$/.test(card.id) ||
    typeof card.name !== 'string' ||
    card.name.length < 1 ||
    card.name.length > 120 ||
    !isObject(card.images) ||
    typeof card.images.large !== 'string' ||
    !isPokemonImageUrl(card.images.large) ||
    !isObject(card.tcgplayer) ||
    typeof card.tcgplayer.updatedAt !== 'string' ||
    !/^\d{4}\/\d{2}\/\d{2}$/.test(card.tcgplayer.updatedAt) ||
    !isObject(card.tcgplayer.prices)
  ) {
    throw new BadGatewayException('Pokémon TCG card lacks canonical market data');
  }
  const market = selectMarketPrice(card.tcgplayer.prices);
  const priceUpdatedAt = canonicalPriceUpdatedAt(card.tcgplayer.updatedAt);
  return {
    cardId: card.id,
    displayName: card.name,
    imageUrl: card.images.large,
    marketValueMicroUsdc: decimalDollarsToMicroUsdc(market.value),
    priceVariant: market.variant,
    priceUpdatedAt,
    sourceTimestamp: new Date(priceUpdatedAt),
  };
}

function selectMarketPrice(prices: Record<string, unknown>): {
  value: number;
  variant: (typeof PRICE_VARIANTS)[number];
} {
  for (const variant of PRICE_VARIANTS) {
    const price = prices[variant];
    if (isObject(price) && typeof price.market === 'number' && price.market > 0) {
      return { value: price.market, variant };
    }
  }
  throw new BadGatewayException('Pokémon TCG card has no positive USD market price');
}

function canonicalPriceUpdatedAt(value: string): string {
  const [year, month, day] = value.split('/').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new BadGatewayException('Pokémon TCG price update date is invalid');
  }
  return date.toISOString();
}

function decimalDollarsToMicroUsdc(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
    throw new BadGatewayException('Pokémon TCG market price is outside demo bounds');
  }
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-7) {
    throw new BadGatewayException('Pokémon TCG market price has unsupported precision');
  }
  return (BigInt(cents) * 10_000n).toString();
}

function isPokemonImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'images.pokemontcg.io';
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
