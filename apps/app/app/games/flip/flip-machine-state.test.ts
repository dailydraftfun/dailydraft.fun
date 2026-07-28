import { describe, expect, test } from 'bun:test';
import type {
  GachaCapability,
  GachaInventorySnapshot,
  GachaOddsCommitment,
  GachaPaymentIntent,
  GachaRipResult,
  PreparedGachaPaymentTransaction,
} from '../../solana/gacha-client';
import {
  type FlipMachineAction,
  type FlipMachineState,
  flipMachineReducer,
  INITIAL_FLIP_MACHINE_STATE,
} from './flip-machine-state';
import { FLIP_MACHINES } from './flip-machines';
import {
  attachFlipPaymentSignature,
  attachFlipSignedTransaction,
  createAwaitingFlipPaymentRecovery,
} from './flip-payment-recovery';

const CAPABILITY: GachaCapability = {
  availability: 'playable',
  gates: { acquisition: true, odds: true, provider: true, settlement: true },
  providerMode: 'dailydraft-devnet',
  reason: 'Every gate is open on devnet.',
};

const ODDS = { id: 'gachaodds_1', machineKey: 'm' } as unknown as GachaOddsCommitment;
const SNAPSHOT = { id: 'gachasnap_1', machineKey: 'm' } as unknown as GachaInventorySnapshot;
const INTENT = { intentId: 'gachaintent_1', mint: 'mint' } as unknown as GachaPaymentIntent;
const PREPARED = { intentId: 'gachaintent_1' } as unknown as PreparedGachaPaymentTransaction;
const RESULT = { serverSeed: 'seed' } as unknown as GachaRipResult;
const PROVIDER_FAILED_RESULT = {
  rip: { id: 'gacharip_failed', status: 'FAILED' },
  serverSeed: 'seed',
} as GachaRipResult;
const RECOVERY = createAwaitingFlipPaymentRecovery(
  {
    commitmentId: 'gachaseed_1',
    intentId: 'gachapay_1',
    machineKey: 'dailydraft-devnet-football-50000000',
    mint: 'M'.repeat(32),
    oddsVersion: 3,
    payerWallet: 'P'.repeat(32),
    serverSeedHash: 's'.repeat(64),
    sourceTokenAccount: 'S'.repeat(32),
  },
  '2026-07-26T00:00:00.000Z',
);
const KNOWN_RECOVERY = attachFlipPaymentSignature(RECOVERY, 'Z'.repeat(88));
const SIGNED_RECOVERY = attachFlipSignedTransaction(RECOVERY, {
  signature: 'Y'.repeat(88),
  signedTransactionBase64: Buffer.from(Uint8Array.from([1, ...new Uint8Array(64), 2])).toString(
    'base64',
  ),
});

/** Replays actions from the initial state so each case starts from a real prior state. */
function reduce(...actions: FlipMachineAction[]): FlipMachineState {
  return actions.reduce(flipMachineReducer, INITIAL_FLIP_MACHINE_STATE);
}

/** Walks a rip all the way to a broadcast deposit, which is what the resets unwind. */
const IN_FLIGHT: FlipMachineAction[] = [
  { capability: CAPABILITY, type: 'capability-read' },
  { odds: ODDS, snapshot: SNAPSHOT, type: 'machine-priced' },
  { type: 'prepare-started' },
  {
    commitmentId: 'gachaseed_1',
    intent: INTENT,
    prepared: PREPARED,
    serverSeedHash: 's'.repeat(64),
    type: 'prepare-succeeded',
  },
  { phase: 'confirming', type: 'funding-phase-changed' },
  { phase: 'processed', type: 'confirmation-phase-changed' },
  { signature: 'sig', type: 'transaction-broadcast' },
  { notice: 'Deposit sent.', type: 'notice-posted' },
];

