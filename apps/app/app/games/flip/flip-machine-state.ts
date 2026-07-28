import type { ConfirmationPhase } from '../../solana/confirmation';
import type {
  GachaCapability,
  GachaInventorySnapshot,
  GachaOddsCommitment,
  GachaPaymentIntent,
  GachaRipResult,
  PreparedGachaPaymentTransaction,
} from '../../solana/gacha-client';
import type { FlipFundingPhase } from './flip-machine-flow';
import {
  DEFAULT_FLIP_MACHINE,
  FLIP_MACHINES,
  type FlipMachine as FlipMachineOption,
} from './flip-machines';
import type { FlipPaymentRecovery } from './flip-payment-recovery';

/**
 * Every value the Sports Pack Gacha client renders from.
 *
 * A rip is a linear sequence with a hard reset at each end — picking a new
 * machine and finishing a pull both drop the same nine fields — so the
 * transitions are a reducer rather than a dozen independent `useState` calls.
 * The reset then exists once, as one action, instead of being restated at every
 * call site that has to unwind a half-finished rip.
 */
export type FlipMachineState = {
  broadcastUnknown: boolean;
  capability: GachaCapability | null;
  capabilityError: string | null;
  commitmentId: string | null;
  confirmationPhase: ConfirmationPhase | null;
  error: string | null;
  fundingPhase: FlipFundingPhase;
  intent: GachaPaymentIntent | null;
  machine: FlipMachineOption;
  notice: string | null;
  odds: GachaOddsCommitment | null;
  pending: boolean;
  prepared: PreparedGachaPaymentTransaction | null;
  recovery: FlipPaymentRecovery | null;
  recoveryInvalid: boolean;
  result: GachaRipResult | null;
  serverSeedHash: string | null;
  signature: string | null;
  snapshot: GachaInventorySnapshot | null;
};

export type FlipMachineAction =
  | { capability: GachaCapability; type: 'capability-read' }
  | { message: string; type: 'capability-failed' }
  | { machine: FlipMachineOption; type: 'machine-selected' }
  | { odds: GachaOddsCommitment; snapshot: GachaInventorySnapshot; type: 'machine-priced' }
  | { message: string; type: 'machine-price-failed' }
  | { type: 'prepare-started' }
  | {
      commitmentId: string;
      intent: GachaPaymentIntent;
      prepared: PreparedGachaPaymentTransaction;
      serverSeedHash: string;
      type: 'prepare-succeeded';
    }
  | { prepared: PreparedGachaPaymentTransaction; type: 'preparation-refreshed' }
  | { prepared: PreparedGachaPaymentTransaction; type: 'prepared-updated' }
  | { message: string; type: 'prepare-failed' }
  | { record: FlipPaymentRecovery; stale: boolean; type: 'recovery-hydrated' }
  | { record: FlipPaymentRecovery; type: 'recovery-synchronized' }
  | { type: 'recovery-cleared' }
  | { type: 'recovery-invalid' }
  | { phase: FlipFundingPhase; type: 'funding-phase-changed' }
  | { phase: ConfirmationPhase; type: 'confirmation-phase-changed' }
  | { signature: string; type: 'transaction-broadcast' }
  | { notice: string | null; type: 'notice-posted' }
  | { result: GachaRipResult; type: 'rip-succeeded' }
  | { result: GachaRipResult; type: 'rip-provider-failed' }
  | { message: string; type: 'rip-failed' }
  | { message: string; type: 'rip-declined' }
  | { message: string; type: 'transaction-broadcast-unknown' }
  | { message: string; type: 'transaction-failed' }
  | { type: 'reset' };

/** The nine fields a rip owns. Reset drops all of them; the machine, its odds, and the capability survive. */
const IDLE_RIP = {
  broadcastUnknown: false,
  commitmentId: null,
  confirmationPhase: null,
  error: null,
  fundingPhase: 'idle',
  intent: null,
  notice: null,
  prepared: null,
  recovery: null,
  recoveryInvalid: false,
  result: null,
  serverSeedHash: null,
  signature: null,
} as const satisfies Partial<FlipMachineState>;

export const INITIAL_FLIP_MACHINE_STATE: FlipMachineState = {
  ...IDLE_RIP,
  capability: null,
  capabilityError: null,
  machine: DEFAULT_FLIP_MACHINE,
  odds: null,
  pending: false,
  snapshot: null,
};

