import { getAnalyticsSessionId } from '../analytics-client';
import { SOLANA_CHAIN, SOLANA_CLUSTER } from './config';

export type DuelOpponentType = 'direct' | 'matchmaking' | 'house';

export type DuelIntentRequest = {
  walletAddress: string;
  opponentType: DuelOpponentType;
  opponentAddress?: string;
  packTierUsd: number;
  platformFeeUsd: number;
};

export type DuelTransactionIntent = {
  id: string;
  cluster: typeof SOLANA_CLUSTER;
  chain: typeof SOLANA_CHAIN;
  title: string;
  description: string;
  totalUsd: number;
  packTierUsd: number;
  platformFeeUsd: number;
  counterparty: string;
  recipientLabel: string;
  expiresAt: string;
  serializedTransactionBase64: string | null;
  simulation: boolean;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_DUEL_API_URL?.replace(/\/$/, '');

export type DurableDuel = {
  creatorWallet: string;
  expiresAt: string;
  id: string;
  matchmakingMode: 'direct' | 'house' | 'open';
  opponentWallet?: string | null;
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
};

export function createPreviewIntent(request: DuelIntentRequest): DuelTransactionIntent {
  const counterparty =
    request.opponentType === 'direct'
      ? (request.opponentAddress ?? 'Invited wallet')
      : request.opponentType === 'house'
        ? 'Pack Duel House'
        : 'Public matchmaking';

  return {
    id: `preview-${Date.now()}`,
    cluster: SOLANA_CLUSTER,
    chain: SOLANA_CHAIN,
    title: `$${request.packTierUsd} Pack Duel commitment`,
    description: 'Review the pack price, fee, opponent, and network before any wallet approval.',
    totalUsd: request.packTierUsd + request.platformFeeUsd,
    packTierUsd: request.packTierUsd,
    platformFeeUsd: request.platformFeeUsd,
    counterparty,
    recipientLabel: 'Devnet duel escrow',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    serializedTransactionBase64: null,
    simulation: true,
  };
}

export async function prepareDuelIntent(
  request: DuelIntentRequest,
  signal?: AbortSignal,
): Promise<DuelTransactionIntent> {
  if (!apiBaseUrl) return createPreviewIntent(request);

  const response = await fetch(`${apiBaseUrl}/duels/transaction-intents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...request, cluster: SOLANA_CLUSTER }),
    signal,
  });

  if (!response.ok) {
    if (response.status === 404 || response.status === 501) {
      throw new Error('Devnet escrow transaction preparation is not live. No funds moved.');
    }
    throw new Error(`Could not prepare the transaction intent (${response.status}).`);
  }

  return (await response.json()) as DuelTransactionIntent;
}

export async function createDuel(
  input: {
    creatorWallet: string;
    matchmakingMode: 'direct' | 'house' | 'open';
    opponentWallet?: string;
  },
  sessionToken: string,
): Promise<DurableDuel> {
  return authenticatedMutation<DurableDuel>('/duels', sessionToken, {
    ...input,
    analyticsSessionId: getAnalyticsSessionId(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
    packId: 'pokemon_50',
  });
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

export async function submitSignedDuelIntent(intentId: string, signedTransaction: Uint8Array) {
  if (!apiBaseUrl) throw new Error('The duel API is not configured for transaction submission.');

  const signedTransactionBase64 = window.btoa(
    String.fromCharCode(...Array.from(signedTransaction)),
  );
  const response = await fetch(`${apiBaseUrl}/duels/transaction-intents/${intentId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signedTransactionBase64, cluster: SOLANA_CLUSTER }),
  });

  if (!response.ok) {
    throw new Error(`The signed devnet transaction could not be submitted (${response.status}).`);
  }
}

async function authenticatedMutation<T>(
  path: string,
  sessionToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  if (!apiBaseUrl) throw new Error('The duel API is not configured.');
  const response = await fetch(`${apiBaseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
      'idempotency-key': `opd-web-${crypto.randomUUID()}`,
    },
    method: 'POST',
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const detail = getProblemDetail(problem);
    throw new Error(detail ?? `The duel request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function getProblemDetail(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('detail' in value)) return undefined;
  return typeof value.detail === 'string' ? value.detail : undefined;
}
