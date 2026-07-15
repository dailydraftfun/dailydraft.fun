import { getAnalyticsSessionId } from '../analytics-client';
import type { SOLANA_CHAIN, SOLANA_CLUSTER } from './config';

export type DuelOpponentType = 'direct' | 'matchmaking' | 'house';

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

export async function prepareDuelIntent(
  duelId: string,
  wallet: string,
  sessionToken: string,
): Promise<DuelTransactionIntent> {
  return authenticatedMutation<DuelTransactionIntent>(
    `/duels/${encodeURIComponent(duelId)}/transactions`,
    sessionToken,
    { action: 'fund', wallet },
  );
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

export async function getDuel(duelId: string): Promise<DurableDuel> {
  if (!apiBaseUrl) throw new Error('The duel API is not configured.');
  const response = await fetch(`${apiBaseUrl}/duels/${encodeURIComponent(duelId)}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`The duel could not be refreshed (${response.status}).`);
  return (await response.json()) as DurableDuel;
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
  const response = await fetch(`${apiBaseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
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
