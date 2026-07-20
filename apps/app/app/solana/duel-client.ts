import { getAnalyticsSessionId } from '../analytics-client';
import type { SOLANA_CHAIN, SOLANA_CLUSTER } from './config';

export type DuelOpponentType = 'direct' | 'matchmaking' | 'house';
export type DuelProviderMode = 'collector-crypt-sandbox' | 'mock' | 'openpacksduel-devnet';

export type DuelTransactionIntent = {
  action: 'fund';
  chain: typeof SOLANA_CHAIN;
  cluster: typeof SOLANA_CLUSTER;
  duelId: string;
  escrowAddress: string;
  expiresAt: string;
  feeAmountLamports: string;
  feeAmountSol: string;
  feeRecipient: string;
  fundingSide: 'creator' | 'opponent';
  id: string;
  lastValidBlockHeight: string;
  paymentMint: string;
  programId: string;
  recentBlockhash: string;
  serializedTransactionBase64: string;
  status: 'prepared';
  wallet: string;
  warnings: string[];
};

const apiBaseUrl = process.env.NEXT_PUBLIC_DUEL_API_URL?.replace(/\/$/, '');

export type DurableDuel = {
  createdAt: string;
  creatorWallet: string;
  environment: 'solana-devnet';
  escrowAddress?: string | null;
  expiresAt: string;
  houseOpponent: boolean;
  id: string;
  matchmakingMode: 'direct' | 'house' | 'open';
  opponentWallet?: string | null;
  pack: {
    id: string;
    imageUrl?: string;
    name: string;
    price: { amount: string; currency: 'USDC'; decimals: 6 };
    provider: string;
    providerPackId?: string;
  };
  providerMode: DuelProviderMode;
  result?: {
    comparisonMetric: 'insured-value';
    outcomes: Array<{
      assetReference: string;
      displayName: string;
      insuredValue: { amount: string; currency: 'USDC'; decimals: 6 };
      isMock: boolean;
      provider: string;
      providerReference: string;
      side: 'creator' | 'opponent';
    }>;
    resultHash: string;
    settlementReady: boolean;
    valuationPolicyHash: string;
    winnerSide: 'creator' | 'opponent' | null;
  } | null;
  stake: { amount: string; currency: 'USDC'; decimals: 6 };
  status:
    | 'waiting'
    | 'matched'
    | 'committing'
    | 'funded'
    | 'opening'
    | 'awaiting_assets'
    | 'settling'
    | 'settled'
    | 'cancelling'
    | 'cancelled'
    | 'refunding'
    | 'refunded'
    | 'failed';
  transactionSignature?: string | null;
  version: number;
  winnerWallet?: string | null;
};

export type ProductCapabilities = {
  modes: {
    direct: { enabled: boolean; reason: string | null };
    house: { enabled: boolean; reason: string | null };
    open: { enabled: boolean; reason: string | null };
  };
  network: 'solana-devnet';
  packs: Array<{
    enabled: boolean;
    id: string;
    name: string;
    reason: string | null;
    tier: 25 | 50 | 100;
  }>;
  provider: { mode: string; ready: boolean };
};

export type MatchmakingSession = {
  availableActions: Array<{
    action: 'cancel_search' | 'continue_search' | 'house_fallback';
    available: boolean;
    disclosure?: string;
  }>;
  cancellationRule: string;
  commitmentExpiresAt: string | null;
  duelId: string;
  houseOpponent: boolean;
  opponentWallet: string | null;
  queue: {
    packId: string;
    providerMode: DuelProviderMode;
    queueKey: string;
    regionSegment: string;
    riskSegment: string;
    tier: number;
    valuationPolicyHash: string;
  };
  role: 'creator' | 'opponent';
  searchExpiresAt: string;
  state: 'matched' | 'searching';
  wallet: string;
};

export type DuelReconciliationResult = {
  activeTransactionCount: number;
  duelId: string;
  duelStatus: DurableDuel['status'];
  reconciliation: {
    checked: number;
    confirmed: number;
    expired: number;
    failed: number;
    finalized: number;
    pending: number;
    stuck: number;
  };
  unboundTransactionCount: number;
};

