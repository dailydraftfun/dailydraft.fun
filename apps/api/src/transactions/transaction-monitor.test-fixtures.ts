import { createHash } from 'node:crypto';

import type {
  MonitoredTransaction,
  SolanaTransactionEnvelope,
} from './transaction-monitor.types.js';

const SIGNATURE = '4'.repeat(88);
const SIGNER = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const ESCROW = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const PROGRAM = 'Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS';
const INSTRUCTION_DATA = '3Bxs4NN8M2Yn4TLb';

export function monitoredTransaction(
  overrides: Partial<MonitoredTransaction> = {},
): MonitoredTransaction {
  return {
    action: 'settle',
    allowMultipleInstructionMatches: false,
    checkAttempts: 0,
    duelId: 'duel_123456789012',
    duelStatus: 'settling',
    expectedAccounts: [
      { address: SIGNER, isSigner: true, isWritable: true },
      { address: ESCROW, isWritable: true },
    ],
    expectedFromStatus: 'settling',
    expectedInstructionAccounts: [
      { address: SIGNER, isSigner: true, isWritable: true },
      { address: ESCROW, isWritable: true },
    ],
    expectedInstructionDataHash: createHash('sha256').update(INSTRUCTION_DATA).digest('hex'),
    expectedProgramId: PROGRAM,
    expectedSigner: SIGNER,
    expectedToStatus: 'settled',
    id: 'tx_123456789012',
    lastValidBlockHeight: 2_000n,
    recentBlockhash: 'recent-blockhash',
    signature: SIGNATURE,
    status: 'submitted',
    submittedAt: new Date('2026-07-15T20:00:00.000Z'),
    ...overrides,
  };
}

export function transactionEnvelope(): SolanaTransactionEnvelope {
  return {
    meta: { err: null, loadedAddresses: { readonly: [], writable: [] } },
    transaction: {
      message: {
        accountKeys: [SIGNER, ESCROW, PROGRAM],
        header: {
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 1,
          numRequiredSignatures: 1,
        },
        instructions: [{ accounts: [0, 1], data: INSTRUCTION_DATA, programIdIndex: 2 }],
        recentBlockhash: 'recent-blockhash',
      },
      signatures: [SIGNATURE],
    },
  };
}
