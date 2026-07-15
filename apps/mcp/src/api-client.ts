import type * as z from 'zod/v4';

import {
  type Duel,
  type DuelList,
  duelListSchema,
  duelSchema,
  type Pack,
  type PackList,
  packListSchema,
  packSchema,
  type SocialCard,
  socialCardSchema,
} from './schemas.js';

const DEFAULT_BASE_URL = 'https://api.openpacksduel.com/v1';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ApiClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface PackListInput {
  active?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

interface DuelListInput {
  cursor?: string | undefined;
  limit?: number | undefined;
  status?: string | undefined;
  wallet?: string | undefined;
}

export class OpenPacksApiError extends Error {
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = 'OpenPacksApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

export class OpenPacksApiClient {
  readonly #apiKey: string | undefined;
  readonly #baseUrl: URL;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(options: ApiClientOptions = {}) {
    const baseUrl = options.baseUrl ?? process.env.OPENPACKSDUEL_API_URL ?? DEFAULT_BASE_URL;
    this.#baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    this.#apiKey = options.apiKey ?? process.env.OPENPACKSDUEL_API_KEY;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  listPacks(input: PackListInput = {}): Promise<PackList> {
    return this.#get('packs', packListSchema, input);
  }

  getPack(packId: string): Promise<Pack> {
    return this.#get(`packs/${encodeURIComponent(packId)}`, packSchema);
  }

  listDuels(input: DuelListInput = {}): Promise<DuelList> {
    return this.#get('duels', duelListSchema, input);
  }

  getDuel(duelId: string): Promise<Duel> {
    return this.#get(`duels/${encodeURIComponent(duelId)}`, duelSchema);
  }

  getDuelSocialCard(duelId: string): Promise<SocialCard> {
    return this.#get(`duels/${encodeURIComponent(duelId)}/social-card`, socialCardSchema);
  }

  async #get<T>(path: string, schema: z.ZodType<T>, query: object = {}): Promise<T> {
    const url = new URL(path, this.#baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers({ accept: 'application/json' });
    if (this.#apiKey) headers.set('authorization', `Bearer ${this.#apiKey}`);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers,
        method: 'GET',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw new OpenPacksApiError(`OpenPacks Duel API request failed: ${message}`, 0);
    }

    if (!response.ok) {
      const problem = await readProblem(response);
      throw new OpenPacksApiError(
        problem.detail ?? problem.title ?? `OpenPacks Duel API returned ${response.status}`,
        response.status,
        problem.requestId,
      );
    }

    const body: unknown = await response.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new OpenPacksApiError('OpenPacks Duel API returned an invalid response', 502);
    }
    return parsed.data;
  }
}

async function readProblem(response: Response): Promise<{
  detail?: string;
  requestId?: string;
  title?: string;
}> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    return {
      ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
      ...(typeof record.requestId === 'string' ? { requestId: record.requestId } : {}),
      ...(typeof record.title === 'string' ? { title: record.title } : {}),
    };
  } catch {
    return {};
  }
}
