import { readSignedTransactionSignature } from '../../solana/wallet-transaction';

type FlipRecoveryStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

type PersistedFlipPaymentRecovery = Partial<FlipPaymentRecoveryBase> & {
  signature?: unknown;
  signedTransactionBase64?: unknown;
  status?: string;
  version?: number;
};

export const FLIP_PAYMENT_RECOVERY_STORAGE_KEY = 'dailydraft:flip-payment-recovery:v3';
export const FLIP_PAYMENT_RECOVERY_V2_STORAGE_KEY = 'dailydraft:flip-payment-recovery:v2';
export const FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY = 'dailydraft:flip-payment-recovery:v1';
export const FLIP_PAYMENT_RECOVERY_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

type FlipPaymentRecoveryBase = {
  commitmentId: string;
  intentId: string;
  machineKey: string;
  mint: string;
  oddsVersion: number;
  payerWallet: string;
  serverSeedHash: string;
  sourceTokenAccount: string | null;
  updatedAt: string;
  version: 3;
};

export type FlipPaymentRecovery =
  | (FlipPaymentRecoveryBase & {
      signature: null;
      signedTransactionBase64: null;
      status: 'awaiting-signature';
    })
  | (FlipPaymentRecoveryBase & {
      signature: string;
      signedTransactionBase64: string;
      status: 'signed-claim-pending';
    })
  | (FlipPaymentRecoveryBase & {
      signature: string;
      signedTransactionBase64: null;
      status: 'signature-known';
    });

export type FlipPaymentRecoveryRead =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { record: FlipPaymentRecovery; stale: boolean; status: 'valid' };

export type FlipPaymentRecoveryInput = Omit<FlipPaymentRecoveryBase, 'updatedAt' | 'version'>;

export function createAwaitingFlipPaymentRecovery(
  input: FlipPaymentRecoveryInput,
  updatedAt = new Date().toISOString(),
): FlipPaymentRecovery {
  return {
    ...input,
    signature: null,
    signedTransactionBase64: null,
    status: 'awaiting-signature',
    updatedAt,
    version: 3,
  };
}

export function attachFlipSignedTransaction(
  record: FlipPaymentRecovery,
  signed: { signature: string; signedTransactionBase64: string },
  updatedAt = new Date().toISOString(),
): FlipPaymentRecovery {
  return {
    ...record,
    signature: signed.signature,
    signedTransactionBase64: signed.signedTransactionBase64,
    status: 'signed-claim-pending',
    updatedAt,
  };
}

export function attachFlipPaymentSignature(
  record: FlipPaymentRecovery,
  signature: string,
  updatedAt = new Date().toISOString(),
): FlipPaymentRecovery {
  return {
    ...record,
    signature,
    signedTransactionBase64: null,
    status: 'signature-known',
    updatedAt,
  };
}

/**
 * Reads a durable recovery lock without ever aging it out.
 *
 * A stale transfer can confirm late, so age changes only the copy shown to the
 * player. Malformed and unsupported records fail closed and remain in storage;
 * silently deleting one would reopen the signer with unresolved chain state.
 */
export function readFlipPaymentRecovery(
  storage: FlipRecoveryStorage,
  now = Date.now(),
): FlipPaymentRecoveryRead {
  let rawValue: string | null;
  try {
    rawValue = storage.getItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY);
    if (!rawValue) rawValue = storage.getItem(FLIP_PAYMENT_RECOVERY_V2_STORAGE_KEY);
    if (!rawValue) rawValue = storage.getItem(FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY);
  } catch {
    return { status: 'invalid' };
  }
  if (!rawValue) return { status: 'empty' };

  try {
    const parsed = JSON.parse(rawValue) as PersistedFlipPaymentRecovery;
    const parsedVersion = parsed.version;
    const record = migrateFlipPaymentRecovery(parsed);
    if (!record || !isFlipPaymentRecovery(record, now)) return { status: 'invalid' };
    if (parsedVersion !== 3) {
      try {
        storage.setItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(record));
        storage.removeItem(FLIP_PAYMENT_RECOVERY_V2_STORAGE_KEY);
        storage.removeItem(FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY);
      } catch {
        // The valid in-memory migration remains usable. The legacy record stays
        // fail-closed and can be retried when storage becomes writable.
      }
    }
    const updatedAt = Date.parse(record.updatedAt);
    return {
      record,
      stale: now - updatedAt > FLIP_PAYMENT_RECOVERY_STALE_AFTER_MS,
      status: 'valid',
    };
  } catch {
    return { status: 'invalid' };
  }
}

