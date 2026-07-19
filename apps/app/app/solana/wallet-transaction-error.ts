export class WalletTransactionNotBroadcastError extends Error {
  constructor(message = 'The wallet rejected the transaction. Nothing was broadcast.') {
    super(message);
    this.name = 'WalletTransactionNotBroadcastError';
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
