export const CRASH_HISTORY_SCHEMA_VERSION = 'dailydraft.crash-history.v1' as const;
export const CRASH_RECEIPT_SCHEMA_VERSION = 'dailydraft.crash-receipt.v1' as const;

export type CrashPublicStatus = 'active' | 'busted' | 'cashed-out' | 'completed' | 'defaulted';

export type CrashSettlementPublicStatus =
  | 'not-required'
  | 'pending'
  | 'recovery-required'
  | 'settled';

export type CrashSafeNextAction =
  | 'choose-action'
  | 'reconnect'
  | 'retry-settlement'
  | 'review-receipt'
  | 'wait-for-settlement';

export type CrashHistoryItem = {
  createdAt: string;
  currentStage: number;
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
  stage: number;
  terminalReason: string | null;
};

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
