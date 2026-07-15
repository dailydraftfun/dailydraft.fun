import { Injectable } from '@nestjs/common';

import type {
  SolanaSignatureStatus,
  SolanaTransactionEnvelope,
} from './transaction-monitor.types.js';

const DEFAULT_DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const DEVNET_GENESIS_HASH = 'GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 2;

export class SolanaRpcUnavailableError extends Error {
  constructor(message = 'Solana devnet RPC is unavailable') {
    super(message);
    this.name = 'SolanaRpcUnavailableError';
  }
}

export abstract class SolanaRpcGateway {
  abstract assertDevnet(): Promise<void>;
  abstract getBlockHeight(): Promise<bigint>;
  abstract getSignatureStatuses(signatures: string[]): Promise<Array<SolanaSignatureStatus | null>>;
  abstract getTransaction(
    signature: string,
    commitment: 'confirmed' | 'finalized',
  ): Promise<SolanaTransactionEnvelope | null>;
}

@Injectable()
export class SolanaRpcClient extends SolanaRpcGateway {
  readonly #rpcUrl = resolveRpcUrl();
  readonly #timeoutMs = resolvePositiveInteger(
    process.env.SOLANA_RPC_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    30_000,
  );
  readonly #retries = resolvePositiveInteger(process.env.SOLANA_RPC_RETRIES, DEFAULT_RETRIES, 4);
  #clusterValidated = false;

  async assertDevnet(): Promise<void> {
    if (this.#clusterValidated) return;
    const genesisHash = await this.request('getGenesisHash', []);
    if (genesisHash !== DEVNET_GENESIS_HASH) {
      throw new SolanaRpcUnavailableError('Configured Solana RPC is not devnet');
    }
    this.#clusterValidated = true;
  }

  async getBlockHeight(): Promise<bigint> {
    const result = await this.request('getBlockHeight', [{ commitment: 'finalized' }]);
    if (!Number.isSafeInteger(result) || Number(result) < 0) throw new SolanaRpcUnavailableError();
    return BigInt(Number(result));
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
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await fetch(this.#rpcUrl, {
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
        const payload: unknown = await response.json();
        if (!isObject(payload) || 'error' in payload || !('result' in payload)) {
          throw new Error('RPC returned an invalid response');
        }
        return payload.result;
      } catch {
        if (attempt < this.#retries) await wait(100 * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new SolanaRpcUnavailableError();
  }
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

function resolvePositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
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
