import type { SOLANA_CHAIN } from './config';

export type WalletAuthChallenge = {
  chain: typeof SOLANA_CHAIN;
  challengeId: string;
  domain: string;
  expiresAt: string;
  message: string;
  uri: string;
  wallet: string;
};

export type WalletSession = {
  expiresAt: string;
  network: 'solana-devnet';
  token: string;
  wallet: string;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_DUEL_API_URL?.replace(/\/$/, '');

export function isDuelApiConfigured(): boolean {
  return Boolean(apiBaseUrl);
}

export async function requestWalletChallenge(
  wallet: string,
  signal?: AbortSignal,
): Promise<WalletAuthChallenge> {
  if (!apiBaseUrl) throw new Error('Wallet authentication is unavailable in this preview.');
  return requestJson<WalletAuthChallenge>(`${apiBaseUrl}/auth/challenges`, {
    body: JSON.stringify({ wallet }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal,
  });
}

export async function createWalletSession(
  challenge: WalletAuthChallenge,
  signature: Uint8Array,
): Promise<WalletSession> {
  if (!apiBaseUrl) throw new Error('Wallet authentication is unavailable in this preview.');
  return requestJson<WalletSession>(`${apiBaseUrl}/auth/sessions`, {
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      signature: bytesToBase64(signature),
      wallet: challenge.wallet,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

export async function revokeWalletSession(token: string): Promise<void> {
  if (!apiBaseUrl) return;
  await fetch(`${apiBaseUrl}/auth/session/revoke`, {
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
  }).catch(() => undefined);
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const detail = isProblemDetail(problem) ? problem.detail : undefined;
    throw new Error(detail ?? `Wallet authentication failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function isProblemDetail(value: unknown): value is { detail: string } {
  return Boolean(
    value && typeof value === 'object' && 'detail' in value && typeof value.detail === 'string',
  );
}

function bytesToBase64(value: Uint8Array): string {
  return window.btoa(String.fromCharCode(...value));
}
