import { Injectable } from '@nestjs/common';

import type {
  SolanaAddressSignature,
  SolanaSignatureStatus,
  SolanaTransactionEnvelope,
} from './transaction-monitor.types.js';

const DEFAULT_DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 2;

interface SolanaRpcEnvironment {
  SOLANA_RPC_RETRIES?: string;
  SOLANA_RPC_TIMEOUT_MS?: string;
}

interface SolanaRpcRequestOptions {
  delay?: (milliseconds: number) => Promise<void>;
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  retries: number;
  rpcUrl: string;
  timeoutMs: number;
}

export class SolanaRpcUnavailableError extends Error {
  constructor(message = 'Solana devnet RPC is unavailable') {
    super(message);
    this.name = 'SolanaRpcUnavailableError';
  }
}

export interface LegacySplTokenAccount {
  amount: bigint;
  delegate: string | null;
  delegatedAmount: bigint;
  mint: string;
  owner: string;
}

export abstract class SolanaRpcGateway {
  abstract assertDevnet(): Promise<void>;
  abstract getBlockHeight(): Promise<bigint>;
  abstract getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }>;
  getLegacyMint(_address: string): Promise<{ decimals: number; supply: bigint }> {
    throw new SolanaRpcUnavailableError('Legacy SPL mint reads are not implemented');
  }
  getLegacyTokenAccount(_address: string): Promise<LegacySplTokenAccount> {
    throw new SolanaRpcUnavailableError('Legacy SPL token-account reads are not implemented');
  }
  abstract getFinalizedSignaturesForAddress(
    address: string,
    limit: number,
  ): Promise<SolanaAddressSignature[]>;
  abstract getSignatureStatuses(signatures: string[]): Promise<Array<SolanaSignatureStatus | null>>;
  abstract getTransaction(
    signature: string,
    commitment: 'confirmed' | 'finalized',
  ): Promise<SolanaTransactionEnvelope | null>;
}

@Injectable()
export class SolanaRpcClient extends SolanaRpcGateway {
  readonly #rpcUrl = resolveRpcUrl();
  readonly #requestPolicy = resolveSolanaRpcRequestPolicy();

  async assertDevnet(): Promise<void> {
    const genesisHash = await this.request('getGenesisHash', []);
    if (genesisHash !== DEVNET_GENESIS_HASH) {
      throw new SolanaRpcUnavailableError('Configured Solana RPC is not devnet');
    }
  }

  async getBlockHeight(): Promise<bigint> {
    const result = await this.request('getBlockHeight', [{ commitment: 'finalized' }]);
    if (!Number.isSafeInteger(result) || Number(result) < 0) throw new SolanaRpcUnavailableError();
    return BigInt(Number(result));
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    const result = await this.request('getLatestBlockhash', [{ commitment: 'finalized' }]);
    if (
      !isObject(result) ||
      !isObject(result.value) ||
      typeof result.value.blockhash !== 'string' ||
      !Number.isSafeInteger(result.value.lastValidBlockHeight) ||
      Number(result.value.lastValidBlockHeight) < 0
    ) {
      throw new SolanaRpcUnavailableError();
    }
    return {
      blockhash: result.value.blockhash,
      lastValidBlockHeight: BigInt(Number(result.value.lastValidBlockHeight)),
    };
  }

  async getLegacyMint(address: string): Promise<{ decimals: number; supply: bigint }> {
    const info = await this.getParsedTokenInfo(address);
    if (
      info.type !== 'mint' ||
      !isObject(info.info) ||
      !isNonNegativeInteger(info.info.decimals) ||
      typeof info.info.supply !== 'string' ||
      !/^\d+$/.test(info.info.supply)
    ) {
      throw new SolanaRpcUnavailableError('RPC returned an invalid legacy SPL mint');
    }
    return { decimals: info.info.decimals, supply: BigInt(info.info.supply) };
  }

  async getLegacyTokenAccount(address: string): Promise<LegacySplTokenAccount> {
    const parsed = await this.getParsedTokenInfo(address);
    return parseLegacyTokenAccount(parsed);
  }