describe('flip machine state', () => {
  test('starts with no machine data and the first machine selected', () => {
    expect(INITIAL_FLIP_MACHINE_STATE.machine).toBe(FLIP_MACHINES[0] as never);
    expect(INITIAL_FLIP_MACHINE_STATE.capability).toBeNull();
    expect(INITIAL_FLIP_MACHINE_STATE.fundingPhase).toBe('idle');
    expect(INITIAL_FLIP_MACHINE_STATE.broadcastUnknown).toBe(false);
    expect(INITIAL_FLIP_MACHINE_STATE.pending).toBe(false);
  });

  test('records the capability read and its failure independently', () => {
    expect(reduce({ capability: CAPABILITY, type: 'capability-read' }).capability).toEqual(
      CAPABILITY,
    );
    expect(reduce({ message: 'Closed.', type: 'capability-failed' }).capabilityError).toBe(
      'Closed.',
    );
  });

  test('selecting a machine drops the odds and the sealed inventory of the old one', () => {
    const next = reduce(
      { capability: CAPABILITY, type: 'capability-read' },
      { odds: ODDS, snapshot: SNAPSHOT, type: 'machine-priced' },
      {
        machine: FLIP_MACHINES[5] as never,
        type: 'machine-selected',
      },
    );

    expect(next.machine).toBe(FLIP_MACHINES[5] as never);
    expect(next.odds).toBeNull();
    expect(next.snapshot).toBeNull();
    expect(next.intent).toBeNull();
    expect(next.prepared).toBeNull();
    expect(next.signature).toBeNull();
    expect(next.notice).toBeNull();
    expect(next.fundingPhase).toBe('idle');
    // The capability belongs to the rail, not the machine, so it survives.
    expect(next.capability).toEqual(CAPABILITY);
  });

  test('prices a machine and reports a pricing failure as a recoverable error', () => {
    const priced = reduce({ odds: ODDS, snapshot: SNAPSHOT, type: 'machine-priced' });
    expect(priced.odds).toBe(ODDS);
    expect(priced.snapshot).toBe(SNAPSHOT);

    expect(reduce({ message: 'No pool.', type: 'machine-price-failed' }).error).toBe('No pool.');
  });

  test('clears the previous error when a new prepare starts', () => {
    const next = reduce(
      { message: 'No pool.', type: 'machine-price-failed' },
      { notice: 'stale', type: 'notice-posted' },
      { type: 'prepare-started' },
    );

    expect(next.pending).toBe(true);
    expect(next.error).toBeNull();
    expect(next.notice).toBeNull();
  });

  test('a prepared rip carries the commitment, intent, and transaction together', () => {
    const next = reduce(
      { type: 'prepare-started' },
      {
        commitmentId: 'gachaseed_1',
        intent: INTENT,
        prepared: PREPARED,
        serverSeedHash: 's'.repeat(64),
        type: 'prepare-succeeded',
      },
    );

    expect(next.commitmentId).toBe('gachaseed_1');
    expect(next.intent).toBe(INTENT);
    expect(next.prepared).toBe(PREPARED);
    expect(next.serverSeedHash).toBe('s'.repeat(64));
    expect(next.pending).toBe(false);
  });

  test('refreshes a no-broadcast preparation without dropping the rip commitment', () => {
    const refreshed = { ...PREPARED } as PreparedGachaPaymentTransaction;
    const next = reduce(...IN_FLIGHT, {
      prepared: refreshed,
      type: 'preparation-refreshed',
    });

    expect(next.prepared).toBe(refreshed);
    expect(next.commitmentId).toBe('gachaseed_1');
    expect(next.serverSeedHash).toBe('s'.repeat(64));
    expect(next.fundingPhase).toBe('idle');
    expect(next.error).toBeNull();
  });

  test('updates refreshed prepared bytes without changing the current phase', () => {
    const refreshed = { ...PREPARED } as PreparedGachaPaymentTransaction;
    const next = reduce(
      { phase: 'signing', type: 'funding-phase-changed' },
      { prepared: refreshed, type: 'prepared-updated' },
    );

    expect(next.prepared).toBe(refreshed);
    expect(next.fundingPhase).toBe('signing');
  });

  test('a failed prepare releases the pending flag so the player can retry', () => {
    const next = reduce(
      { type: 'prepare-started' },
      {
        message: 'Intent expired.',
        type: 'prepare-failed',
      },
    );

    expect(next.error).toBe('Intent expired.');
    expect(next.pending).toBe(false);
  });

  test('tracks the funding phase, the cluster phase, and the signature separately', () => {
    const next = reduce(
      { phase: 'verifying', type: 'funding-phase-changed' },
      { phase: 'confirmed', type: 'confirmation-phase-changed' },
      { signature: 'sig', type: 'transaction-broadcast' },
      { notice: 'Checking…', type: 'notice-posted' },
    );

    expect(next.fundingPhase).toBe('verifying');
    expect(next.confirmationPhase).toBe('confirmed');
    expect(next.signature).toBe('sig');
    expect(next.notice).toBe('Checking…');
  });

  test('a revealed rip clears the error and the notice and stops the funding phase', () => {
    const next = reduce(...IN_FLIGHT, { result: RESULT, type: 'rip-succeeded' });

    expect(next.result).toBe(RESULT);
    expect(next.error).toBeNull();
    expect(next.notice).toBeNull();
    expect(next.fundingPhase).toBe('idle');
  });

  test('a terminal provider failure clears recovery into a truthful terminal result', () => {
    const next = reduce(...IN_FLIGHT, {
      result: PROVIDER_FAILED_RESULT,
      type: 'rip-provider-failed',
    });

    expect(next.result).toBe(PROVIDER_FAILED_RESULT);
    expect(next.fundingPhase).toBe('idle');
    expect(next.signature).toBeNull();
    expect(next.error).toBeNull();
  });

  test('a failed rip lands in recovery because the deposit may already be on chain', () => {
    const next = reduce(...IN_FLIGHT, { message: 'Rip failed.', type: 'rip-failed' });

    expect(next.error).toBe('Rip failed.');
    expect(next.fundingPhase).toBe('recovering');
    // The signature is retained deliberately — recovery links it to the explorer.
    expect(next.signature).toBe('sig');
  });

  test('a declined wallet prompt goes back to idle rather than recovery', () => {
    const next = reduce(...IN_FLIGHT, { message: 'You declined.', type: 'rip-declined' });

    expect(next.error).toBe('You declined.');
    expect(next.fundingPhase).toBe('idle');
    expect(next.broadcastUnknown).toBe(false);
  });

  test('an untyped signer failure blocks recovery from opening a second transfer', () => {
    const beforeBroadcast = IN_FLIGHT.filter((action) => action.type !== 'transaction-broadcast');
    const next = reduce(...beforeBroadcast, {
      message: 'The wallet response was interrupted.',
      type: 'transaction-broadcast-unknown',
    });

    expect(next.fundingPhase).toBe('recovering');
    expect(next.broadcastUnknown).toBe(true);
    expect(next.signature).toBeNull();
    expect(next.intent).toBe(INTENT);
  });

  test('hydrates a known signature and refuses select, prepare, and reset until terminal recovery', () => {
    const hydrated = reduce({
      record: KNOWN_RECOVERY,
      stale: false,
      type: 'recovery-hydrated',
    });
    const selected = flipMachineReducer(hydrated, {
      machine: FLIP_MACHINES[5] as never,
      type: 'machine-selected',
    });
    const prepared = flipMachineReducer(hydrated, { type: 'prepare-started' });
    const reset = flipMachineReducer(hydrated, { type: 'reset' });

    expect(hydrated.fundingPhase).toBe('recovering');
    expect(hydrated.signature).toBe(KNOWN_RECOVERY.signature);
    expect(hydrated.recovery).toBe(KNOWN_RECOVERY);
    expect(selected).toBe(hydrated);
    expect(prepared).toBe(hydrated);
    expect(reset).toBe(hydrated);
  });

  test('hydrates a signed claim-pending record with its derived signature for reload reconciliation', () => {
    const hydrated = reduce({
      record: SIGNED_RECOVERY,
      stale: false,
      type: 'recovery-hydrated',
    });

    expect(hydrated.fundingPhase).toBe('recovering');
    expect(hydrated.signature).toBe(SIGNED_RECOVERY.signature);
    expect(hydrated.recovery).toBe(SIGNED_RECOVERY);
    expect(hydrated.broadcastUnknown).toBe(false);
  });

  test('synchronizes signed recovery into live state before a failed claim can render another rip', () => {
    const synchronized = reduce({
      record: SIGNED_RECOVERY,
      type: 'recovery-synchronized',
    });
    const selected = flipMachineReducer(synchronized, {
      machine: FLIP_MACHINES[5] as never,
      type: 'machine-selected',
    });
    const prepared = flipMachineReducer(synchronized, { type: 'prepare-started' });

    expect(synchronized.recovery).toBe(SIGNED_RECOVERY);
    expect(synchronized.signature).toBe(SIGNED_RECOVERY.signature);
    expect(selected).toBe(synchronized);
    expect(prepared).toBe(synchronized);
  });

  test('hydrates recovery onto its own machine and drops mismatched reveal evidence', () => {
    const target = FLIP_MACHINES[5] as (typeof FLIP_MACHINES)[number];
    const recovered = attachFlipPaymentSignature(
      createAwaitingFlipPaymentRecovery({
        commitmentId: 'gachaseed_other',
        intentId: 'gachapay_other',
        machineKey: target.machineKey,
        mint: 'M'.repeat(32),
        oddsVersion: 7,
        payerWallet: 'P'.repeat(32),
        serverSeedHash: 's'.repeat(64),
        sourceTokenAccount: 'S'.repeat(32),
      }),
      'Q'.repeat(88),
    );
    const hydrated = reduce(
      { odds: ODDS, snapshot: SNAPSHOT, type: 'machine-priced' },
      { record: recovered, stale: false, type: 'recovery-hydrated' },
    );

    expect(hydrated.machine).toBe(target);
    expect(hydrated.odds).toBeNull();
    expect(hydrated.snapshot).toBeNull();
  });

  test('keeps stale and corrupt reloads fail-closed without a signature', () => {
    const stale = reduce({ record: KNOWN_RECOVERY, stale: true, type: 'recovery-hydrated' });
    const invalid = reduce({ type: 'recovery-invalid' });

    expect(stale.recovery).toBe(KNOWN_RECOVERY);
    expect(stale.error).toContain('remains locked');
    expect(invalid.broadcastUnknown).toBe(true);
    expect(invalid.recoveryInvalid).toBe(true);
    expect(flipMachineReducer(invalid, { type: 'reset' })).toBe(invalid);
  });

  test('releases a hydrated lock when another tab clears terminal recovery', () => {
    const hydrated = reduce({
      record: KNOWN_RECOVERY,
      stale: false,
      type: 'recovery-hydrated',
    });
    const cleared = flipMachineReducer(hydrated, { type: 'recovery-cleared' });

    expect(cleared.recovery).toBeNull();
    expect(cleared.recoveryInvalid).toBe(false);
    expect(cleared.broadcastUnknown).toBe(false);
    expect(cleared.signature).toBeNull();
    expect(cleared.fundingPhase).toBe('idle');
  });

  test('a definitive on-chain failure clears its signature before refreshing the intent', () => {
    const next = reduce(...IN_FLIGHT, {
      message: 'The network rejected the transaction.',
      type: 'transaction-failed',
    });

    expect(next.fundingPhase).toBe('recovering');
    expect(next.broadcastUnknown).toBe(false);
    expect(next.signature).toBeNull();
    expect(next.intent).toBe(INTENT);
  });

  test('reset drops the rip but keeps the machine, its odds, and the capability', () => {
    const next = reduce(...IN_FLIGHT, { result: RESULT, type: 'rip-succeeded' }, { type: 'reset' });

    expect(next.result).toBeNull();
    expect(next.commitmentId).toBeNull();
    expect(next.confirmationPhase).toBeNull();
    expect(next.intent).toBeNull();
    expect(next.prepared).toBeNull();
    expect(next.signature).toBeNull();
    expect(next.serverSeedHash).toBeNull();
    expect(next.error).toBeNull();
    expect(next.notice).toBeNull();
    expect(next.pending).toBe(false);
    expect(next.fundingPhase).toBe('idle');
    expect(next.broadcastUnknown).toBe(false);

    expect(next.capability).toEqual(CAPABILITY);
    expect(next.odds).toBe(ODDS);
    expect(next.snapshot).toBe(SNAPSHOT);
    expect(next.machine).toBe(INITIAL_FLIP_MACHINE_STATE.machine);
  });
});