export function flipMachineReducer(
  state: FlipMachineState,
  action: FlipMachineAction,
): FlipMachineState {
  switch (action.type) {
    case 'capability-read':
      return { ...state, capability: action.capability };
    case 'capability-failed':
      return { ...state, capabilityError: action.message };
    case 'machine-selected':
      if (hasUnresolvedPayment(state)) return state;
      // Switching pools invalidates the priced rip as well as the in-flight
      // one: the odds and the sealed inventory belong to the old machine.
      return {
        ...state,
        ...IDLE_RIP,
        machine: action.machine,
        odds: null,
        pending: false,
        snapshot: null,
      };
    case 'machine-priced':
      return { ...state, odds: action.odds, snapshot: action.snapshot };
    case 'machine-price-failed':
      return { ...state, error: action.message };
    case 'prepare-started':
      if (hasUnresolvedPayment(state)) return state;
      return { ...state, error: null, notice: null, pending: true };
    case 'prepare-succeeded':
      return {
        ...state,
        broadcastUnknown: false,
        commitmentId: action.commitmentId,
        intent: action.intent,
        pending: false,
        prepared: action.prepared,
        recovery: null,
        recoveryInvalid: false,
        serverSeedHash: action.serverSeedHash,
      };
    case 'preparation-refreshed':
      return {
        ...state,
        error: null,
        fundingPhase: 'idle',
        notice: 'The unsigned transaction was refreshed. Review it before approving.',
        prepared: action.prepared,
      };
    case 'prepared-updated':
      return { ...state, prepared: action.prepared };
    case 'prepare-failed':
      return { ...state, error: action.message, pending: false };
    case 'recovery-hydrated': {
      const recoveredMachine = FLIP_MACHINES.find(
        (candidate) => candidate.machineKey === action.record.machineKey,
      );
      const machineChanged =
        recoveredMachine !== undefined && recoveredMachine.machineKey !== state.machine.machineKey;
      return {
        ...state,
        broadcastUnknown: false,
        error: action.stale
          ? 'This saved payment is old, but it remains locked until Solana reconciliation is terminal.'
          : 'A saved payment was restored without opening another wallet prompt.',
        fundingPhase: 'recovering',
        machine: recoveredMachine ?? state.machine,
        notice: null,
        odds: machineChanged ? null : state.odds,
        recovery: action.record,
        recoveryInvalid: false,
        signature: action.record.signature,
        snapshot: machineChanged ? null : state.snapshot,
      };
    }
    case 'recovery-synchronized':
      return {
        ...state,
        broadcastUnknown: false,
        recovery: action.record,
        recoveryInvalid: false,
        signature: action.record.signature,
      };
    case 'recovery-invalid':
      return {
        ...state,
        broadcastUnknown: true,
        error:
          'Saved payment recovery data is unreadable. Another transfer is blocked until the prior payment is reconciled safely.',
        fundingPhase: 'recovering',
        notice: null,
        recovery: null,
        recoveryInvalid: true,
        signature: null,
      };
    case 'recovery-cleared':
      return {
        ...state,
        broadcastUnknown: false,
        error: null,
        fundingPhase: 'idle',
        recovery: null,
        recoveryInvalid: false,
        signature: null,
      };
    case 'funding-phase-changed':
      return { ...state, fundingPhase: action.phase };
    case 'confirmation-phase-changed':
      return { ...state, confirmationPhase: action.phase };
    case 'transaction-broadcast':
      return { ...state, broadcastUnknown: false, signature: action.signature };
    case 'notice-posted':
      return { ...state, notice: action.notice };
    case 'rip-succeeded':
      return {
        ...state,
        broadcastUnknown: false,
        error: null,
        fundingPhase: 'idle',
        notice: null,
        recovery: null,
        recoveryInvalid: false,
        result: action.result,
        signature: null,
      };
    case 'rip-provider-failed':
      return {
        ...state,
        broadcastUnknown: false,
        error: null,
        fundingPhase: 'idle',
        notice: null,
        recovery: null,
        recoveryInvalid: false,
        result: action.result,
        signature: null,
      };
    case 'rip-failed':
      // `recovering` rather than `idle`: the deposit may already be on chain,
      // so the panel has to offer recovery instead of a fresh rip.
      return { ...state, error: action.message, fundingPhase: 'recovering', notice: null };
    case 'rip-declined':
      // A declined wallet prompt never broadcast, so this is `idle` and not
      // `recovering` — there is nothing on chain to recover.
      return {
        ...state,
        broadcastUnknown: false,
        error: action.message,
        fundingPhase: 'idle',
        notice: null,
        recovery: null,
        recoveryInvalid: false,
        signature: null,
      };
    case 'transaction-broadcast-unknown':
      // Without a signature the client cannot reconcile yet, but a generic
      // signer/RPC failure is not proof that nothing landed. Keep the intent
      // blocked so recovery cannot prepare or sign a duplicate transfer.
      return {
        ...state,
        broadcastUnknown: true,
        error: action.message,
        fundingPhase: 'recovering',
        notice: null,
        signature: null,
      };
    case 'transaction-failed':
      // A cluster-reported failure is definitive: no payment landed, so clear
      // the old signature and let recovery refresh this same pending intent.
      return {
        ...state,
        broadcastUnknown: false,
        error: action.message,
        fundingPhase: 'recovering',
        notice: null,
        recovery: null,
        recoveryInvalid: false,
        signature: null,
      };
    case 'reset':
      if (hasUnresolvedPayment(state)) return state;
      return { ...state, ...IDLE_RIP, pending: false };
  }
}

function hasUnresolvedPayment(state: FlipMachineState): boolean {
  return Boolean(
    state.broadcastUnknown || state.recovery || state.recoveryInvalid || state.signature,
  );
}
