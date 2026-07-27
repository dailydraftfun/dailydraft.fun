'use client';

import {
  type Dispatch,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  getGachaCapability,
  getGachaInventory,
  getGachaOdds,
  prepareGachaPaymentTransaction as prepareSessionGachaPaymentTransaction,
} from '../../solana/gacha-client';
import { useWalletAuth } from '../../solana/wallet-auth-provider';
import { useSolanaWallet } from '../../solana/wallet-provider';
import {
  confirmFlipRip,
  createFlipConfirmEvents,
  createFlipResumeInput,
  createFlipConfirmIo as createSessionFlipConfirmIo,
  describeFlipError,
  type FlipConfirmEvents,
  type FlipConfirmOutcome,
  flipConfirmOutcomeAction,
  flipOutcomeClearsRecovery,
  prepareFlipRip as prepareSessionFlipRip,
  reconcileSignedFlipRip,
  resumeFlipRip,
} from './flip-machine-actions';
import {
  type FlipMachineAction,
  flipMachineReducer,
  INITIAL_FLIP_MACHINE_STATE,
} from './flip-machine-state';
import { FlipMachineView, type FlipWalletChoice } from './flip-machine-view';
import { type FlipSport, findFlipMachine } from './flip-machines';
import {
  attachFlipPaymentSignature,
  attachFlipSignedTransaction,
  clearFlipPaymentRecovery,
  createUnknownFlipPaymentRecovery,
  FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY,
  FLIP_PAYMENT_RECOVERY_STORAGE_KEY,
  type FlipPaymentRecovery,
  readFlipPaymentRecovery,
  storeFlipPaymentRecovery,
} from './flip-payment-recovery';

export function bindFlipSession(sessionToken: string | null) {
  return {
    createFlipConfirmIo: (signTransaction: Parameters<typeof createSessionFlipConfirmIo>[0]) =>
      createSessionFlipConfirmIo(signTransaction, sessionToken),
    prepareFlipRip: (input: { address: string; machineKey: string }) =>
      prepareSessionFlipRip({ ...input, sessionToken }),
    prepareGachaPaymentTransaction: (intentId: string) =>
      prepareSessionGachaPaymentTransaction(intentId, sessionToken),
  };
}

/**
 * Live Sports Pack Gacha client.
 *
 * This component is wiring only. Every decision lives in `flip-machine-flow.ts`,
 * every transition in `flip-machine-state.ts`, every sequence in
 * `flip-machine-actions.ts`, and the whole surface in `flip-machine-view.tsx` —
 * the workspace has no DOM test environment, so anything left in a hook body
 * would be unreachable from a test.
 */
export function FlipMachine() {
  const wallet = useSolanaWallet();
  const { sessionToken } = useWalletAuth();
  return <FlipMachineController sessionToken={sessionToken} wallet={wallet} />;
}

