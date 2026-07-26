import {
  advanceConfirmation,
  CONFIRMATION_POLL_INTERVAL_MS,
  type ConfirmationPhase,
  isFundingSettled,
  isTerminalPhase,
  resolveConfirmationTimeout,
} from './confirmation';
import { fetchSignatureCommitment, type SolanaCommitment } from './rpc-client';

export type ConfirmationPoll = { commitment: SolanaCommitment | null; failed: boolean };

export type TrackConfirmationOptions = {
  /** Called on every phase change, including the initial `submitted`. */
  onPhase?: (phase: ConfirmationPhase) => void;
  /** Injected in tests; defaults to the client-side getSignatureStatuses call. */
  poll?: (signature: string) => Promise<ConfirmationPoll>;
  /** Injected in tests so the deadline is reachable without real time passing. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Polls one broadcast signature until it is settled, failed, or past its
 * deadline, reporting every phase change as it goes.
 *
 * The loop stops at `confirmed` rather than `finalized` on purpose: confirmed
 * is committed by supermajority, and holding the funding step open for the
 * extra ~13 seconds of finalization would be spinner time the user gains
 * nothing from. The explorer link on the receipt shows finalization.
 *
 * A rejected poll is folded in as "no news" rather than a failure — an RPC
 * hiccup must not be reported to the player as a rejected transaction. Only an
 * `err` the cluster actually returned produces `failed`.
 */
export async function trackConfirmation(
  signature: string,
  options: TrackConfirmationOptions = {},
): Promise<ConfirmationPhase> {
  const poll = options.poll ?? ((value: string) => fetchSignatureCommitment(value));
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;

  const startedAt = now();
  let phase: ConfirmationPhase = 'submitted';
  options.onPhase?.(phase);

  while (!isTerminalPhase(phase) && !isFundingSettled(phase)) {
    if (options.signal?.aborted) return phase;

    let result: ConfirmationPoll;
    try {
      result = await poll(signature);
    } catch {
      result = { commitment: null, failed: false };
    }

    const next = resolveConfirmationTimeout(advanceConfirmation(phase, result), now() - startedAt);
    if (next !== phase) {
      phase = next;
      options.onPhase?.(phase);
    }
    if (isTerminalPhase(phase) || isFundingSettled(phase)) break;

    await sleep(CONFIRMATION_POLL_INTERVAL_MS);
  }

  return phase;
}
