import { type ConfirmationPhase, describeConfirmation } from '../../solana/confirmation';
import {
  claimGachaPaymentSignature,
  createGachaPaymentIntent,
  createGachaRip,
  createGachaSeedCommitment,
  type GachaPaymentIntent,
  type GachaRipResult,
  isTerminalGachaExecutionFailure,
  type PreparedGachaPaymentTransaction,
  prepareGachaPaymentTransaction,
  verifyGachaPayment,
} from '../../solana/gacha-client';
import { trackConfirmation } from '../../solana/track-confirmation';
import {
  broadcastSignedTransaction,
  readCompiledTransactionMessage,
  readSignedTransactionSignature,
  type SignedWalletTransaction,
} from '../../solana/wallet-transaction';
import { WalletTransactionNotBroadcastError } from '../../solana/wallet-transaction-error';
import { createClientSeed, type FlipFundingPhase } from './flip-machine-flow';
import type { FlipMachineAction } from './flip-machine-state';

/**
 * The two multi-step rip sequences, lifted out of the component.
 *
 * The workspace has no DOM test environment, so a `useCallback` body never runs
 * under `bun test`. Every network call is therefore injected through an `io`
 * object that defaults to the real client — a test supplies its own and drives
 * each branch directly, without `mock.module`, which is process-wide in Bun and
 * would leak into every later test file.
 *
 * Intermediate progress is reported through callbacks because the panel has to
 * move while the sequence is still running; the terminal state comes back as a
 * return value so the caller decides what to do with a stale machine.
 */