  async getFinalizedSignaturesForAddress(
    address: string,
    limit: number,
  ): Promise<SolanaAddressSignature[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new SolanaRpcUnavailableError();
    }
    const result = await this.request('getSignaturesForAddress', [
      address,
      { commitment: 'finalized', limit },
    ]);
    if (!Array.isArray(result)) throw new SolanaRpcUnavailableError();
    return result.flatMap(parseFinalizedAddressSignature);
  }

  async getSignatureStatuses(signatures: string[]): Promise<Array<SolanaSignatureStatus | null>> {
    if (signatures.length === 0) return [];
    if (signatures.length > 256) throw new SolanaRpcUnavailableError();
    const result = await this.request('getSignatureStatuses', [
      signatures,
      { searchTransactionHistory: true },
    ]);
    if (!isObject(result) || !Array.isArray(result.value)) throw new SolanaRpcUnavailableError();
    return result.value.map(parseSignatureStatus);
  }

  async getTransaction(
    signature: string,
    commitment: 'confirmed' | 'finalized',
  ): Promise<SolanaTransactionEnvelope | null> {
    const result = await this.request('getTransaction', [
      signature,
      { commitment, encoding: 'json', maxSupportedTransactionVersion: 0 },
    ]);
    if (result === null) return null;
    return parseTransactionEnvelope(result);
  }

  private async request(method: string, params: unknown[]): Promise<unknown> {
    return requestSolanaRpc(method, params, {
      ...this.#requestPolicy,
      rpcUrl: this.#rpcUrl,
    });
  }

  private async getParsedTokenInfo(address: string): Promise<{ info: unknown; type: unknown }> {
    const result = await this.request('getAccountInfo', [
      address,
      { commitment: 'finalized', encoding: 'jsonParsed' },
    ]);
    if (
      !isObject(result) ||
      !isObject(result.value) ||
      result.value.owner !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
      !isObject(result.value.data) ||
      result.value.data.program !== 'spl-token' ||
      !isObject(result.value.data.parsed)
    ) {
      throw new SolanaRpcUnavailableError('Account is not a finalized legacy SPL account');
    }
    return { info: result.value.data.parsed.info, type: result.value.data.parsed.type };
  }
}

export function parseLegacyTokenAccount(parsed: {
  info: unknown;
  type: unknown;
}): LegacySplTokenAccount {
  const info = parsed.info;
  if (
    parsed.type !== 'account' ||
    !isObject(info) ||
    info.state !== 'initialized' ||
    typeof info.mint !== 'string' ||
    typeof info.owner !== 'string' ||
    !isObject(info.tokenAmount) ||
    typeof info.tokenAmount.amount !== 'string' ||
    !/^\d+$/.test(info.tokenAmount.amount)
  ) {
    throw new SolanaRpcUnavailableError('RPC returned an invalid legacy SPL token account');
  }
  const delegation = parseDelegation(info);
  return {
    amount: BigInt(info.tokenAmount.amount),
    delegate: delegation.delegate,
    delegatedAmount: delegation.amount,
    mint: info.mint,
    owner: info.owner,
  };
}

function parseDelegation(info: Record<string, unknown>): {
  amount: bigint;
  delegate: string | null;
} {
  const delegate = info.delegate;
  const delegatedAmount = info.delegatedAmount;
  if (delegate === undefined && delegatedAmount === undefined) {
    return { amount: 0n, delegate: null };
  }
  if (
    typeof delegate !== 'string' ||
    !isObject(delegatedAmount) ||
    typeof delegatedAmount.amount !== 'string' ||
    !/^\d+$/.test(delegatedAmount.amount)
  ) {
    throw new SolanaRpcUnavailableError('RPC returned an invalid legacy SPL delegation');
  }
  return { amount: BigInt(delegatedAmount.amount), delegate };
}

function parseSignatureStatus(value: unknown): SolanaSignatureStatus | null {
  if (value === null) return null;
  if (!isObject(value)) throw new SolanaRpcUnavailableError();
  const confirmationStatus = value.confirmationStatus;
  if (
    confirmationStatus !== null &&
    confirmationStatus !== 'processed' &&
    confirmationStatus !== 'confirmed' &&
    confirmationStatus !== 'finalized'
  ) {
    throw new SolanaRpcUnavailableError();
  }
  return { confirmationStatus, err: value.err ?? null };
}

export function parseFinalizedAddressSignature(value: unknown): SolanaAddressSignature[] {
  if (!isObject(value)) throw new SolanaRpcUnavailableError();
  if (value.confirmationStatus !== 'finalized') return [];
  if (
    typeof value.signature !== 'string' ||
    (value.blockTime !== null && !isNonNegativeInteger(value.blockTime))
  ) {
    throw new SolanaRpcUnavailableError();
  }
  return [
    {
      blockTime: value.blockTime as number | null,
      confirmationStatus: 'finalized',
      signature: value.signature,
    },
  ];
}

