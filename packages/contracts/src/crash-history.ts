export const CRASH_HISTORY_SCHEMA_VERSION = 'dailydraft.crash-history.v1' as const;
export const CRASH_RECEIPT_SCHEMA_VERSION = 'dailydraft.crash-receipt.v1' as const;

export type CrashPublicStatus = 'active' | 'busted' | 'cashed-out' | 'completed' | 'defaulted';

export type CrashSettlementPublicStatus =
  | 'not-required'
  | 'pending'
  | 'recovery-required'
  | 'settled';

export type CrashResolutionStatus =
  | 'active'
  | 'bust'
  | 'cash-out'
  | 'disputed'
  | 'failed'
  | 'recovering'
  | 'refunded'
  | 'timed-out';

export type CrashSafeNextAction =
  | 'choose-action'
  | 'reconnect'
  | 'retry-settlement'
  | 'review-receipt'
  | 'wait-for-settlement';

export type CrashHistoryItem = {
  createdAt: string;
  currentStage: number;
  decisionDeadline: string | null;
  gameState: {
    committed: true;
    status: CrashPublicStatus;
    version: number;
  };
  pot: {
    amount: string;
    currency: 'USDC';
    decimals: 6;
  };
  receiptHref: string;
  resolution: CrashResolutionStatus;
  roundId: string;
  safeNextAction: CrashSafeNextAction;
  settlement: {
    finalizedOperationCount: number;
    receiptHash: string | null;
    status: CrashSettlementPublicStatus;
  };
  terminalReason: string | null;
  updatedAt: string;
};

export type CrashHistoryPage = {
  data: CrashHistoryItem[];
  hasMore: boolean;
  nextCursor: string | null;
  schemaVersion: typeof CRASH_HISTORY_SCHEMA_VERSION;
};

export type CrashReceiptEvent = {
  amount: {
    amount: string;
    currency: 'USDC';
    decimals: 6;
  } | null;
  decision: 'cash-out' | 'continue' | 'forfeit' | null;
  eventId: string;
  kind:
    | 'custody-prepared'
    | 'custody-recovery-required'
    | 'deadline-defaulted'
    | 'round-busted'
    | 'round-cashed-out'
    | 'round-completed'
    | 'round-started'
    | 'settlement-finalized'
    | 'settlement-prepared'
    | 'settlement-recovery-required'
    | 'stage-continued';
  occurredAt: string;
  reference: string;
  scheduledDeadline: string | null;
  stage: number;
  terminalReason: string | null;
};

type CrashReceiptEventDomain = 'custody' | 'settlement' | 'transition';

const CRASH_RECEIPT_EVENT_DOMAIN_ORDER: Record<CrashReceiptEventDomain, number> = {
  transition: 0,
  custody: 1,
  settlement: 2,
};

export function compareCrashReceiptEvents(
  left: CrashReceiptEvent,
  right: CrashReceiptEvent,
): number {
  const occurredAt = left.occurredAt.localeCompare(right.occurredAt);
  if (occurredAt !== 0) return occurredAt;

  const leftId = parseCrashReceiptEventId(left.eventId);
  const rightId = parseCrashReceiptEventId(right.eventId);
  if (!leftId || !rightId) return left.eventId.localeCompare(right.eventId);

  const domain =
    CRASH_RECEIPT_EVENT_DOMAIN_ORDER[leftId.domain] -
    CRASH_RECEIPT_EVENT_DOMAIN_ORDER[rightId.domain];
  if (domain !== 0) return domain;
  if (leftId.sequence !== null && rightId.sequence !== null) {
    return leftId.sequence - rightId.sequence;
  }
  return left.eventId.localeCompare(right.eventId);
}

export function isCrashReceiptEventId(
  eventId: unknown,
  kind: CrashReceiptEvent['kind'],
): eventId is string {
  if (typeof eventId !== 'string') return false;
  const parsed = parseCrashReceiptEventId(eventId);
  return parsed?.domain === eventDomainForKind(kind);
}

function parseCrashReceiptEventId(
  eventId: string,
): { domain: CrashReceiptEventDomain; sequence: number | null } | null {
  const sequenced = /^(settlement|transition):([1-9][0-9]{0,9})$/.exec(eventId);
  if (sequenced) {
    const sequence = Number(sequenced[2]);
    if (!Number.isSafeInteger(sequence)) return null;
    return { domain: sequenced[1] as 'settlement' | 'transition', sequence };
  }
  if (/^custody:crashref_[a-f0-9]{32}$/.test(eventId)) {
    return { domain: 'custody', sequence: null };
  }
  return null;
}

function eventDomainForKind(kind: CrashReceiptEvent['kind']): CrashReceiptEventDomain {
  if (kind.startsWith('settlement-')) return 'settlement';
  if (kind.startsWith('custody-')) return 'custody';
  return 'transition';
}

export type CrashReceipt = {
  bindings: {
    architectureVersion: string;
    calculatorVersion: string;
    custodyPolicyHash: string | null;
    custodyPolicyVersion: string | null;
    inventoryPolicyHash: string | null;
    inventoryPolicyVersion: string | null;
    riskRulesHash: string;
    riskRulesVersion: string;
    rulesHash: string;
    rulesVersion: string;
    settlementPolicyHash: string | null;
    settlementPolicyVersion: string | null;
    stateMachineRulesHash: string;
    stateMachineVersion: string;
  };
  createdAt: string;
  decisionDeadline: string | null;
  custody: {
    preparedIntentCount: number;
    recoveryRequiredIntentCount: number;
    status: 'not-started' | 'prepared' | 'recovery-required';
  };
  events: CrashReceiptEvent[];
  finality: {
    custody: 'not-final' | 'recovery-required' | 'settled';
    gameState: 'committed';
    settlement: CrashSettlementPublicStatus;
  };
  mode: 'fixture-preview';
  network: 'solana-devnet';
  pot: {
    amount: string;
    currency: 'USDC';
    decimals: 6;
  };
  privacy: {
    exposesProviderSignatures: false;
    exposesWalletAddresses: false;
  };
  roundId: string;
  resolution: CrashResolutionStatus;
  safeNextAction: CrashSafeNextAction;
  schemaVersion: typeof CRASH_RECEIPT_SCHEMA_VERSION;
  settlement: {
    expectedOperationCount: number;
    finalizedOperationCount: number;
    receiptHash: string | null;
    recoveryReason: string | null;
    status: CrashSettlementPublicStatus;
  };
  stage: number;
  status: CrashPublicStatus;
  terminalAt: string | null;
  terminalReason: string | null;
  updatedAt: string;
  version: number;
};