export function describeFlipError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/** Mirrors the decode in `duel-arena.tsx` — the server serialises, the wallet signs raw bytes. */
export function decodeBase64Transaction(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function preparedTransactionExpired(
  prepared: PreparedGachaPaymentTransaction,
  now: number,
): boolean {
  const expiresAt = Date.parse(prepared.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

/**
 * Bind the review terms to the exact bytes sent to the wallet.
 *
 * The API deliberately repeats the intent fields next to the transaction. They
 * are not decorative: checking them here prevents a stale or mismatched response
 * from showing one deposit while asking the wallet to sign another.
 */
export async function validatePreparedTransaction(
  intent: GachaPaymentIntent,
  prepared: PreparedGachaPaymentTransaction,
  bytes: Uint8Array,
  now: number,
  hashBytes: (value: Uint8Array) => Promise<string> = sha256Hex,
): Promise<void> {
  if (preparedTransactionExpired(prepared, now)) {
    throw new Error('The unsigned transaction expired before approval.');
  }
  if (
    prepared.intentId !== intent.intentId ||
    prepared.memoNonce !== intent.memoNonce ||
    prepared.amountMinor !== intent.amountMinor
  ) {
    throw new Error('The unsigned transaction does not match the reviewed payment intent.');
  }
  const actualHash = await hashBytes(readCompiledTransactionMessage(bytes));
  if (actualHash !== prepared.expectedMessageHash) {
    throw new Error('The unsigned transaction changed after it was prepared.');
  }
}

export type FlipPrepareIo = {
  createPaymentIntent: typeof createGachaPaymentIntent;
  createSeedCommitment: typeof createGachaSeedCommitment;
  prepareTransaction: typeof prepareGachaPaymentTransaction;
};

export const DEFAULT_FLIP_PREPARE_IO: FlipPrepareIo = {
  createPaymentIntent: createGachaPaymentIntent,
  createSeedCommitment: createGachaSeedCommitment,
  prepareTransaction: prepareGachaPaymentTransaction,
};

export type FlipPrepareOutcome =
  | {
      commitmentId: string;
      intent: GachaPaymentIntent;
      prepared: PreparedGachaPaymentTransaction;
      serverSeedHash: string;
      status: 'prepared';
    }
  | {
      commitmentId: string;
      intent: GachaPaymentIntent;
      serverSeedHash: string;
      status: 'resumed';
    }
  | { message: string; status: 'failed' };

/**
 * Seals the seed, prices the rip, and builds the transfer the wallet will sign.
 *
 * The seed commitment is taken first on purpose: the hash has to exist before
 * the player is shown a price, or the odds would not be provably pre-committed.
 */
export async function prepareFlipRip(
  input: { address: string; machineKey: string },
  io: FlipPrepareIo = DEFAULT_FLIP_PREPARE_IO,
): Promise<FlipPrepareOutcome> {
  try {
    const commitment = await io.createSeedCommitment(input.machineKey);
    const intent = await io.createPaymentIntent(input.machineKey, input.address);
    if (intent.signature) {
      return {
        commitmentId: commitment.commitmentId,
        intent,
        serverSeedHash: commitment.serverSeedHash,
        status: 'resumed',
      };
    }
    const prepared = await io.prepareTransaction(intent.intentId);
    return {
      commitmentId: commitment.commitmentId,
      intent,
      prepared,
      serverSeedHash: commitment.serverSeedHash,
      status: 'prepared',
    };
  } catch (cause: unknown) {
    return {
      message: describeFlipError(cause, 'The deposit could not be prepared.'),
      status: 'failed',
    };
  }
}

export type FlipConfirmIo = {
  broadcastTransaction: (signed: Uint8Array) => Promise<string>;
  claimSignature: typeof claimGachaPaymentSignature;
  createPaymentIntent: typeof createGachaPaymentIntent;
  createRip: typeof createGachaRip;
  decodeTransaction: (base64: string) => Uint8Array;
  hashBytes: (bytes: Uint8Array) => Promise<string>;
  now: () => number;
  prepareTransaction: typeof prepareGachaPaymentTransaction;
  signTransaction: (bytes: Uint8Array) => Promise<SignedWalletTransaction>;
  track: (
    signature: string,
    options: { onPhase: (phase: ConfirmationPhase) => void },
  ) => Promise<ConfirmationPhase>;
  verifyPayment: typeof verifyGachaPayment;
};

/** Binds the wallet's signer to the real network calls. */
export function createFlipConfirmIo(
  signTransaction: (bytes: Uint8Array) => Promise<SignedWalletTransaction>,
): FlipConfirmIo {
  return {
    broadcastTransaction: (signed) => broadcastSignedTransaction(signed),
    claimSignature: claimGachaPaymentSignature,
    createPaymentIntent: createGachaPaymentIntent,
    createRip: createGachaRip,
    decodeTransaction: decodeBase64Transaction,
    hashBytes: sha256Hex,
    now: () => Date.now(),
    prepareTransaction: prepareGachaPaymentTransaction,
    signTransaction,
    track: trackConfirmation,
    verifyPayment: verifyGachaPayment,
  };
}

export type FlipConfirmEvents = {
  /** The deposit moved, so the cached wallet balances are stale. */
  onBalancesStale: (mint: string, sourceTokenAccount: string | null) => void;
  /** Persists a fail-closed recovery lock before the wallet can broadcast. */
  onBroadcastPending: (prepared: PreparedGachaPaymentTransaction) => boolean;
  onConfirmationPhase: (phase: ConfirmationPhase) => void;
  onFundingPhase: (phase: FlipFundingPhase) => void;
  onNotice: (notice: string | null) => void;
  onPrepared: (prepared: PreparedGachaPaymentTransaction) => void;
  /** Persists the exact signed bytes before the first server claim attempt. */
  onSignedTransaction: (signed: SignedWalletTransaction) => boolean;
  onSignature: (signature: string) => void;
};

type FlipMachineDispatch = (action: FlipMachineAction) => void;

/**
 * Keeps progress-event wiring out of the hook body so every transition remains
 * directly testable without a DOM environment.
 */
export function createFlipConfirmEvents(
  dispatch: FlipMachineDispatch,
  refreshBalances: (mint: string, sourceTokenAccount: string | null) => unknown,
): FlipConfirmEvents {
  return {
    onBalancesStale: (mint, sourceTokenAccount) => {
      refreshBalances(mint, sourceTokenAccount);
    },
    onBroadcastPending: () => true,
    onConfirmationPhase: (phase) => dispatch({ phase, type: 'confirmation-phase-changed' }),
    onFundingPhase: (phase) => dispatch({ phase, type: 'funding-phase-changed' }),
    onNotice: (notice) => dispatch({ notice, type: 'notice-posted' }),
    onPrepared: (prepared) => dispatch({ prepared, type: 'prepared-updated' }),
    onSignedTransaction: () => true,
    onSignature: (signature) => dispatch({ signature, type: 'transaction-broadcast' }),
  };
}

export type FlipConfirmOutcome =
  | { result: GachaRipResult; status: 'ripped' }
  | { result: GachaRipResult; status: 'provider-failed' }
  | { message: string; status: 'ambiguous' }
  | { message: string; status: 'declined' }
  | { message: string; status: 'retryable' }
  | { message: string; status: 'failed' };

/** Only proven-not-broadcast or terminal chain outcomes may release the durable lock. */
export function flipOutcomeClearsRecovery(outcome: FlipConfirmOutcome): boolean {
  return (
    outcome.status === 'ripped' ||
    outcome.status === 'provider-failed' ||
    outcome.status === 'declined' ||
    outcome.status === 'retryable'
  );
}

/** Converts a terminal funding result into its single reducer transition. */
export function flipConfirmOutcomeAction(outcome: FlipConfirmOutcome): FlipMachineAction {
  switch (outcome.status) {
    case 'ripped':
      return { result: outcome.result, type: 'rip-succeeded' };
    case 'provider-failed':
      return { result: outcome.result, type: 'rip-provider-failed' };
    case 'ambiguous':
      return { message: outcome.message, type: 'transaction-broadcast-unknown' };
    case 'declined':
      return { message: outcome.message, type: 'rip-declined' };
    case 'retryable':
      return { message: outcome.message, type: 'transaction-failed' };
    case 'failed':
      return { message: outcome.message, type: 'rip-failed' };
  }
}

export type FlipConfirmInput = {
  address: string;
  commitmentId: string;
  intent: GachaPaymentIntent;
  machineKey: string;
  oddsVersion: number;
  prepared: PreparedGachaPaymentTransaction;
  serverSeedHash: string;
  seed?: string;
};

export type FlipResumeInput = {
  address: string;
  commitmentId: string;
  intentId: string;
  machineKey: string;
  mint: string;
  oddsVersion: number;
  serverSeedHash: string;
  sourceTokenAccount: string | null;
  seed?: string;
};

export function createFlipResumeInput(
  input: FlipConfirmInput,
  prepared: PreparedGachaPaymentTransaction = input.prepared,
): FlipResumeInput {
  return {
    address: input.address,
    commitmentId: input.commitmentId,
    intentId: input.intent.intentId,
    machineKey: input.machineKey,
    mint: input.intent.mint,
    oddsVersion: input.oddsVersion,
    serverSeedHash: input.serverSeedHash,
    sourceTokenAccount: prepared.sourceTokenAccount,
    seed: input.seed,
  };
}

/**
 * Signs the deposit, waits for the cluster, verifies it, then rips.
 */
export async function confirmFlipRip(
  input: FlipConfirmInput,
  events: FlipConfirmEvents,
  io: FlipConfirmIo,
): Promise<FlipConfirmOutcome> {
  events.onFundingPhase('signing');
  events.onNotice(null);
  let signedTransaction: SignedWalletTransaction | null = null;
  let walletRequestStarted = false;
  let claimStarted = false;
  let broadcastStarted = false;
  try {
    let prepared = input.prepared;
    if (preparedTransactionExpired(prepared, io.now())) {
      prepared = await io.prepareTransaction(input.intent.intentId);
      events.onPrepared(prepared);
    }
    const bytes = io.decodeTransaction(prepared.serializedTransactionBase64);
    await validatePreparedTransaction(input.intent, prepared, bytes, io.now(), io.hashBytes);
    if (!events.onBroadcastPending(prepared)) {
      throw new WalletTransactionNotBroadcastError(
        'Recovery could not be saved in this browser. Nothing was broadcast.',
        'pre-broadcast-failure',
      );
    }
    walletRequestStarted = true;
    signedTransaction = await io.signTransaction(bytes);
    if (!events.onSignedTransaction(signedTransaction)) {
      throw new WalletTransactionNotBroadcastError(
        'The signed payment could not be saved for recovery. Nothing was claimed or broadcast.',
        'pre-broadcast-failure',
      );
    }
    claimStarted = true;
    const authority = await claimOrRecoverSignature(input, signedTransaction, io);
    if (authority.signature !== signedTransaction.signature) {
      events.onSignature(authority.signature);
      return {
        message:
          'Another tab or device claimed this payment first. Its transfer is now the only one that can be reconciled.',
        status: 'failed',
      };
    }
    broadcastStarted = true;
    const signature = await io.broadcastTransaction(signedTransaction.serializedTransaction);
    if (signature !== signedTransaction.signature) {
      throw new Error('The Solana RPC returned a different transaction signature.');
    }
    events.onSignature(signature);
    return await completeBroadcastFlipRip(
      createFlipResumeInput(input, prepared),
      signature,
      events,
      io,
    );
  } catch (cause: unknown) {
    if (!signedTransaction) {
      if (!walletRequestStarted && !(cause instanceof WalletTransactionNotBroadcastError)) {
        return {
          message: describeFlipError(cause, 'The deposit could not be validated.'),
          status: 'failed',
        };
      }
      return {
        message:
          cause instanceof WalletTransactionNotBroadcastError && cause.reason === 'rejected'
            ? 'You declined the transfer in your wallet. Nothing was charged.'
            : describeFlipError(cause, 'The wallet could not sign. Nothing was broadcast.'),
        status: 'declined',
      };
    }
    if (claimStarted && !broadcastStarted) {
      return {
        message:
          'The server signature claim could not be reconciled. Nothing was broadcast, and this intent remains locked for safe recovery.',
        status: 'failed',
      };
    }
    return {
      message: describeFlipError(cause, 'The rip could not be completed.'),
      status: 'failed',
    };
  }
}

/**
 * A lost claim response is reconciled through createIntent's active-payment
 * replay. Only the server's claimed signature is authoritative.
 */
export async function claimOrRecoverSignature(
  input: { address: string; intentId?: string; intent?: GachaPaymentIntent; machineKey: string },
  signed: SignedWalletTransaction,
  io: Pick<FlipConfirmIo, 'claimSignature' | 'createPaymentIntent'>,
): Promise<GachaPaymentIntent & { signature: string }> {
  const intentId = input.intentId ?? input.intent?.intentId;
  if (!intentId) throw new Error('The payment intent id is required for signature recovery.');
  try {
    const claimed = await io.claimSignature(intentId, signed.signedTransactionBase64);
    if (!isAuthoritativeIntent(claimed, { ...input, intentId })) {
      throw new Error('The payment signature claim returned a mismatched active intent.');
    }
    return claimed;
  } catch (claimError: unknown) {
    let active: GachaPaymentIntent;
    try {
      active = await io.createPaymentIntent(input.machineKey, input.address);
    } catch {
      throw claimError;
    }
    if (!isAuthoritativeIntent(active, { ...input, intentId })) {
      throw claimError;
    }
    return active;
  }
}

function isAuthoritativeIntent(
  intent: GachaPaymentIntent,
  input: { address: string; intentId: string; machineKey: string },
): intent is GachaPaymentIntent & { signature: string } {
  return (
    intent.resumed &&
    intent.intentId === input.intentId &&
    intent.machineKey === input.machineKey &&
    intent.payerWallet === input.address &&
    intent.signature !== null
  );
}

/**
 * Reload recovery for bytes that were signed but whose claim/broadcast response
 * was interrupted. The exact same transaction is re-claimed and, only after
 * server authority agrees, re-broadcast without opening the wallet.
 */
export async function reconcileSignedFlipRip(
  input: FlipResumeInput & { signedTransactionBase64: string },
  signature: string,
  events: FlipConfirmEvents,
  io: FlipConfirmIo,
): Promise<FlipConfirmOutcome> {
  events.onFundingPhase('signing');
  events.onNotice(null);
  try {
    const serializedTransaction = io.decodeTransaction(input.signedTransactionBase64);
    if (readSignedTransactionSignature(serializedTransaction) !== signature) {
      throw new Error(
        'The saved signed payment does not match its recovery signature. Recovery remains locked.',
      );
    }
    const signed: SignedWalletTransaction = {
      serializedTransaction,
      signature,
      signedTransactionBase64: input.signedTransactionBase64,
    };
    const authority = await claimOrRecoverSignature(
      {
        address: input.address,
        intentId: input.intentId,
        machineKey: input.machineKey,
      },
      signed,
      io,
    );
    if (authority.signature !== signature) {
      events.onSignature(authority.signature);
      return await completeBroadcastFlipRip(input, authority.signature, events, io);
    }
    const broadcastSignature = await io.broadcastTransaction(signed.serializedTransaction);
    if (broadcastSignature !== signature) {
      throw new Error('The Solana RPC returned a different transaction signature.');
    }
    events.onSignature(signature);
    return await completeBroadcastFlipRip(input, signature, events, io);
  } catch (cause: unknown) {
    return {
      message: describeFlipError(
        cause,
        'The saved signed payment could not be reconciled. No new transfer was created.',
      ),
      status: 'failed',
    };
  }
}

/** Resume an already-broadcast deposit without opening another wallet prompt. */
export async function resumeFlipRip(
  input: FlipResumeInput,
  signature: string,
  events: FlipConfirmEvents,
  io: FlipConfirmIo,
): Promise<FlipConfirmOutcome> {
  events.onNotice(null);
  try {
    return await completeBroadcastFlipRip(input, signature, events, io);
  } catch (cause: unknown) {
    return {
      message: describeFlipError(cause, 'The rip could not be resumed.'),
      status: 'failed',
    };
  }
}

async function completeBroadcastFlipRip(
  input: FlipResumeInput,
  signature: string,
  events: FlipConfirmEvents,
  io: FlipConfirmIo,
): Promise<FlipConfirmOutcome> {
  events.onFundingPhase('confirming');
  const settledPhase = await io.track(signature, { onPhase: events.onConfirmationPhase });
  let paymentVerified = false;
  if (settledPhase === 'failed') {
    events.onFundingPhase('verifying');
    try {
      await io.verifyPayment(input.intentId, signature);
      paymentVerified = true;
    } catch (cause: unknown) {
      if (isTerminalGachaExecutionFailure(cause)) {
        return { message: describeConfirmation(settledPhase).detail, status: 'retryable' };
      }
      return {
        message:
          'The failed transaction could not be reconciled with the server. This payment remains locked until reconciliation succeeds.',
        status: 'failed',
      };
    }
  }
  if (settledPhase === 'expired') {
    // This is a local polling deadline, not proof that the transaction never
    // landed. Keep recovery locked so a late confirmation cannot be double-paid.
    return { message: describeConfirmation(settledPhase).detail, status: 'failed' };
  }

  events.onBalancesStale(input.mint, input.sourceTokenAccount);
  events.onFundingPhase('verifying');
  if (!paymentVerified) await io.verifyPayment(input.intentId, signature);
  events.onNotice('Deposit confirmed on Solana devnet. Revealing the committed rip…');

  events.onFundingPhase('ripping');
  const result = await io.createRip({
    commitmentId: input.commitmentId,
    machineKey: input.machineKey,
    oddsVersion: input.oddsVersion,
    paymentIntentId: input.intentId,
    recipientWallet: input.address,
    seed: input.seed ?? createClientSeed(),
  });
  await verifyServerSeedProof(result, input.serverSeedHash, io.hashBytes);
  if (result.rip.status === 'FAILED') return { result, status: 'provider-failed' };
  return { result, status: 'ripped' };
}

export async function verifyServerSeedProof(
  result: GachaRipResult,
  committedHash: string,
  hashBytes: (value: Uint8Array) => Promise<string> = sha256Hex,
): Promise<void> {
  if (!result.serverSeed || !result.serverSeedHash) {
    throw new Error('The settled rip did not reveal its server seed proof.');
  }
  if (result.serverSeedHash !== committedHash) {
    throw new Error('The revealed server seed does not match the pre-payment commitment.');
  }
  const revealedHash = await hashBytes(new TextEncoder().encode(result.serverSeed));
  if (revealedHash !== committedHash) {
    throw new Error('The revealed server seed failed commitment verification.');
  }
}
