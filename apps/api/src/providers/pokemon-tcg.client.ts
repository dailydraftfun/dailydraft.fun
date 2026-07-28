import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

const API_BASE_URL = 'https://api.pokemontcg.io/v2';
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
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
  readonly #logger = new Logger(PokemonTcgClient.name);

  async getCard(cardId: string): Promise<PokemonTcgCardSnapshot> {
    const apiKey = process.env.POKEMON_TCG_API_KEY?.trim();
    return fetchCard(cardId, {
      ...(apiKey ? { apiKey } : {}),
      fetcher: fetch,
      onRetry: (event) => this.#logger.warn(JSON.stringify(event)),
      retries: resolveNonNegativeInteger(process.env.POKEMON_TCG_API_RETRIES, DEFAULT_RETRIES, 3),
      retryDelayMs: resolveNonNegativeInteger(
        process.env.POKEMON_TCG_API_RETRY_DELAY_MS,
        DEFAULT_RETRY_DELAY_MS,
        5_000,
      ),
      timeoutMs: resolvePositiveInteger(
        process.env.POKEMON_TCG_API_TIMEOUT_MS,
        DEFAULT_REQUEST_TIMEOUT_MS,
        60_000,
      ),
    });
  }

  async getCards(cardIds: readonly string[]): Promise<readonly PokemonTcgCardSnapshot[]> {
    const apiKey = process.env.POKEMON_TCG_API_KEY?.trim();
    return fetchCards(cardIds, {
      ...(apiKey ? { apiKey } : {}),
      fetcher: fetch,
      onRetry: (event) => this.#logger.warn(JSON.stringify(event)),
      retries: resolveNonNegativeInteger(process.env.POKEMON_TCG_API_RETRIES, DEFAULT_RETRIES, 3),
      retryDelayMs: resolveNonNegativeInteger(
        process.env.POKEMON_TCG_API_RETRY_DELAY_MS,
        DEFAULT_RETRY_DELAY_MS,
        5_000,
      ),
      timeoutMs: resolvePositiveInteger(
        process.env.POKEMON_TCG_API_TIMEOUT_MS,
        DEFAULT_REQUEST_TIMEOUT_MS,
        60_000,
      ),
    });
  }
}

interface FetchCardOptions {
  apiKey?: string;
  fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  onRetry?: (event: {
    attempt: number;
    event: 'pokemon_tcg_request_retry';
    failure: string;
    maxAttempts: number;
  }) => void;
  retries: number;
  retryDelayMs: number;
  timeoutMs: number;
}

export async function fetchCard(
  cardId: string,
  options: FetchCardOptions,
): Promise<PokemonTcgCardSnapshot> {
  validateCardIds([cardId]);
  const value = await fetchJson(
    `${API_BASE_URL}/cards/${encodeURIComponent(cardId)}?select=id,name,images,tcgplayer`,
    options,
  );
  return parseCard(value);
}

export async function fetchCards(
  cardIdsInput: readonly string[],
  options: FetchCardOptions,
): Promise<readonly PokemonTcgCardSnapshot[]> {
  const cardIds = validateCardIds(cardIdsInput);
  const firstCardId = cardIds[0];
  if (!firstCardId) throw new BadGatewayException('Pokémon TCG card batch size is invalid');
  const setId = cardSetId(firstCardId);
  if (cardIds.some((cardId) => cardSetId(cardId) !== setId)) {
    throw new BadGatewayException('Pokémon TCG card batch must use one set');
  }
  const query = new URLSearchParams({
    pageSize: '250',
    q: `set.id:${setId}`,
    select: 'id,name,images,tcgplayer',
  });
  const value = await fetchJson(`${API_BASE_URL}/cards?${query.toString()}`, options);
  return parseCards(value, cardIds);
}

async function fetchJson(url: string, options: FetchCardOptions): Promise<unknown> {
  const maxAttempts = options.retries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await options.fetcher(url, {
        headers: {
          accept: 'application/json',
          ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new PokemonTcgHttpError(response.status);
      }
      return response.json();
    } catch (error) {
      if (!isRetryable(error) || attempt === maxAttempts) {
        throw toBadGatewayException(error);
      }
      options.onRetry?.({
        attempt,
        event: 'pokemon_tcg_request_retry',
        failure: retryFailure(error),
        maxAttempts,
      });
      await wait(options.retryDelayMs * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new BadGatewayException('Pokémon TCG API is unavailable');
}

export function parseCards(
  value: unknown,
  expectedCardIds: readonly string[],
): readonly PokemonTcgCardSnapshot[] {
  if (!isObject(value) || !Array.isArray(value.data)) {
    throw new BadGatewayException('Pokémon TCG API returned an invalid card batch');
  }
  const expected = new Set(expectedCardIds);
  const cards = new Map<string, PokemonTcgCardSnapshot>();
  for (const candidate of value.data) {
    if (!isObject(candidate) || typeof candidate.id !== 'string' || !expected.has(candidate.id)) {
      continue;
    }
    if (cards.has(candidate.id)) {
      throw new BadGatewayException('Pokémon TCG API returned a duplicate card');
    }
    cards.set(candidate.id, parseCard({ data: candidate }));
  }
  return expectedCardIds.map((cardId) => {
    const card = cards.get(cardId);
    if (!card) throw new BadGatewayException(`Pokémon TCG API omitted card ${cardId}`);
    return card;
  });
}

class PokemonTcgHttpError extends Error {
  constructor(readonly status: number) {
    super(`Pokémon TCG API returned ${status}`);
    this.name = 'PokemonTcgHttpError';
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof BadGatewayException) return false;
  if (error instanceof PokemonTcgHttpError) return TRANSIENT_HTTP_STATUSES.has(error.status);
  return true;
}

function retryFailure(error: unknown): string {
  if (error instanceof PokemonTcgHttpError) return `http_${error.status}`;
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout';
  return 'network';
}

function toBadGatewayException(error: unknown): BadGatewayException {
  if (error instanceof BadGatewayException) return error;
  if (error instanceof PokemonTcgHttpError) {
    return new BadGatewayException(`Pokémon TCG API returned ${error.status}`);
  }
  return new BadGatewayException('Pokémon TCG API is unavailable');
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

function validateCardIds(cardIds: readonly string[]): readonly string[] {
  if (cardIds.length < 1 || cardIds.length > 250) {
    throw new BadGatewayException('Pokémon TCG card batch size is invalid');
  }
  const unique = new Set<string>();
  for (const cardId of cardIds) {
    if (!/^[A-Za-z0-9-]{2,32}$/.test(cardId)) {
      throw new BadGatewayException('Pokémon TCG card ID is invalid');
    }
    if (unique.has(cardId)) {
      throw new BadGatewayException('Pokémon TCG card batch contains a duplicate ID');
    }
    unique.add(cardId);
  }
  return [...unique];
}

function cardSetId(cardId: string): string {
  const separator = cardId.lastIndexOf('-');
  if (separator < 1 || separator === cardId.length - 1) {
    throw new BadGatewayException('Pokémon TCG card ID has no canonical set');
  }
  return cardId.slice(0, separator);
}

function resolvePositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function resolveNonNegativeInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
