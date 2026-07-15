import type * as z from 'zod/v4';

import {
  type Duel,
  type DuelList,
  type DuelProof,
  duelListSchema,
  duelProofSchema,
  duelSchema,
  type Pack,
  type PackList,
  type PreparedTransaction,
  packListSchema,
  packSchema,
  preparedTransactionSchema,
  type SocialCard,
  socialCardSchema,
} from './schemas.js';

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
  matchmakingMode?: string | undefined;
  packId?: string | undefined;
}

export interface PrepareTransactionInput {
  action: 'fund';
  duelId: string;
  idempotencyKey: string;
  wallet: string;
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
    const baseUrl = options.baseUrl ?? process.env.OPENPACKSDUEL_API_URL;
    if (!baseUrl) throw new Error('OPENPACKSDUEL_API_URL is required');
    this.#baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (
      (this.#baseUrl.protocol !== 'https:' && this.#baseUrl.protocol !== 'http:') ||
      this.#baseUrl.username ||
      this.#baseUrl.password
    ) {
      throw new Error('OPENPACKSDUEL_API_URL must be an HTTP(S) URL without embedded credentials');
    }
    this.#apiKey = options.apiKey ?? process.env.OPENPACKSDUEL_API_KEY;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get hasIntegrationCredential(): boolean {
    return Boolean(this.#apiKey);
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

  async getDuelProof(duelId: string): Promise<DuelProof> {
    const duel = await this.getDuel(duelId);
    return duelProofSchema.parse({
      duelId: duel.id,
      environment: duel.environment,
      escrowAddress: duel.escrowAddress ?? null,
      providerMode: duel.providerMode,
      poolVersion: duel.result?.outcomes[0]?.poolVersion ?? null,
      resultHash: duel.result?.resultHash ?? null,
      settlementReady: duel.result?.settlementReady ?? false,
      status: duel.status,
      transactionSignature: duel.transactionSignature ?? null,
      tieRule: duel.result?.tieRule ?? null,
      valuationPolicyHash: duel.result?.valuationPolicyHash ?? null,
      verification: {
        apiStateIsOnChainProof: false,
        mockAssetsHaveValue: false,
        verifyOnSolana: Boolean(duel.escrowAddress || duel.transactionSignature),
      },
      winnerWallet: duel.winnerWallet ?? null,
    });
  }

  prepareTransaction(input: PrepareTransactionInput): Promise<PreparedTransaction> {
    return this.#post(
      `duels/${encodeURIComponent(input.duelId)}/transactions`,
      preparedTransactionSchema,
      { action: input.action, wallet: input.wallet },
      input.idempotencyKey,
    );
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
      throw this.#error(`OpenPacks Duel API request failed: ${message}`, 0);
    }

    if (!response.ok) {
      const problem = await readProblem(response);
      throw this.#error(
        problem.detail ?? problem.title ?? `OpenPacks Duel API returned ${response.status}`,
        response.status,
        problem.requestId,
      );
    }

    const body: unknown = await response.json();
    if (containsSecret(body, this.#apiKey)) {
      throw this.#error('OpenPacks Duel API response contained a server-only credential', 502);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw this.#error('OpenPacks Duel API returned an invalid response', 502);
    }
    return parsed.data;
  }

  async #post<T>(
    path: string,
    schema: z.ZodType<T>,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<T> {
    const url = new URL(path, this.#baseUrl);
    const headers = new Headers({
      accept: 'application/json',
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    });
    if (this.#apiKey) headers.set('authorization', `Bearer ${this.#apiKey}`);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        body: JSON.stringify(body),
        headers,
        method: 'POST',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw this.#error(`OpenPacks Duel API request failed: ${message}`, 0);
    }

    if (!response.ok) {
      const problem = await readProblem(response);
      throw this.#error(
        problem.detail ?? problem.title ?? `OpenPacks Duel API returned ${response.status}`,
        response.status,
        problem.requestId,
      );
    }

    const value: unknown = await response.json();
    if (containsSecret(value, this.#apiKey)) {
      throw this.#error('OpenPacks Duel API response contained a server-only credential', 502);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw this.#error('OpenPacks Duel API returned an invalid response', 502);
    }
    return parsed.data;
  }

  #error(message: string, status: number, requestId?: string): OpenPacksApiError {
    return new OpenPacksApiError(
      redact(message, this.#apiKey),
      status,
      requestId ? redact(requestId, this.#apiKey) : undefined,
    );
  }
}

function redact(value: string, secret: string | undefined): string {
  return secret ? value.replaceAll(secret, '[redacted]') : value;
}

function containsSecret(value: unknown, secret: string | undefined): boolean {
  if (!secret) return false;
  if (typeof value === 'string') return value.includes(secret);
  if (Array.isArray(value)) return value.some((entry) => containsSecret(entry, secret));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, entry]) => key.includes(secret) || containsSecret(entry, secret),
  );
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
