import type { SolanaCommitment } from './rpc-client';

/**
 * Client-side view of a broadcast transaction. The vocabulary deliberately
 * matches apps/api's transaction-monitor.types.ts (submitted → confirmed →
 * finalized, with expired for a run that outlives its blockhash) so the funding
 * stepper and the server reconciliation summary describe the same event with
 * the same word.
 */
export type ConfirmationPhase =
  | 'confirmed'
  | 'expired'
  | 'failed'
  | 'finalized'
  | 'processed'
  | 'submitted';

export const CONFIRMATION_TIMEOUT_MS = 90_000;
export const CONFIRMATION_POLL_INTERVAL_MS = 1_500;

const phaseRank: Record<ConfirmationPhase, number> = {
  confirmed: 2,
  expired: -1,
  failed: -1,
  finalized: 3,
  processed: 1,
  submitted: 0,
};

export function isTerminalPhase(phase: ConfirmationPhase): boolean {
  return phase === 'finalized' || phase === 'failed' || phase === 'expired';
}

/**
 * Folds one RPC poll into the running phase. getSignatureStatuses drops a
 * signature from its cache once it is old enough, and a validator can answer a
 * lower commitment than a previous poll did, so a naive assignment would walk a
 * confirmed transaction backwards to "submitted" and re-open a step the user
 * already watched close. Progress is therefore monotonic — only a failure or an
 * expiry may move it down.
 */
export function advanceConfirmation(
  current: ConfirmationPhase,
  poll: { commitment: SolanaCommitment | null; failed: boolean },
): ConfirmationPhase {
  if (poll.failed) return 'failed';
  if (isTerminalPhase(current)) return current;
  if (!poll.commitment) return current;
  return phaseRank[poll.commitment] > phaseRank[current] ? poll.commitment : current;
}

/**
 * A transaction that has reached `confirmed` is committed by supermajority and
 * will not be rolled back in practice; waiting for `finalized` only adds ~13
 * seconds of spinner. The stepper therefore unblocks at confirmed, and the
 * explorer link on the receipt is where finalization can be checked.
 */
export function isFundingSettled(phase: ConfirmationPhase): boolean {
  return phase === 'confirmed' || phase === 'finalized';
}

export function resolveConfirmationTimeout(
  phase: ConfirmationPhase,
  elapsedMs: number,
): ConfirmationPhase {
  if (isTerminalPhase(phase) || isFundingSettled(phase)) return phase;
  return elapsedMs >= CONFIRMATION_TIMEOUT_MS ? 'expired' : phase;
}

export type ConfirmationDescription = {
  detail: string;
  label: string;
  tone: 'danger' | 'pending' | 'success';
};

export function describeConfirmation(phase: ConfirmationPhase): ConfirmationDescription {
  switch (phase) {
    case 'confirmed':
      return {
        detail: 'A supermajority of validators has committed the transaction.',
        label: 'Confirmed',
        tone: 'success',
      };
    case 'expired':
      return {
        detail:
          'The network did not confirm in time. The blockhash may have expired — nothing was charged if the transaction never landed.',
        label: 'Timed out',
        tone: 'danger',
      };
    case 'failed':
      return {
        detail: 'The network rejected the transaction. No funds left the wallet.',
        label: 'Failed on-chain',
        tone: 'danger',
      };
    case 'finalized':
      return {
        detail: 'The transaction is finalized and irreversible.',
        label: 'Finalized',
        tone: 'success',
      };
    case 'processed':
      return {
        detail: 'A validator has processed the transaction. Waiting for cluster confirmation.',
        label: 'Processing',
        tone: 'pending',
      };
    default:
      return {
        detail: 'The signed transaction is broadcasting to the devnet cluster.',
        label: 'Broadcasting',
        tone: 'pending',
      };
  }
}
