import type { DuelStatus } from '../domain.js';

const ALLOWED_TRANSITIONS: Readonly<Record<DuelStatus, readonly DuelStatus[]>> = {
  awaiting_assets: ['settling', 'refunding', 'failed'],
  cancelled: [],
  cancelling: ['cancelled', 'refunding', 'failed'],
  committing: ['funded', 'cancelled', 'refunding', 'failed'],
  failed: ['refunding'],
  funded: ['opening', 'refunding', 'failed'],
  matched: ['committing', 'cancelled', 'failed'],
  opening: ['awaiting_assets', 'refunding', 'failed'],
  refunded: [],
  refunding: ['refunded', 'failed'],
  settled: [],
  settling: ['settled', 'refunding', 'failed'],
  waiting: ['matched', 'cancelled', 'failed'],
};

export function canTransition(from: DuelStatus, to: DuelStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function recoveryStatusAfterTransactionFailure(status: DuelStatus): DuelStatus | null {
  if (['awaiting_assets', 'committing', 'funded', 'opening', 'settling'].includes(status)) {
    return 'refunding';
  }
  if (canTransition(status, 'failed')) return 'failed';
  return null;
}

export function isTransactionTransition(action: string, from: DuelStatus, to: DuelStatus): boolean {
  if (action === 'fund') return from === 'committing' && to === 'funded';
  if (action === 'settle') return from === 'settling' && to === 'settled';
  if (action === 'refund') return from === 'refunding' && to === 'refunded';
  if (action === 'cancel') return from === 'cancelling' && to === 'cancelled';
  return false;
}
