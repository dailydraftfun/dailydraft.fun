import { createHash } from 'node:crypto';
import bs58 from 'bs58';

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
  if (hashTransactionMessage(envelope) !== monitored.expectedMessageHash) {
    throw new TransactionVerificationError('MESSAGE_MISMATCH');
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

export function hashTransactionMessage(envelope: SolanaTransactionEnvelope): string {
  const { message } = envelope.transaction;
  const headerValues = [
    message.header.numRequiredSignatures,
    message.header.numReadonlySignedAccounts,
    message.header.numReadonlyUnsignedAccounts,
  ];
  if (headerValues.some((value) => value > 255)) {
    throw new TransactionVerificationError('INVALID_ACCOUNT_HEADER');
  }
  const bytes: Buffer[] = [
    Buffer.from(headerValues),
    encodeShortVector(message.accountKeys.length),
    ...message.accountKeys.map((address) => decodeBase58(address, 32)),
    decodeBase58(message.recentBlockhash, 32),
    encodeShortVector(message.instructions.length),
  ];
  for (const instruction of message.instructions) {
    if (
      instruction.programIdIndex > 255 ||
      instruction.accounts.some((accountIndex) => accountIndex > 255)
    ) {
      throw new TransactionVerificationError('INVALID_INSTRUCTION_INDEX');
    }
    const data = decodeBase58(instruction.data);
    bytes.push(
      Buffer.from([instruction.programIdIndex]),
      encodeShortVector(instruction.accounts.length),
      Buffer.from(instruction.accounts),
      encodeShortVector(data.length),
      data,
    );
  }
  return createHash('sha256').update(Buffer.concat(bytes)).digest('hex');
}

function decodeBase58(value: string, expectedLength?: number): Buffer {
  try {
    const decoded = Buffer.from(bs58.decode(value));
    if (expectedLength !== undefined && decoded.length !== expectedLength) {
      throw new TransactionVerificationError('INVALID_MESSAGE_ADDRESS');
    }
    return decoded;
  } catch (error) {
    if (error instanceof TransactionVerificationError) throw error;
    throw new TransactionVerificationError('INVALID_MESSAGE_ENCODING');
  }
}

function encodeShortVector(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TransactionVerificationError('INVALID_MESSAGE_LENGTH');
  }
  const output: number[] = [];
  let remaining = value;
  do {
    let next = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) next |= 0x80;
    output.push(next);
  } while (remaining > 0);
  return Buffer.from(output);
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
  if (!accountAccessMatchesConstraint(account, constraint)) {
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
    accountAccessMatchesConstraint(account, constraint)
  );
}

function accountAccessMatchesConstraint(
  account: AccountAccess,
  constraint: ExpectedAccountConstraint,
): boolean {
  // Solana compiles account privileges across the full transaction. An account
  // declared read-only by the monitored instruction can therefore become
  // writable when another instruction in the same, message-hash-bound
  // transaction needs write access. Requiring write access remains strict;
  // accepting the compiler's read-only -> writable promotion is safe because
  // the complete serialized message is verified above.
  return constraint.isWritable !== true || account.isWritable;
}

function hashInstructionData(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
