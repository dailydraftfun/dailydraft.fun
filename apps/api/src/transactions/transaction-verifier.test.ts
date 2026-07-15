import { describe, expect, test } from 'bun:test';

import { monitoredTransaction, transactionEnvelope } from './transaction-monitor.test-fixtures.js';
import { TransactionVerificationError, verifyTransactionEnvelope } from './transaction-verifier.js';

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
      { accounts: [0, 1], data: 'unrelated', programIdIndex: 1 },
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
});

function expectVerificationCode(
  envelope: ReturnType<typeof transactionEnvelope>,
  expectedCode: string,
): void {
  try {
    verifyTransactionEnvelope(monitoredTransaction(), envelope);
    throw new Error('Expected transaction verification to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionVerificationError);
    if (!(error instanceof TransactionVerificationError)) throw error;
    expect(error.code).toBe(expectedCode);
  }
}
