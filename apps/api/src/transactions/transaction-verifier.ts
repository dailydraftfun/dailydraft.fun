import { createHash } from 'node:crypto';

import type {
  ExpectedAccountConstraint,
  MonitoredTransaction,
  SolanaTransactionEnvelope,
} from './transaction-monitor.types.js';

export class TransactionVerificationError extends Error {
  constructor(readonly code: string) {
    super('Solana transaction did not match its recorded intent');
    this.name = 'TransactionVerificationError';
  }
}

interface AccountAccess {
  address: string;
  isSigner: boolean;
  isWritable: boolean;
}

export function verifyTransactionEnvelope(
  monitored: MonitoredTransaction,
  envelope: SolanaTransactionEnvelope,
): void {
  if (!envelope.meta) throw new TransactionVerificationError('MISSING_TRANSACTION_META');
  if (envelope.meta.err) throw new TransactionVerificationError('TRANSACTION_EXECUTION_ERROR');
  if (envelope.transaction.signatures[0] !== monitored.signature) {
    throw new TransactionVerificationError('SIGNATURE_MISMATCH');
  }
  if (
    monitored.recentBlockhash &&
    envelope.transaction.message.recentBlockhash !== monitored.recentBlockhash
  ) {
    throw new TransactionVerificationError('BLOCKHASH_MISMATCH');
  }

  const accounts = resolveAccountAccess(envelope);
  const signer = accounts.find((account) => account.address === monitored.expectedSigner);
  if (!signer?.isSigner) throw new TransactionVerificationError('SIGNER_MISMATCH');

  for (const constraint of monitored.expectedAccounts) {
    verifyAccountConstraint(accounts, constraint);
  }

  const matchingInstructions = envelope.transaction.message.instructions.filter((instruction) => {
    if (accounts[instruction.programIdIndex]?.address !== monitored.expectedProgramId) return false;
    if (hashInstructionData(instruction.data) !== monitored.expectedInstructionDataHash)
      return false;
    if (instruction.accounts.length !== monitored.expectedInstructionAccounts.length) return false;
    return monitored.expectedInstructionAccounts.every((constraint, index) => {
      const account = accounts[instruction.accounts[index] ?? -1];
      return account ? accountMatchesConstraint(account, constraint) : false;
    });
  });
  if (matchingInstructions.length === 0) {
    throw new TransactionVerificationError('INSTRUCTION_MISMATCH');
  }
  if (matchingInstructions.length > 1 && !monitored.allowMultipleInstructionMatches) {
    throw new TransactionVerificationError('AMBIGUOUS_INSTRUCTION_MATCH');
  }
}

function resolveAccountAccess(envelope: SolanaTransactionEnvelope): AccountAccess[] {
  const { accountKeys, header } = envelope.transaction.message;
  const signedWritable = header.numRequiredSignatures - header.numReadonlySignedAccounts;
  const unsignedWritable =
    accountKeys.length - header.numRequiredSignatures - header.numReadonlyUnsignedAccounts;
  if (
    signedWritable < 0 ||
    unsignedWritable < 0 ||
    header.numRequiredSignatures > accountKeys.length
  ) {
    throw new TransactionVerificationError('INVALID_ACCOUNT_HEADER');
  }

  const staticAccounts = accountKeys.map((address, index) => {
    const isSigner = index < header.numRequiredSignatures;
    const isWritable = isSigner
      ? index < signedWritable
      : index - header.numRequiredSignatures < unsignedWritable;
    return { address, isSigner, isWritable };
  });
  const loaded = envelope.meta?.loadedAddresses;
  if (!loaded) return staticAccounts;
  return [
    ...staticAccounts,
    ...loaded.writable.map((address) => ({ address, isSigner: false, isWritable: true })),
    ...loaded.readonly.map((address) => ({ address, isSigner: false, isWritable: false })),
  ];
}

function verifyAccountConstraint(
  accounts: AccountAccess[],
  constraint: ExpectedAccountConstraint,
): void {
  const account = accounts.find((candidate) => candidate.address === constraint.address);
  if (!account) throw new TransactionVerificationError('ACCOUNT_MISSING');
  if (constraint.isSigner !== undefined && account.isSigner !== constraint.isSigner) {
    throw new TransactionVerificationError('ACCOUNT_SIGNER_MISMATCH');
  }
  if (constraint.isWritable !== undefined && account.isWritable !== constraint.isWritable) {
    throw new TransactionVerificationError('ACCOUNT_ACCESS_MISMATCH');
  }
}

function accountMatchesConstraint(
  account: AccountAccess,
  constraint: ExpectedAccountConstraint,
): boolean {
  return (
    account.address === constraint.address &&
    (constraint.isSigner === undefined || account.isSigner === constraint.isSigner) &&
    (constraint.isWritable === undefined || account.isWritable === constraint.isWritable)
  );
}

function hashInstructionData(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
