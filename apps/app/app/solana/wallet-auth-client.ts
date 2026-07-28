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

export type WalletSessionIdentity = Pick<WalletSession, 'network' | 'wallet'>;

const apiBaseUrl = process.env.NEXT_PUBLIC_DUEL_API_URL?.replace(/\/$/, '');

export function isDuelApiConfigured(): boolean {
  return Boolean(apiBaseUrl);
}

export async function requestWalletChallenge(
  wallet: string,
  signal?: AbortSignal,
): Promise<WalletAuthChallenge> {
  if (!apiBaseUrl) throw new Error('Wallet authentication is unavailable in this preview.');
  return requestWalletChallengeAt(apiBaseUrl, wallet, fetch, signal);
}

export async function requestWalletChallengeAt(
  baseUrl: string,
  wallet: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WalletAuthChallenge> {
  return requestJson<WalletAuthChallenge>(fetcher, `${baseUrl}/auth/challenges`, {
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
  return createWalletSessionAt(apiBaseUrl, challenge, signature, fetch);
}

export async function createWalletSessionAt(
  baseUrl: string,
  challenge: WalletAuthChallenge,
  signature: Uint8Array,
  fetcher: typeof fetch = fetch,
): Promise<WalletSession> {
  return requestJson<WalletSession>(fetcher, `${baseUrl}/auth/sessions`, {
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      signature: bytesToBase64(signature),
      wallet: challenge.wallet,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

export async function validateWalletSession(
  token: string,
  signal?: AbortSignal,
): Promise<WalletSessionIdentity | null> {
  if (!apiBaseUrl) throw new Error('Wallet authentication is unavailable in this preview.');
  return validateWalletSessionAt(apiBaseUrl, token, fetch, signal);
}

export async function validateWalletSessionAt(
  baseUrl: string,
  token: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WalletSessionIdentity | null> {
  const response = await fetcher(`${baseUrl}/auth/session`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
    method: 'GET',
    signal,
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const detail = isProblemDetail(problem) ? problem.detail : undefined;
    throw new Error(detail ?? `Wallet authentication failed (${response.status}).`);
  }
  return (await response.json()) as WalletSessionIdentity;
}

export async function revokeWalletSession(token: string): Promise<void> {
  if (!apiBaseUrl) return;
  await fetch(`${apiBaseUrl}/auth/session/revoke`, {
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
  }).catch(() => undefined);
}

async function requestJson<T>(fetcher: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
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
  return globalThis.btoa(String.fromCharCode(...value));
}
