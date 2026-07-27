export type WalletTransactionNotBroadcastReason = 'pre-broadcast-failure' | 'rejected';

export class WalletTransactionNotBroadcastError extends Error {
  readonly reason: WalletTransactionNotBroadcastReason;

  constructor(
    message = 'The wallet rejected the transaction. Nothing was broadcast.',
    reason: WalletTransactionNotBroadcastReason = 'rejected',
  ) {
    super(message);
    this.name = 'WalletTransactionNotBroadcastError';
    this.reason = reason;
  }
}

export function isExplicitWalletRejection(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code).toUpperCase()
      : '';
  if (code === '4001' || code === '-3' || code === 'ERROR_NOT_SIGNED') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(user|wallet)\b.*\b(reject(?:ed)?|declin(?:ed)?|cancel(?:led)?)\b/i.test(message);
}

/**
 * A sign-only wallet cannot have broadcast before returning signed bytes.
 *
 * Keep this classification separate from the combined sign-and-send path:
 * an arbitrary error from that path can arrive after broadcast and must remain
 * ambiguous unless the wallet explicitly identifies a user rejection.
 */
export function classifySignOnlyFailure(error: unknown): WalletTransactionNotBroadcastError {
  if (error instanceof WalletTransactionNotBroadcastError) return error;
  if (isExplicitWalletRejection(error)) return new WalletTransactionNotBroadcastError();
  return new WalletTransactionNotBroadcastError(
    'The wallet could not sign the transaction. Nothing was broadcast.',
    'pre-broadcast-failure',
  );
}
