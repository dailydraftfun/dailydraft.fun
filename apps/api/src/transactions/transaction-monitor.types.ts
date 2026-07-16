import type { DuelStatus } from '../domain.js';

export type MonitoredAction =
  | 'cancel'
  | 'commit_result'
  | 'fund'
  | 'open_pack'
  | 'refund'
  | 'settle';
export type MonitoredStatus = 'confirmed' | 'submitted';

export interface ExpectedAccountConstraint {
  address: string;
  isSigner?: boolean;
  isWritable?: boolean;
}

export interface MonitoredTransaction {
  action: MonitoredAction;
  allowMultipleInstructionMatches: boolean;
  checkAttempts: number;
  duelId: string;
  duelStatus: DuelStatus;
  expectedAccounts: ExpectedAccountConstraint[];
  expectedFromStatus: DuelStatus;
  expectedProgramId: string;
  expectedInstructionAccounts: ExpectedAccountConstraint[];
  expectedInstructionDataHash: string;
  expectedMessageHash: string;
  expectedSigner: string;
  expectedToStatus: DuelStatus;
  id: string;
  lastValidBlockHeight: bigint | null;
  recentBlockhash: string | null;
  signature: string;
  status: MonitoredStatus;
  submittedAt: Date;
  wallet: string;
}

export interface PreparedRecoveryIntent
  extends Omit<MonitoredTransaction, 'signature' | 'status' | 'submittedAt'> {
  escrowAddress: string;
  preparedAt: Date;
  recoveryCheckAttempts: number;
}

export type RecoveryAlertCode = 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH';

export interface ReconciliationSummary {
  checked: number;
  confirmed: number;
  expired: number;
  failed: number;
  finalized: number;
  pending: number;
  recoveryCandidates: number;
  recoveryChecked: number;
  recoveryDeferred: number;
  recoveryErrors: number;
  recoveryAlerts: number;
  recoveryRejected: number;
  recovered: number;
  stuck: number;
}

export interface DuelReconciliationResult {
  activeTransactionCount: number;
  duelId: string;
  duelStatus: DuelStatus;
  reconciliation: ReconciliationSummary;
}

export interface SolanaAddressSignature {
  blockTime: number | null;
  confirmationStatus: 'finalized';
  signature: string;
}

export interface SolanaSignatureStatus {
  confirmationStatus: 'confirmed' | 'finalized' | 'processed' | null;
  err: unknown | null;
}

export interface SolanaTransactionEnvelope {
  meta: {
    err: unknown | null;
    loadedAddresses?: { readonly: string[]; writable: string[] } | null;
  } | null;
  transaction: {
    message: {
      accountKeys: string[];
      header: {
        numReadonlySignedAccounts: number;
        numReadonlyUnsignedAccounts: number;
        numRequiredSignatures: number;
      };
      instructions: Array<{ accounts: number[]; data: string; programIdIndex: number }>;
      recentBlockhash: string;
    };
    signatures: string[];
  };
}
