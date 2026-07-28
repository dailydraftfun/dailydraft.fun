import type { DuelOpponentType, DuelTransactionIntent, DurableDuel } from '../solana/duel-client';

export const DUEL_ENTRY_DRAFT_STORAGE_KEY = 'dailydraft.duel-entry.v1';
export const DUEL_ENTRY_DRAFT_MAX_AGE_MS = 30 * 60 * 1_000;

export type DuelEntryDraft = {
  broadcastPending: boolean;
  duelId: string | null;
  mode: DuelOpponentType;
  opponentAddress: string;
  rejectedIntentId: string | null;
  tier: 25 | 50 | 100;
  updatedAt: string;
  version: 1;
};

export type DuelEntryStage =
  | 'authenticate'
  | 'complete'
  | 'connect'
  | 'confirming'
  | 'funding-review'
  | 'funding-signature'
  | 'preparing'
  | 'recovery'
  | 'review'
  | 'waiting';

type DuelEntryStageInput = {
  authenticationStatus:
    | 'unauthenticated'
    | 'restoring'
    | 'preparing'
    | 'ready'
    | 'signing'
    | 'authenticated'
    | 'error';
  error: string | null;
  fundingPhase: 'idle' | 'signing' | 'confirming' | 'recovering';
  hasSession: boolean;
  intent: DuelTransactionIntent | null;
  networkStatus: 'checking' | 'online' | 'offline';
  pending: boolean;
  persistedStatus: DurableDuel['status'] | null;
  walletAddress: string | null;
};

export type PlainMoneySummary = {
  demoPool: string;
  demoPoolValue: string;
  platformFee: string;
  walletApproval: string;
};

export function getDuelEntryStage(input: DuelEntryStageInput): DuelEntryStage {
  if (!input.walletAddress) return 'connect';
  if (!input.hasSession || input.authenticationStatus !== 'authenticated') return 'authenticate';
  if (input.fundingPhase === 'signing') return 'funding-signature';
  if (input.fundingPhase === 'confirming') return 'confirming';
  if (input.fundingPhase === 'recovering') return 'recovery';
  if (input.networkStatus === 'offline') return 'recovery';
  if (input.intent) return 'funding-review';
  if (input.pending) return 'preparing';

  if (
    input.persistedStatus === 'funded' ||
    input.persistedStatus === 'opening' ||
    input.persistedStatus === 'awaiting_assets' ||
    input.persistedStatus === 'settling' ||
    input.persistedStatus === 'settled'
  ) {
    return 'complete';
  }
  if (
    input.persistedStatus === 'waiting' ||
    input.persistedStatus === 'committing' ||
    input.persistedStatus === 'cancelling' ||
    input.persistedStatus === 'refunding'
  ) {
    return 'waiting';
  }
  if (
    input.persistedStatus === 'matched' ||
    input.persistedStatus === 'failed' ||
    input.persistedStatus === 'cancelled' ||
    input.persistedStatus === 'refunded'
  ) {
    return 'recovery';
  }
  if (input.error) return 'recovery';
  return 'review';
}

export function getPlainMoneySummary(
  tier: number,
  intent: DuelTransactionIntent | null,
): PlainMoneySummary {
  const platformFee = intent ? `${intent.feeAmountSol} SOL` : 'Calculated before signing';
  return {
    demoPool: `$${tier.toFixed(2)} tier label`,
    demoPoolValue: 'Not charged or purchased',
    platformFee,
    walletApproval: intent ? platformFee : 'Nothing until you review the exact fee',
  };
}

export function createDuelEntryDraft(
  input: Omit<DuelEntryDraft, 'updatedAt' | 'version'>,
  updatedAt = new Date().toISOString(),
): DuelEntryDraft {
  return { ...input, updatedAt, version: 1 };
}

export function parseDuelEntryDraft(value: string | null, now = Date.now()): DuelEntryDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DuelEntryDraft>;
    if (
      parsed.version !== 1 ||
      typeof parsed.broadcastPending !== 'boolean' ||
      !isMode(parsed.mode) ||
      !isTier(parsed.tier) ||
      typeof parsed.opponentAddress !== 'string' ||
      (parsed.duelId !== null && typeof parsed.duelId !== 'string') ||
      (parsed.rejectedIntentId !== undefined &&
        parsed.rejectedIntentId !== null &&
        (typeof parsed.rejectedIntentId !== 'string' ||
          !/^tx_[A-Za-z0-9]{12,64}$/.test(parsed.rejectedIntentId))) ||
      (Boolean(parsed.rejectedIntentId) && (!parsed.duelId || parsed.broadcastPending)) ||
      typeof parsed.updatedAt !== 'string' ||
      !Number.isFinite(new Date(parsed.updatedAt).getTime()) ||
      now - new Date(parsed.updatedAt).getTime() > DUEL_ENTRY_DRAFT_MAX_AGE_MS ||
      new Date(parsed.updatedAt).getTime() - now > 60_000
    ) {
      return null;
    }
    return {
      broadcastPending: parsed.broadcastPending,
      duelId: parsed.duelId,
      mode: parsed.mode,
      opponentAddress: parsed.opponentAddress,
      rejectedIntentId: parsed.rejectedIntentId ?? null,
      tier: parsed.tier,
      updatedAt: parsed.updatedAt,
      version: 1,
    };
  } catch {
    return null;
  }
}

function isMode(value: unknown): value is DuelOpponentType {
  return value === 'direct' || value === 'matchmaking' || value === 'house';
}

function isTier(value: unknown): value is DuelEntryDraft['tier'] {
  return value === 25 || value === 50 || value === 100;
}
