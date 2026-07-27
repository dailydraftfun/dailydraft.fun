import bs58 from 'bs58';

import { SOLANA_RPC_URL } from './config';
import { WalletTransactionNotBroadcastError } from './wallet-transaction-error';

export type SignedWalletTransaction = {
  serializedTransaction: Uint8Array;
  signedTransactionBase64: string;
  signature: string;
};

type TransactionSignatureLayout = {
  prefixLength: number;
  signatureCount: number;
};

/** Validate wallet output and derive its deterministic id without broadcasting. */
export function inspectSignedWalletTransaction(
  serializedTransaction: Uint8Array,
): SignedWalletTransaction {
  try {
    return {
      serializedTransaction,
      signedTransactionBase64: toBase64(serializedTransaction),
      signature: readSignedTransactionSignature(serializedTransaction),
    };
  } catch {
    throw new WalletTransactionNotBroadcastError(
      'The wallet returned invalid signed transaction bytes. Nothing was broadcast.',
      'pre-broadcast-failure',
    );
  }
}

/**
 * Broadcasts wallet-signed bytes while exposing their deterministic signature
 * before the RPC round-trip. If the response is lost after submission, callers
 * can still track this exact transfer instead of opening a second wallet prompt.
 */
export async function broadcastSignedTransaction(
  signedTransaction: Uint8Array,
  onSignature?: (signature: string) => void,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  const signed = inspectSignedWalletTransaction(signedTransaction);
  const { signature } = signed;
  try {
    onSignature?.(signature);
  } catch (cause: unknown) {
    if (cause instanceof WalletTransactionNotBroadcastError) throw cause;
    throw new WalletTransactionNotBroadcastError(
      'The wallet returned invalid signed transaction bytes. Nothing was broadcast.',
      'pre-broadcast-failure',
    );
  }
  const response = await fetcher(SOLANA_RPC_URL, {
    body: JSON.stringify({
      id: 'dailydraft-send',
      jsonrpc: '2.0',
      method: 'sendTransaction',
      params: [
        signed.signedTransactionBase64,
        { encoding: 'base64', preflightCommitment: 'confirmed' },
      ],
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const payload = (await response.json()) as { error?: { message?: string }; result?: unknown };
  if (!response.ok || typeof payload.result !== 'string') {
    throw new Error(payload.error?.message ?? 'The signed devnet transaction was not broadcast.');
  }
  if (payload.result !== signature) {
    throw new Error('The Solana RPC returned a different transaction signature.');
  }
  return signature;
}

/**
 * Solana wire transactions start with a compact-u16 signature count followed
 * by 64-byte Ed25519 signatures. The first signature is the transaction id.
 */
export function readSignedTransactionSignature(signedTransaction: Uint8Array): string {
  const { prefixLength, signatureCount } = readTransactionSignatureLayout(signedTransaction);
  if (signatureCount < 1 || signedTransaction.length < prefixLength + 64 * signatureCount) {
    throw new Error('The wallet returned a transaction without a complete signature.');
  }

  return bs58.encode(signedTransaction.slice(prefixLength, prefixLength + 64));
}

/**
 * Return the exact compiled Solana message covered by every transaction
 * signature. Wire transactions prefix that message with a compact-u16
 * signature count and one 64-byte slot per signer.
 */
export function readCompiledTransactionMessage(serializedTransaction: Uint8Array): Uint8Array {
  const { prefixLength, signatureCount } = readTransactionSignatureLayout(serializedTransaction);
  const messageOffset = prefixLength + signatureCount * 64;
  if (signatureCount < 1 || serializedTransaction.length <= messageOffset) {
    throw new Error('The serialized transaction does not contain a compiled message.');
  }
  return serializedTransaction.slice(messageOffset);
}

function readTransactionSignatureLayout(
  serializedTransaction: Uint8Array,
): TransactionSignatureLayout {
  let signatureCount = 0;
  let prefixLength = 0;
  let shift = 0;

  for (const byte of serializedTransaction) {
    signatureCount |= (byte & 0x7f) << shift;
    prefixLength += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 14) throw new Error('The signed transaction has an invalid signature count.');
  }

  if (prefixLength === 0 || ((serializedTransaction[prefixLength - 1] as number) & 0x80) !== 0) {
    throw new Error('The signed transaction has an invalid signature count.');
  }
  return { prefixLength, signatureCount };
}

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