export function FlipMachineController({
  sessionToken = null,
  wallet,
}: {
  sessionToken?: string | null;
  wallet: ReturnType<typeof useSolanaWallet>;
}) {
  const [state, dispatch] = useReducer(flipMachineReducer, INITIAL_FLIP_MACHINE_STATE);
  const { createFlipConfirmIo, prepareFlipRip, prepareGachaPaymentTransaction } = useMemo(
    () => bindFlipSession(sessionToken),
    [sessionToken],
  );
  const {
    broadcastUnknown,
    commitmentId,
    intent,
    machine,
    odds,
    prepared,
    recovery,
    recoveryInvalid,
    serverSeedHash,
    signature,
  } = state;

  // The five gacha mutations take no AbortSignal, so a click-driven handler
  // guards on the machine it started from rather than on an aborted request.
  const machineRef = useRef(machine.machineKey);
  const fundingOperationRef = useRef(false);
  const paymentRecoveryRef = useRef<FlipPaymentRecovery | null>(null);
  const automaticRecoverySignatureRef = useRef<string | null>(null);
  machineRef.current = machine.machineKey;

  useEffect(() => {
    hydrateRecovery(window.localStorage, paymentRecoveryRef, dispatch);
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === FLIP_PAYMENT_RECOVERY_STORAGE_KEY ||
        event.key === FLIP_PAYMENT_RECOVERY_LEGACY_STORAGE_KEY
      ) {
        hydrateRecovery(window.localStorage, paymentRecoveryRef, dispatch);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getGachaCapability(controller.signal)
      .then((capability) => {
        if (!controller.signal.aborted) dispatch({ capability, type: 'capability-read' });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          message: describeFlipError(cause, 'The machine capability could not be read.'),
          type: 'capability-failed',
        });
      });
    return () => controller.abort();
  }, []);

  const { machineKey } = machine;

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      getGachaOdds(machineKey, controller.signal),
      getGachaInventory(machineKey, controller.signal),
    ])
      .then(([odds, snapshot]) => {
        if (!controller.signal.aborted) dispatch({ odds, snapshot, type: 'machine-priced' });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          message: describeFlipError(cause, 'This machine could not be priced.'),
          type: 'machine-price-failed',
        });
      });

    return () => controller.abort();
  }, [machineKey]);

  const handleSelect = useCallback((sport: FlipSport, tierPriceMinor: string) => {
    const next = findFlipMachine(sport, tierPriceMinor);
    if (next) dispatch({ machine: next, type: 'machine-selected' });
  }, []);

  const handleConnect = useCallback(
    (walletName: string) => {
      const available = wallet.wallets.find((candidate) => candidate.name === walletName);
      if (available) void wallet.connect(available);
    },
    [wallet],
  );

  const handlePrepare = useCallback(() => {
    const address = wallet.address;
    if (
      fundingOperationRef.current ||
      !address ||
      !odds ||
      broadcastUnknown ||
      recovery ||
      recoveryInvalid ||
      signature
    ) {
      return;
    }
    const started = machineKey;
    fundingOperationRef.current = true;

    dispatch({ type: 'prepare-started' });
    const preparation = prepareFlipRip({ address, machineKey: started });
    void preparation.then((outcome) => {
      if (machineRef.current !== started) return;
      if (outcome.status === 'failed') {
        dispatch({ message: outcome.message, type: 'prepare-failed' });
        return;
      }
      if (outcome.status === 'resumed') {
        const record = attachFlipPaymentSignature(
          createUnknownFlipPaymentRecovery({
            commitmentId: outcome.commitmentId,
            intentId: outcome.intent.intentId,
            machineKey: started,
            mint: outcome.intent.mint,
            oddsVersion: odds.version,
            payerWallet: outcome.intent.payerWallet,
            serverSeedHash: outcome.serverSeedHash,
            sourceTokenAccount: null,
          }),
          outcome.intent.signature as string,
        );
        paymentRecoveryRef.current = record;
        storeFlipPaymentRecovery(window.localStorage, record);
        dispatch({ record, stale: false, type: 'recovery-hydrated' });
        return;
      }
      dispatch({
        commitmentId: outcome.commitmentId,
        intent: outcome.intent,
        prepared: outcome.prepared,
        serverSeedHash: outcome.serverSeedHash,
        type: 'prepare-succeeded',
      });
      void wallet.refreshBalances(outcome.intent.mint, outcome.prepared.sourceTokenAccount);
    });
    void preparation.finally(() => {
      fundingOperationRef.current = false;
    });
  }, [
    broadcastUnknown,
    machineKey,
    odds,
    recovery,
    recoveryInvalid,
    signature,
    wallet,
    prepareFlipRip,
  ]);

  const handleConfirm = useCallback(() => {
    const address = wallet.address;
    if (
      fundingOperationRef.current ||
      !address ||
      !intent ||
      !prepared ||
      !commitmentId ||
      !odds ||
      !serverSeedHash ||
      broadcastUnknown ||
      recovery ||
      recoveryInvalid ||
      signature ||
      !wallet.canSignTransaction
    ) {
      return;
    }
    const started = machineKey;
    fundingOperationRef.current = true;

    const input = {
      address,
      commitmentId,
      intent,
      machineKey: started,
      oddsVersion: odds.version,
      prepared,
      serverSeedHash,
    };
    const baseEvents = createFlipConfirmEvents(dispatch, wallet.refreshBalances);
    const events: FlipConfirmEvents = {
      ...baseEvents,
      onBroadcastPending: (nextPrepared) => {
        const record = createUnknownFlipPaymentRecovery({
          commitmentId,
          intentId: intent.intentId,
          machineKey: started,
          mint: intent.mint,
          oddsVersion: odds.version,
          payerWallet: address,
          serverSeedHash,
          sourceTokenAccount: nextPrepared.sourceTokenAccount,
        });
        if (!storeFlipPaymentRecovery(window.localStorage, record)) return false;
        paymentRecoveryRef.current = record;
        return true;
      },
      onSignature: (nextSignature) => {
        baseEvents.onSignature(nextSignature);
        const current = paymentRecoveryRef.current;
        if (!current) return;
        const known = attachFlipPaymentSignature(current, nextSignature);
        // If this upgrade fails, the durable signed-byte record remains and can
        // safely re-claim and re-broadcast the exact same transfer.
        if (storeFlipPaymentRecovery(window.localStorage, known)) {
          paymentRecoveryRef.current = known;
        }
      },
      onSignedTransaction: (signed) => {
        const current = paymentRecoveryRef.current;
        if (!current) return false;
        const pending = attachFlipSignedTransaction(current, signed);
        if (!storeFlipPaymentRecovery(window.localStorage, pending)) return false;
        paymentRecoveryRef.current = pending;
        return true;
      },
    };

    void confirmFlipRip(input, events, createFlipConfirmIo(wallet.signTransaction))
      .then((outcome) => {
        if (machineRef.current !== started) return;
        clearTerminalFlipRecovery(outcome, paymentRecoveryRef, window.localStorage);
        dispatch(flipConfirmOutcomeAction(outcome));
      })
      .finally(() => {
        fundingOperationRef.current = false;
      });
  }, [
    broadcastUnknown,
    commitmentId,
    intent,
    machineKey,
    odds,
    prepared,
    recovery,
    recoveryInvalid,
    serverSeedHash,
    signature,
    wallet,
    createFlipConfirmIo,
  ]);

  const handleResume = useCallback(() => {
    const address = wallet.address;
    if (fundingOperationRef.current || recoveryInvalid) return;

    if (recovery) {
      if (recovery.status === 'broadcast-unknown') return;
      fundingOperationRef.current = true;
      const recoveryInput = {
        address: recovery.payerWallet,
        commitmentId: recovery.commitmentId,
        intentId: recovery.intentId,
        machineKey: recovery.machineKey,
        mint: recovery.mint,
        oddsVersion: recovery.oddsVersion,
        serverSeedHash: recovery.serverSeedHash,
        sourceTokenAccount: recovery.sourceTokenAccount,
      };
      const recoveryEvents = createFlipConfirmEvents(dispatch, wallet.refreshBalances);
      const recoveryIo = createFlipConfirmIo(wallet.signTransaction);
      const operation =
        recovery.status === 'signed-claim-pending'
          ? reconcileSignedFlipRip(
              {
                ...recoveryInput,
                signedTransactionBase64: recovery.signedTransactionBase64,
              },
              recovery.signature,
              recoveryEvents,
              recoveryIo,
            )
          : resumeFlipRip(recoveryInput, recovery.signature, recoveryEvents, recoveryIo);
      void operation
        .then((outcome) => {
          clearTerminalFlipRecovery(outcome, paymentRecoveryRef, window.localStorage);
          dispatch(flipConfirmOutcomeAction(outcome));
        })
        .finally(() => {
          fundingOperationRef.current = false;
        });
      return;
    }

    if (!address || !intent || !prepared) return;
    const started = machineKey;

    if (!signature) {
      if (broadcastUnknown) return;
      fundingOperationRef.current = true;
      dispatch({ type: 'prepare-started' });
      void prepareGachaPaymentTransaction(intent.intentId)
        .then((nextPrepared) => {
          if (machineRef.current !== started) return;
          dispatch({ prepared: nextPrepared, type: 'preparation-refreshed' });
          void wallet.refreshBalances(intent.mint, nextPrepared.sourceTokenAccount);
        })
        .catch((cause: unknown) => {
          if (machineRef.current !== started) return;
          dispatch({
            message: describeFlipError(cause, 'The payment review could not be refreshed.'),
            type: 'prepare-failed',
          });
        })
        .finally(() => {
          fundingOperationRef.current = false;
        });
      return;
    }
    if (!commitmentId || !odds || !serverSeedHash) return;

    fundingOperationRef.current = true;
    void resumeFlipRip(
      createFlipResumeInput({
        address,
        commitmentId,
        intent,
        machineKey: started,
        oddsVersion: odds.version,
        prepared,
        serverSeedHash,
      }),
      signature,
      createFlipConfirmEvents(dispatch, wallet.refreshBalances),
      createFlipConfirmIo(wallet.signTransaction),
    )
      .then((outcome) => {
        if (machineRef.current !== started) return;
        clearTerminalFlipRecovery(outcome, paymentRecoveryRef, window.localStorage);
        dispatch(flipConfirmOutcomeAction(outcome));
      })
      .finally(() => {
        fundingOperationRef.current = false;
      });
  }, [
    broadcastUnknown,
    commitmentId,
    intent,
    machineKey,
    odds,
    prepared,
    recovery,
    recoveryInvalid,
    serverSeedHash,
    signature,
    wallet,
    createFlipConfirmIo,
    prepareGachaPaymentTransaction,
  ]);

  useEffect(() => {
    if (
      !recovery ||
      recovery.status === 'broadcast-unknown' ||
      automaticRecoverySignatureRef.current === recovery.signature
    ) {
      return;
    }
    automaticRecoverySignatureRef.current = recovery.signature;
    handleResume();
  }, [handleResume, recovery]);

  const handleReset = useCallback(() => dispatch({ type: 'reset' }), []);

  // The view takes plain data so it stays renderable without a wallet provider;
  // the Wallet Standard object itself never crosses that boundary.
  const wallets = useMemo<readonly FlipWalletChoice[]>(
    () => wallet.wallets.map((available) => ({ icon: available.icon, name: available.name })),
    [wallet.wallets],
  );

  return (
    <FlipMachineView
      balanceStatus={wallet.balanceStatus}
      balances={wallet.balances}
      onConfirm={handleConfirm}
      onConnect={handleConnect}
      onPrepare={handlePrepare}
      onReset={handleReset}
      onResume={handleResume}
      onSelect={handleSelect}
      state={state}
      walletAddress={wallet.address}
      walletCanSignTransaction={wallet.canSignTransaction}
      walletConnecting={wallet.status === 'connecting'}
      wallets={wallets}
    />
  );
}

export function hydrateRecovery(
  storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>,
  recoveryRef: RefObject<FlipPaymentRecovery | null>,
  dispatch: Dispatch<FlipMachineAction>,
): void {
  const restored = readFlipPaymentRecovery(storage);
  if (restored.status === 'valid') {
    recoveryRef.current = restored.record;
    dispatch({ record: restored.record, stale: restored.stale, type: 'recovery-hydrated' });
    return;
  }
  if (restored.status === 'invalid') {
    recoveryRef.current = null;
    dispatch({ type: 'recovery-invalid' });
    return;
  }
  if (recoveryRef.current) {
    recoveryRef.current = null;
    dispatch({ type: 'recovery-cleared' });
  }
}

export function clearTerminalFlipRecovery(
  outcome: FlipConfirmOutcome,
  recoveryRef: RefObject<FlipPaymentRecovery | null>,
  storage: Pick<Storage, 'removeItem'>,
): void {
  if (!flipOutcomeClearsRecovery(outcome)) return;
  clearFlipPaymentRecovery(storage);
  recoveryRef.current = null;
}
