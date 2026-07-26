import { SOLANA_RPC_URL } from './config';

// The wallet provider already talks JSON-RPC directly to SOLANA_RPC_URL for its
// genesis-hash health check and its signTransaction send fallback. This collects
// that shape into one place so balance reads and confirmation polling do not each
// hand-roll another fetch. apps/api's solana-rpc.client.ts is server-side and is
// deliberately not the reuse target: it carries server credentials and retries.

export type SolanaCommitment = 'processed' | 'confirmed' | 'finalized';

export class SolanaRpcError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = 'SolanaRpcError';
    this.code = code;
  }
}

type RpcResponse<TResult> = {
  error?: { code?: number; message?: string };
  result?: TResult;
};

async function callRpc<TResult>(
  method: string,
  params: unknown[],
  signal?: AbortSignal,
): Promise<TResult> {
  const response = await fetch(SOLANA_RPC_URL, {
    body: JSON.stringify({ id: `dailydraft-${method}`, jsonrpc: '2.0', method, params }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal,
  });

  if (!response.ok) {
    throw new SolanaRpcError(`Solana RPC ${method} responded ${response.status}.`);
  }

  const payload = (await response.json()) as RpcResponse<TResult>;
  if (payload.error) {
    throw new SolanaRpcError(
      payload.error.message ?? `Solana RPC ${method} failed.`,
      payload.error.code ?? null,
    );
  }
  if (payload.result === undefined) {
    throw new SolanaRpcError(`Solana RPC ${method} returned no result.`);
  }
  return payload.result;
}

export async function fetchLamportBalance(address: string, signal?: AbortSignal): Promise<bigint> {
  const result = await callRpc<{ value?: number }>(
    'getBalance',
    [address, { commitment: 'confirmed' }],
    signal,
  );
  return BigInt(result.value ?? 0);
}

type TokenAccountsResult = {
  value?: {
    account: { data: { parsed: { info: { tokenAmount: { amount: string; decimals: number } } } } };
  }[];
};

/**
 * Sums every token account the owner holds for one mint. A wallet can hold more
 * than one account per mint, so taking the first would understate the balance
 * and refuse a payment the user can actually afford.
 */
export async function fetchTokenBalance(
  address: string,
  mint: string,
  signal?: AbortSignal,
): Promise<{ amount: bigint; decimals: number } | null> {
  const result = await callRpc<TokenAccountsResult>(
    'getTokenAccountsByOwner',
    [address, { mint }, { commitment: 'confirmed', encoding: 'jsonParsed' }],
    signal,
  );

  const accounts = result.value ?? [];
  if (accounts.length === 0) return null;

  let amount = 0n;
  let decimals = 0;
  for (const account of accounts) {
    const tokenAmount = account.account.data.parsed.info.tokenAmount;
    amount += BigInt(tokenAmount.amount);
    decimals = tokenAmount.decimals;
  }
  return { amount, decimals };
}

export async function fetchSignatureCommitment(
  signature: string,
  signal?: AbortSignal,
): Promise<{ commitment: SolanaCommitment | null; failed: boolean }> {
  const result = await callRpc<{
    value?: ({ confirmationStatus?: string | null; err?: unknown } | null)[];
  }>('getSignatureStatuses', [[signature], { searchTransactionHistory: true }], signal);

  const status = result.value?.[0] ?? null;
  if (!status) return { commitment: null, failed: false };
  if (status.err) return { commitment: null, failed: true };

  const confirmationStatus = status.confirmationStatus;
  const commitment =
    confirmationStatus === 'processed' ||
    confirmationStatus === 'confirmed' ||
    confirmationStatus === 'finalized'
      ? confirmationStatus
      : null;
  return { commitment, failed: false };
}
