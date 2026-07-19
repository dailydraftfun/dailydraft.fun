import type {
  DuelReconciliationResult,
  DuelTransactionIntent,
  DurableDuel,
} from '../solana/duel-client';

type RestoreDuelEntryInput = {
  abandonRejectedIntent: (duelId: string, intentId: string, sessionToken: string) => Promise<void>;
  duelId: string;
  fundingPossiblyBroadcast: boolean;
  loadDuel: (duelId: string) => Promise<DurableDuel>;
  prepareIntent: (
    duelId: string,
    wallet: string,
    sessionToken: string,
  ) => Promise<DuelTransactionIntent>;
  reconcileTransactions: (
    duelId: string,
    sessionToken: string,
  ) => Promise<DuelReconciliationResult>;
  rejectedIntentId: string | null;
  sessionToken: string;
  wallet: string;
};

export type RestoredDuelEntry = {
  duel: DurableDuel;
  intent: DuelTransactionIntent | null;
  recoveryState: 'ready' | 'still-reconciling';
};

export type PostBroadcastRecovery = 'complete' | 'retry-safe' | 'still-confirming' | 'waiting';

export type DuelEntryCancellationTarget = 'duel' | 'matchmaking' | 'none';

export async function restoreDuelEntry({
  abandonRejectedIntent,
  duelId,
  fundingPossiblyBroadcast,
  loadDuel,
  prepareIntent,
  reconcileTransactions,
  rejectedIntentId,
  sessionToken,
  wallet,
}: RestoreDuelEntryInput): Promise<RestoredDuelEntry> {
  const duel = await loadDuel(duelId);
  if (![duel.creatorWallet, duel.opponentWallet].includes(wallet)) {
    throw new Error('The connected wallet is not a participant in this saved duel.');
  }
  if (fundingPossiblyBroadcast || !shouldPrepareFunding(duel, wallet)) {
    return { duel, intent: null, recoveryState: 'ready' };
  }
  if (rejectedIntentId) {
    await abandonRejectedIntent(duel.id, rejectedIntentId, sessionToken);
  }
  const reconciliation = await reconcileTransactions(duel.id, sessionToken);
  if (reconciliation.activeTransactionCount > 0 || reconciliation.unboundTransactionCount > 0) {
    return { duel, intent: null, recoveryState: 'still-reconciling' };
  }
  const reconciledDuel = await loadDuel(duel.id);
  if (!shouldPrepareFunding(reconciledDuel, wallet)) {
    return { duel: reconciledDuel, intent: null, recoveryState: 'ready' };
  }
  return {
    duel: reconciledDuel,
    intent: await prepareIntent(reconciledDuel.id, wallet, sessionToken),
    recoveryState: 'ready',
  };
}

export function classifyPostBroadcastRecovery(
  duel: DurableDuel,
  activeTransactionCount: number,
  unboundTransactionCount: number,
): PostBroadcastRecovery {
  if (activeTransactionCount > 0 || unboundTransactionCount > 0) return 'still-confirming';
  if (duel.status === 'matched') return 'retry-safe';
  if (
    duel.status === 'funded' ||
    duel.status === 'opening' ||
    duel.status === 'awaiting_assets' ||
    duel.status === 'settling' ||
    duel.status === 'settled'
  ) {
    return 'complete';
  }
  return 'waiting';
}

export function getDuelEntryCancellationTarget(
  duel: DurableDuel | null,
  hasMatchmakingSession: boolean,
): DuelEntryCancellationTarget {
  if (hasMatchmakingSession && (!duel || duel.matchmakingMode === 'open')) {
    return 'matchmaking';
  }
  return duel ? 'duel' : 'none';
}

function shouldPrepareFunding(duel: DurableDuel, wallet: string): boolean {
  return (
    (duel.status === 'matched' && duel.creatorWallet === wallet) ||
    (duel.status === 'committing' && duel.opponentWallet === wallet)
  );
}