function parseTransactionEnvelope(value: unknown): SolanaTransactionEnvelope {
  if (!isObject(value) || !isObject(value.transaction)) throw new SolanaRpcUnavailableError();
  const transaction = value.transaction;
  if (
    !Array.isArray(transaction.signatures) ||
    !transaction.signatures.every((signature) => typeof signature === 'string') ||
    !isObject(transaction.message)
  ) {
    throw new SolanaRpcUnavailableError();
  }
  const message = transaction.message;
  if (
    !Array.isArray(message.accountKeys) ||
    !message.accountKeys.every((key) => typeof key === 'string') ||
    !isObject(message.header) ||
    !Array.isArray(message.instructions) ||
    typeof message.recentBlockhash !== 'string'
  ) {
    throw new SolanaRpcUnavailableError();
  }
  const header = message.header;
  if (
    !isNonNegativeInteger(header.numRequiredSignatures) ||
    !isNonNegativeInteger(header.numReadonlySignedAccounts) ||
    !isNonNegativeInteger(header.numReadonlyUnsignedAccounts)
  ) {
    throw new SolanaRpcUnavailableError();
  }
  const instructions = message.instructions.map((instruction) => {
    if (
      !isObject(instruction) ||
      !isNonNegativeInteger(instruction.programIdIndex) ||
      !Array.isArray(instruction.accounts) ||
      !instruction.accounts.every(isNonNegativeInteger) ||
      typeof instruction.data !== 'string'
    ) {
      throw new SolanaRpcUnavailableError();
    }
    return {
      accounts: instruction.accounts as number[],
      data: instruction.data,
      programIdIndex: instruction.programIdIndex as number,
    };
  });
  const meta = value.meta;
  if (meta !== null && !isObject(meta)) throw new SolanaRpcUnavailableError();
  const loadedAddresses = meta && parseLoadedAddresses(meta.loadedAddresses);
  return {
    meta: meta
      ? {
          err: meta.err ?? null,
          ...(loadedAddresses === undefined ? {} : { loadedAddresses }),
        }
      : null,
    transaction: {
      message: {
        accountKeys: message.accountKeys as string[],
        header: {
          numReadonlySignedAccounts: header.numReadonlySignedAccounts as number,
          numReadonlyUnsignedAccounts: header.numReadonlyUnsignedAccounts as number,
          numRequiredSignatures: header.numRequiredSignatures as number,
        },
        instructions,
        recentBlockhash: message.recentBlockhash,
      },
      signatures: transaction.signatures as string[],
    },
  };
}

function parseLoadedAddresses(
  value: unknown,
): { readonly: string[]; writable: string[] } | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    !isObject(value) ||
    !Array.isArray(value.readonly) ||
    !Array.isArray(value.writable) ||
    !value.readonly.every((address) => typeof address === 'string') ||
    !value.writable.every((address) => typeof address === 'string')
  ) {
    throw new SolanaRpcUnavailableError();
  }
  return { readonly: value.readonly as string[], writable: value.writable as string[] };
}

function resolveRpcUrl(): string {
  const configured = process.env.SOLANA_RPC_URL?.trim();
  if (!configured) return DEFAULT_DEVNET_RPC_URL;
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol)) throw new SolanaRpcUnavailableError();
    return url.toString();
  } catch {
    throw new SolanaRpcUnavailableError('Configured Solana RPC URL is invalid');
  }
}

export function resolveSolanaRpcRequestPolicy(environment: SolanaRpcEnvironment = process.env): {
  retries: number;
  timeoutMs: number;
} {
  return {
    retries: resolveBoundedInteger(environment.SOLANA_RPC_RETRIES, DEFAULT_RETRIES, 0, 4),
    timeoutMs: resolveBoundedInteger(
      environment.SOLANA_RPC_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1,
      30_000,
    ),
  };
}

export async function requestSolanaRpc(
  method: string,
  params: unknown[],
  options: SolanaRpcRequestOptions,
): Promise<unknown> {
  const delay = options.delay ?? wait;
  const fetcher = options.fetcher ?? fetch;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetcher(options.rpcUrl, {
        body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('RPC returned a failed HTTP status');
      const payload: unknown = await response.json();
      if (!isObject(payload) || 'error' in payload || !('result' in payload)) {
        throw new Error('RPC returned an invalid response');
      }
      return payload.result;
    } catch {
      if (attempt < options.retries) await delay(100 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new SolanaRpcUnavailableError(`Solana devnet RPC method ${method} is unavailable`);
}

function resolveBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? Math.min(parsed, maximum) : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