const RECONCILIATION_POLL_ATTEMPTS = 20;
const RECONCILIATION_POLL_INTERVAL_MS = 2_000;

export async function prepareDuelIntent(
  duelId: string,
  wallet: string,
  sessionToken: string,
): Promise<DuelTransactionIntent> {
  if (!apiBaseUrl) throw new Error('The duel API is not configured.');
  return requestPreparedDuelIntent(
    apiBaseUrl,
    duelId,
    wallet,
    sessionToken,
    `opd-web-${crypto.randomUUID()}`,
  );
}

export type CreateDuelInput = {
  analyticsSessionId?: string;
  creatorWallet: string;
  expiresAt: string;
  matchmakingMode: 'direct' | 'house';
  opponentWallet?: string;
  packId: string;
};

export async function createDuel(
  input: Omit<CreateDuelInput, 'analyticsSessionId' | 'expiresAt'>,
  sessionToken: string,
): Promise<DurableDuel> {
  if (!apiBaseUrl) throw new Error('The duel API is not configured.');
  return requestCreateDuel(
    apiBaseUrl,
    {
      ...input,
      analyticsSessionId: getAnalyticsSessionId(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
    },
    sessionToken,
    `opd-web-${crypto.randomUUID()}`,
  );
}

export function searchOpenMatchmaking(
  wallet: string,
  sessionToken: string,
  packId: string,
): Promise<MatchmakingSession> {
  return authenticatedMutation<MatchmakingSession>('/matchmaking/search', sessionToken, {
    packId,
    wallet,
  });
}

export function continueOpenMatchmaking(
  wallet: string,
  sessionToken: string,
  packId: string,
): Promise<MatchmakingSession> {
  return authenticatedMutation<MatchmakingSession>('/matchmaking/continue', sessionToken, {
    packId,
    wallet,
  });
}

export async function getOpenMatchmakingStatus(
  wallet: string,
  sessionToken: string,
): Promise<MatchmakingSession | null> {
  if (!apiBaseUrl) throw new Error('The duel API is not configured.');
  const response = await fetch(`${apiBaseUrl}/matchmaking/status`, {
    body: JSON.stringify({ wallet }),
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  if (response.status === 404) return null;
  return parseMutationResponse<MatchmakingSession>(response);
}

export function cancelOpenMatchmaking(
  wallet: string,
  sessionToken: string,
): Promise<{ cancelled: true; duelId: string; reason: string }> {
  return authenticatedMutation('/matchmaking/cancel', sessionToken, { wallet });
}

export function selectHouseFallback(
  wallet: string,
  sessionToken: string,
): Promise<MatchmakingSession> {
  return authenticatedMutation<MatchmakingSession>('/matchmaking/house-fallback', sessionToken, {
    wallet,
  });
}

export async function getDuel(duelId: string, sessionToken: string): Promise<DurableDuel> {
  if (!apiBaseUrl) throw new Error('The duel API is not configured.');
  return requestAuthenticatedDuel(apiBaseUrl, duelId, sessionToken);
}

export async function requestAuthenticatedDuel(
  baseUrl: string,
  duelId: string,
  sessionToken: string,
  fetcher: typeof fetch = fetch,
): Promise<DurableDuel> {
  const response = await fetcher(`${baseUrl}/duels/${encodeURIComponent(duelId)}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  return parseMutationResponse(response);
}

export async function requestCreateDuel(
  baseUrl: string,
  input: CreateDuelInput,
  sessionToken: string,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<DurableDuel> {
  return requestDuelMutation(baseUrl, '/duels', sessionToken, input, idempotencyKey, fetcher);
}

export async function requestPreparedDuelIntent(
  baseUrl: string,
  duelId: string,
  wallet: string,
  sessionToken: string,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<DuelTransactionIntent> {
  return requestDuelMutation(
    baseUrl,
    `/duels/${encodeURIComponent(duelId)}/transactions`,
    sessionToken,
    { action: 'fund', wallet },
    idempotencyKey,
    fetcher,
  );
}

export async function getPrivateRematchOpponent(
  duelId: string,
  sessionToken: string,
): Promise<{ side: 'creator' | 'opponent'; wallet: string }> {
  if (!apiBaseUrl) throw new Error('The duel API is not configured.');
  return requestPrivateRematchOpponent(apiBaseUrl, duelId, sessionToken);
}

export async function requestPrivateRematchOpponent(
  baseUrl: string,
  duelId: string,
  sessionToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ side: 'creator' | 'opponent'; wallet: string }> {
  const response = await fetcher(
    `${baseUrl}/duels/${encodeURIComponent(duelId)}/rematch-opponent`,
    {
      cache: 'no-store',
      headers: { authorization: `Bearer ${sessionToken}` },
    },
  );
  return parseMutationResponse(response);
}

export function advanceDuelLifecycle(duelId: string, sessionToken: string): Promise<DurableDuel> {
  return authenticatedMutation<DurableDuel>(
    `/duels/${encodeURIComponent(duelId)}/open-packs`,
    sessionToken,
    {},
    `opd-open-packs-${duelId}`,
  );
}

export async function getProductCapabilities(): Promise<ProductCapabilities> {
  if (!apiBaseUrl) throw new Error('The duel API is not configured.');
  const response = await fetch(`${apiBaseUrl}/health/capabilities`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Product capabilities are unavailable (${response.status}).`);
  return parseProductCapabilities(await response.json());
}

export function parseProductCapabilities(value: unknown): ProductCapabilities {
  if (!value || typeof value !== 'object') throw malformedCapabilitiesError();
  const candidate = value as Partial<ProductCapabilities>;
  if (
    candidate.network !== 'solana-devnet' ||
    !isCapabilityModes(candidate.modes) ||
    !Array.isArray(candidate.packs) ||
    !candidate.packs.every(isCapabilityPack) ||
    !isCapabilityProvider(candidate.provider)
  ) {
    throw malformedCapabilitiesError();
  }
  return candidate as ProductCapabilities;
}

function isCapabilityModes(value: unknown): value is ProductCapabilities['modes'] {
  if (!value || typeof value !== 'object') return false;
  const modes = value as Partial<ProductCapabilities['modes']>;
  return (
    isCapabilityState(modes.direct) &&
    isCapabilityState(modes.house) &&
    isCapabilityState(modes.open)
  );
}

function isCapabilityState(
  value: unknown,
): value is ProductCapabilities['modes'][keyof ProductCapabilities['modes']] {
  if (!value || typeof value !== 'object') return false;
  const state = value as { enabled?: unknown; reason?: unknown };
  return (
    typeof state.enabled === 'boolean' &&
    (state.reason === null || typeof state.reason === 'string')
  );
}

function isCapabilityPack(value: unknown): value is ProductCapabilities['packs'][number] {
  if (!value || typeof value !== 'object') return false;
  const pack = value as {
    enabled?: unknown;
    id?: unknown;
    name?: unknown;
    reason?: unknown;
    tier?: unknown;
  };
  return (
    typeof pack.enabled === 'boolean' &&
    typeof pack.id === 'string' &&
    typeof pack.name === 'string' &&
    (pack.reason === null || typeof pack.reason === 'string') &&
    (pack.tier === 25 || pack.tier === 50 || pack.tier === 100)
  );
}

function isCapabilityProvider(value: unknown): value is ProductCapabilities['provider'] {
  if (!value || typeof value !== 'object') return false;
  const provider = value as { mode?: unknown; ready?: unknown };
  return typeof provider.mode === 'string' && typeof provider.ready === 'boolean';
}

function malformedCapabilitiesError(): Error {
  return new Error('Product capabilities are unavailable (malformed response).');
}

export async function joinDuel(
  duelId: string,
  wallet: string,
  sessionToken: string,
): Promise<DurableDuel> {
  return authenticatedMutation<DurableDuel>(
    `/duels/${encodeURIComponent(duelId)}/join`,
    sessionToken,
    {
      analyticsSessionId: getAnalyticsSessionId(),
      wallet,
    },
  );
}

export async function cancelDuel(
  duelId: string,
  wallet: string,
  sessionToken: string,
  reason = 'wallet_cancelled',
): Promise<DurableDuel> {
  return authenticatedMutation<DurableDuel>(
    `/duels/${encodeURIComponent(duelId)}/cancel`,
    sessionToken,
    {
      analyticsSessionId: getAnalyticsSessionId(),
      reason,
      wallet,
    },
  );
}

export async function submitSignedDuelIntent(
  duelId: string,
  intentId: string,
  signature: string,
  sessionToken: string,
): Promise<void> {
  await authenticatedMutation(
    `/duels/${encodeURIComponent(duelId)}/transactions/${encodeURIComponent(intentId)}/submissions`,
    sessionToken,
    { signature },
    submissionIdempotencyKey(intentId),
  );
}

export async function recordRejectedDuelIntent(
  duelId: string,
  intentId: string,
  sessionToken: string,
): Promise<void> {
  await authenticatedMutation(
    `/duels/${encodeURIComponent(duelId)}/transactions/${encodeURIComponent(intentId)}/rejections`,
    sessionToken,
    {},
    `opd-reject-${intentId}`,
  );
}

export function reconcileDuelTransactions(
  duelId: string,
  sessionToken: string,
): Promise<DuelReconciliationResult> {
  return authenticatedMutation<DuelReconciliationResult>(
    `/duels/${encodeURIComponent(duelId)}/transactions/reconciliation`,
    sessionToken,
    {},
  );
}

export async function waitForDuelTransactions(
  duelId: string,
  sessionToken: string,
): Promise<DuelReconciliationResult> {
  let latest: DuelReconciliationResult | null = null;
  let lastError: unknown;
  for (let attempt = 0; attempt < RECONCILIATION_POLL_ATTEMPTS; attempt += 1) {
    try {
      latest = await reconcileDuelTransactions(duelId, sessionToken);
      if (latest.activeTransactionCount === 0 && latest.unboundTransactionCount === 0) {
        return latest;
      }
    } catch (error) {
      if (!(error instanceof DuelApiRequestError) || !error.retryable) throw error;
      lastError = error;
    }
    if (attempt + 1 < RECONCILIATION_POLL_ATTEMPTS) {
      await wait(RECONCILIATION_POLL_INTERVAL_MS);
    }
  }
  if (latest) return latest;
  throw lastError instanceof Error
    ? lastError
    : new Error('Solana devnet reconciliation is temporarily unavailable.');
}

export function submissionIdempotencyKey(intentId: string): string {
  return `opd-submit-${intentId}`;
}

async function authenticatedMutation<T>(
  path: string,
  sessionToken: string,
  body: Record<string, unknown>,
  idempotencyKey = `opd-web-${crypto.randomUUID()}`,
): Promise<T> {
  if (!apiBaseUrl) throw new Error('The duel API is not configured.');
  return requestDuelMutation(apiBaseUrl, path, sessionToken, body, idempotencyKey);
}

async function requestDuelMutation<T>(
  baseUrl: string,
  path: string,
  sessionToken: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    method: 'POST',
  });
  return parseMutationResponse<T>(response);
}

async function parseMutationResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const detail = getProblemDetail(problem);
    throw new DuelApiRequestError(
      detail ?? `The duel request failed (${response.status}).`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export class DuelApiRequestError extends Error {
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DuelApiRequestError';
    this.retryable = status === 429 || status >= 500;
    this.status = status;
  }
}

export function isRetryableDuelRequestError(error: unknown): boolean {
  return error instanceof DuelApiRequestError ? error.retryable : true;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getProblemDetail(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('detail' in value)) return undefined;
  return typeof value.detail === 'string' ? value.detail : undefined;
}