export function storeFlipPaymentRecovery(
  storage: FlipRecoveryStorage,
  record: FlipPaymentRecovery,
): boolean {
  try {
    storage.setItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearFlipPaymentRecovery(storage: Pick<Storage, 'removeItem'>): boolean {
  try {
    storage.removeItem(FLIP_PAYMENT_RECOVERY_STORAGE_KEY);
    storage.removeItem(FLIP_PAYMENT_RECOVERY_V2_STORAGE_KEY);
    storage.removeItem(FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function isFlipPaymentRecovery(
  value: Partial<FlipPaymentRecovery>,
  now: number,
): value is FlipPaymentRecovery {
  const updatedAt = typeof value.updatedAt === 'string' ? Date.parse(value.updatedAt) : Number.NaN;
  const signatureValid =
    value.status === 'awaiting-signature'
      ? value.signature === null && value.signedTransactionBase64 === null
      : value.status === 'signed-claim-pending'
        ? isSignature(value.signature) &&
          readPersistedTransactionSignature(value.signedTransactionBase64) === value.signature
        : value.status === 'signature-known' &&
          isSignature(value.signature) &&
          value.signedTransactionBase64 === null;

  return (
    value.version === 3 &&
    signatureValid &&
    isBoundedIdentifier(value.commitmentId) &&
    isBoundedIdentifier(value.intentId) &&
    isBoundedIdentifier(value.machineKey) &&
    isSolanaAddress(value.mint) &&
    Number.isInteger(value.oddsVersion) &&
    (value.oddsVersion as number) > 0 &&
    isSolanaAddress(value.payerWallet) &&
    typeof value.serverSeedHash === 'string' &&
    /^[a-f0-9]{64}$/.test(value.serverSeedHash) &&
    (value.sourceTokenAccount === null || isSolanaAddress(value.sourceTokenAccount)) &&
    Number.isFinite(updatedAt) &&
    updatedAt - now <= 60_000
  );
}

function migrateFlipPaymentRecovery(
  value: PersistedFlipPaymentRecovery,
): FlipPaymentRecovery | null {
  if (value.version === 3) return value as FlipPaymentRecovery;
  if (
    value.version === 2 &&
    (value.status === 'broadcast-unknown' ||
      value.status === 'signed-claim-pending' ||
      value.status === 'signature-known')
  ) {
    return {
      ...(value as unknown as FlipPaymentRecoveryBase),
      signature: value.signature ?? null,
      signedTransactionBase64: value.signedTransactionBase64 ?? null,
      status: value.status === 'broadcast-unknown' ? 'awaiting-signature' : value.status,
      version: 3,
    } as FlipPaymentRecovery;
  }
  // V1 `broadcast-unknown` came from combined sign-and-send wallets. A crash
  // could therefore happen after broadcast but before the signature callback,
  // so that legacy state must remain invalid/fail-closed instead of being
  // reclassified as a sign-only pre-broadcast record.
  if (value.version !== 1 || value.status !== 'signature-known') {
    return null;
  }
  return {
    ...(value as unknown as FlipPaymentRecoveryBase),
    signature: value.signature ?? null,
    signedTransactionBase64: null,
    status: 'signature-known',
    version: 3,
  } as FlipPaymentRecovery;
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
}

function isSolanaAddress(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function isSignature(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value);
}

function readPersistedTransactionSignature(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 88 || value.length > 4_096) return null;
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    if (bytes.length < 65 || toBase64(bytes) !== value) return null;
    return readSignedTransactionSignature(bytes);
  } catch {
    return null;
  }
}

function toBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
