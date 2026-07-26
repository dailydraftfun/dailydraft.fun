import { describe, expect, test } from 'bun:test';

import { monitoredTransaction, transactionEnvelope } from './transaction-monitor.test-fixtures.js';
import type { MonitoredTransaction } from './transaction-monitor.types.js';
import {
  hashTransactionMessage,
  TransactionVerificationError,
  verifyTransactionEnvelope,
} from './transaction-verifier.js';

describe('verifyTransactionEnvelope', () => {
  test('accepts the stored signer, program, blockhash, and account access constraints', () => {
    expect(() =>
      verifyTransactionEnvelope(monitoredTransaction(), transactionEnvelope()),
    ).not.toThrow();
  });

  test('rejects a finalized transaction that invokes another program', () => {
    const envelope = transactionEnvelope();
    envelope.transaction.message.instructions[0] = {
      accounts: [0, 1],
      data: envelope.transaction.message.instructions[0]?.data ?? '',
      programIdIndex: 1,
    };

    expectVerificationCode(envelope, 'INSTRUCTION_MISMATCH');
  });

  test('rejects a destination account that is not writable', () => {
    const envelope = transactionEnvelope();
    envelope.transaction.message.header.numReadonlyUnsignedAccounts = 2;

    expectVerificationCode(envelope, 'ACCOUNT_ACCESS_MISMATCH');
  });

  test('rejects expected accounts split across an unrelated instruction', () => {
    const envelope = transactionEnvelope();
    const target = envelope.transaction.message.instructions[0];
    if (!target) throw new Error('Missing fixture instruction');
    envelope.transaction.message.instructions = [
      { accounts: [], data: target.data, programIdIndex: target.programIdIndex },
      { accounts: [0, 1], data: '2', programIdIndex: 1 },
    ];

    expectVerificationCode(envelope, 'INSTRUCTION_MISMATCH');
  });

  test('rejects ambiguous duplicate target instructions by default', () => {
    const envelope = transactionEnvelope();
    const target = envelope.transaction.message.instructions[0];
    if (!target) throw new Error('Missing fixture instruction');
    envelope.transaction.message.instructions.push({ ...target, accounts: [...target.accounts] });

    expectVerificationCode(envelope, 'AMBIGUOUS_INSTRUCTION_MATCH');
  });

  test('accepts a read-only instruction signer promoted to writable by the full message', () => {
    const base = monitoredTransaction();
    const transaction = monitoredTransaction({
      expectedAccounts: [
        {
          address: base.expectedSigner,
          isSigner: true,
          isWritable: false,
        },
        base.expectedAccounts[1] ?? {
          address: 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW',
          isWritable: true,
        },
      ],
      expectedInstructionAccounts: [
        {
          address: base.expectedSigner,
          isSigner: true,
          isWritable: false,
        },
        base.expectedInstructionAccounts[1] ?? {
          address: 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW',
          isWritable: true,
        },
      ],
    });

    expect(() => verifyTransactionEnvelope(transaction, transactionEnvelope())).not.toThrow();
  });

  test('rejects any mutation to another instruction in the bound message', () => {
    const envelope = transactionEnvelope();
    envelope.transaction.message.instructions.unshift({
      accounts: [0],
      data: '3',
      programIdIndex: 2,
    });

    expectVerificationCode(envelope, 'MESSAGE_MISMATCH', false);
  });

  test('accepts a writable account supplied by an address lookup table', () => {
    const envelope = transactionEnvelope();
    envelope.meta = { err: null, loadedAddresses: { readonly: [], writable: [LOOKUP_ACCOUNT] } };

    expect(() =>
      verifyTransactionEnvelope(
        withExtraAccount({ address: LOOKUP_ACCOUNT, isWritable: true }),
        envelope,
      ),
    ).not.toThrow();
  });

  test('rejects a lookup-table account the message only loaded read-only', () => {
    const envelope = transactionEnvelope();
    envelope.meta = { err: null, loadedAddresses: { readonly: [LOOKUP_ACCOUNT], writable: [] } };

    expectAccountFailure(
      withExtraAccount({ address: LOOKUP_ACCOUNT, isWritable: true }),
      envelope,
      'ACCOUNT_ACCESS_MISMATCH',
    );
  });

  test('rejects a lookup-table account on a message that loaded no addresses', () => {
    const envelope = transactionEnvelope();
    envelope.meta = { err: null };

    // A versioned message whose lookup tables the RPC could not resolve must
    // fail shut rather than let an unresolved account satisfy a constraint.
    expectAccountFailure(
      withExtraAccount({ address: LOOKUP_ACCOUNT, isWritable: true }),
      envelope,
      'ACCOUNT_MISSING',
    );
  });

  test('does not let a lookup-table entry restate a static account', () => {
    const envelope = transactionEnvelope();
    // Lookup-table entries are never signers, so an entry duplicating the fee
    // payer would strip its signer privilege if it could shadow the static
    // account. Static accounts are resolved first precisely so it cannot.
    envelope.meta = {
      err: null,
      loadedAddresses: { readonly: [monitoredTransaction().expectedSigner], writable: [] },
    };

    expect(() => verifyTransactionEnvelope(monitoredTransaction(), envelope)).not.toThrow();
  });
});

const LOOKUP_ACCOUNT = 'HxhWkVpk5NS4Ltg5nij2G671CKXFRKPK8vy271Ub4uEK';

function withExtraAccount(
  constraint: MonitoredTransaction['expectedAccounts'][number],
): MonitoredTransaction {
  const base = monitoredTransaction();
  return monitoredTransaction({ expectedAccounts: [...base.expectedAccounts, constraint] });
}

function expectAccountFailure(
  transaction: MonitoredTransaction,
  envelope: ReturnType<typeof transactionEnvelope>,
  expectedCode: string,
): void {
  try {
    verifyTransactionEnvelope(transaction, envelope);
    throw new Error('Expected transaction verification to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionVerificationError);
    if (!(error instanceof TransactionVerificationError)) throw error;
    expect(error.code).toBe(expectedCode);
  }
}

function expectVerificationCode(
  envelope: ReturnType<typeof transactionEnvelope>,
  expectedCode: string,
  bindMutatedMessage = true,
): void {
  try {
    verifyTransactionEnvelope(
      monitoredTransaction({
        ...(bindMutatedMessage ? { expectedMessageHash: hashTransactionMessage(envelope) } : {}),
      }),
      envelope,
    );
    throw new Error('Expected transaction verification to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionVerificationError);
    if (!(error instanceof TransactionVerificationError)) throw error;
    expect(error.code).toBe(expectedCode);
  }
}
