import { describe, expect, test } from 'bun:test';
import bs58 from 'bs58';

import type { SolanaTransactionEnvelope } from '../transactions/transaction-monitor.types.js';
import {
  decodeSplTransfer,
  GachaPaymentError,
  type GachaPaymentErrorCode,
  type GachaPaymentExpectation,
  SPL_MEMO_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  verifyGachaPaymentTransaction,
} from './gacha-payment.js';

const PAYER = 'BkS1e5Kx8dCVAV4vXHzr4y6bTs2hUcHYD9Y4tzk6Bdub';
const SOURCE_TOKEN_ACCOUNT = 'GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS';
const HOUSE_TOKEN_ACCOUNT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OTHER_TOKEN_ACCOUNT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
// Matches GachaRipPayment.memoNonce's persisted shape: `gachapay_` + 32 hex.
const INTENT_ID = 'gachapay_4f6c1d90a37b48e2ac5518d0f27b6e34';

// Compiled Solana messages address accounts by index, so every fixture shares one
// key table and instructions point into it. Signers must occupy the leading slots.
const ACCOUNT_KEYS = [
  PAYER, // 0 — signer / token owner
  SOURCE_TOKEN_ACCOUNT, // 1
  HOUSE_TOKEN_ACCOUNT, // 2
  USDC_MINT, // 3
  SPL_TOKEN_PROGRAM_ID, // 4
  SPL_MEMO_PROGRAM_ID, // 5
  OTHER_TOKEN_ACCOUNT, // 6
];

type Instruction = { accounts: number[]; data: string; programIdIndex: number };

const TIER_PRICE = 50_000_000n;

function expectation(overrides: Partial<GachaPaymentExpectation> = {}): GachaPaymentExpectation {
  return {
    destinationTokenAccount: HOUSE_TOKEN_ACCOUNT,
    intentId: INTENT_ID,
    minimumAmountMinor: TIER_PRICE,
    mint: USDC_MINT,
    payerWallet: PAYER,
    ...overrides,
  };
}

function transferCheckedData(amount: bigint, decimals = 6): string {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return bs58.encode(data);
}

function transferData(amount: bigint): string {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(amount, 1);
  return bs58.encode(data);
}

/** `transferChecked` account order is [source, mint, destination, owner]. */
function transferCheckedInstruction(amount = TIER_PRICE, destinationIndex = 2): Instruction {
  return {
    accounts: [1, 3, destinationIndex, 0],
    data: transferCheckedData(amount),
    programIdIndex: 4,
  };
}

/** Plain `transfer` account order is [source, destination, owner] — no mint. */
function transferInstruction(amount = TIER_PRICE, destinationIndex = 2): Instruction {
  return { accounts: [1, destinationIndex, 0], data: transferData(amount), programIdIndex: 4 };
}

function memoInstruction(text = INTENT_ID): Instruction {
  return { accounts: [0], data: bs58.encode(Buffer.from(text, 'utf8')), programIdIndex: 5 };
}

function envelopeWith(
  instructions: Instruction[],
  overrides: {
    accountKeys?: string[];
    err?: unknown;
    meta?: null;
    numRequiredSignatures?: number;
  } = {},
): SolanaTransactionEnvelope {
  return {
    meta: overrides.meta === null ? null : { err: overrides.err ?? null, loadedAddresses: null },
    transaction: {
      message: {
        accountKeys: overrides.accountKeys ?? [...ACCOUNT_KEYS],
        header: {
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 3,
          numRequiredSignatures: overrides.numRequiredSignatures ?? 1,
        },
        instructions,
        recentBlockhash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      },
      signatures: [
        '5HxUXJ2mQm4FL4Y5MpHT9CzGSjeqxCT7QuBRGRcQZgYRC9nBWNe6RcT4tRSMFHRJXFmMSPPKHrjrfLxTX8N9pQzL',
      ],
    },
  };
}

function expectPaymentCode(
  envelope: SolanaTransactionEnvelope,
  code: GachaPaymentErrorCode,
  paymentExpectation: GachaPaymentExpectation = expectation(),
): void {
  try {
    verifyGachaPaymentTransaction(envelope, paymentExpectation);
  } catch (error) {
    expect(error).toBeInstanceOf(GachaPaymentError);
    expect((error as GachaPaymentError).code).toBe(code);
    return;
  }
  throw new Error(`Expected verification to fail with ${code}`);
}

describe('verifyGachaPaymentTransaction', () => {
  test('accepts a memo-bound transferChecked into the house token account', () => {
    const envelope = envelopeWith([memoInstruction(), transferCheckedInstruction()]);

    expect(verifyGachaPaymentTransaction(envelope, expectation())).toEqual({
      amountMinor: TIER_PRICE,
      instructionIndex: 1,
      mintVerifiedOnChain: true,
    });
  });

  test('accepts a plain transfer but reports the mint as unverified on chain', () => {
    const envelope = envelopeWith([transferInstruction(), memoInstruction()]);

    expect(verifyGachaPaymentTransaction(envelope, expectation())).toEqual({
      amountMinor: TIER_PRICE,
      instructionIndex: 0,
      mintVerifiedOnChain: false,
    });
  });

  test('accepts an overpayment and reports the amount that actually landed', () => {
    const envelope = envelopeWith([memoInstruction(), transferCheckedInstruction(TIER_PRICE + 1n)]);

    expect(verifyGachaPaymentTransaction(envelope, expectation()).amountMinor).toBe(
      TIER_PRICE + 1n,
    );
  });

  test('rejects a transfer one minor unit short of the tier price', () => {
    const envelope = envelopeWith([memoInstruction(), transferCheckedInstruction(TIER_PRICE - 1n)]);

    expectPaymentCode(envelope, 'AMOUNT_BELOW_TIER_PRICE');
  });

  test('rejects a transaction the RPC has not attached metadata to', () => {
    const envelope = envelopeWith([memoInstruction(), transferCheckedInstruction()], {
      meta: null,
    });

    expectPaymentCode(envelope, 'MISSING_TRANSACTION_META');
  });

  test('rejects a transaction that landed with an execution error', () => {
    const envelope = envelopeWith([memoInstruction(), transferCheckedInstruction()], {
      err: { InstructionError: [1, { Custom: 1 }] },
    });

    expectPaymentCode(envelope, 'TRANSACTION_EXECUTION_ERROR');
  });

  test('rejects a payer that appears in the message but signed nothing', () => {
    // Swapping the leading slot leaves the payer present at index 1, outside the
    // signer prefix — the exact shape an attacker would submit to claim someone
    // else's transfer.
    const accountKeys = [...ACCOUNT_KEYS];
    accountKeys[0] = OTHER_TOKEN_ACCOUNT;
    accountKeys[1] = PAYER;
    const envelope = envelopeWith([memoInstruction(), transferCheckedInstruction()], {
      accountKeys,
    });

    expectPaymentCode(envelope, 'PAYER_NOT_SIGNER');
  });

  test('accepts a payer signing alongside a co-signer', () => {
    const accountKeys = [...ACCOUNT_KEYS];
    accountKeys[0] = OTHER_TOKEN_ACCOUNT;
    accountKeys[1] = PAYER;
    const envelope = envelopeWith([memoInstruction(), transferCheckedInstruction()], {
      accountKeys,
      numRequiredSignatures: 2,
    });

    expect(verifyGachaPaymentTransaction(envelope, expectation()).amountMinor).toBe(TIER_PRICE);
  });

  test('rejects a transfer carrying no memo at all', () => {
    const envelope = envelopeWith([transferCheckedInstruction()]);

    expectPaymentCode(envelope, 'MEMO_MISSING');
  });

  test('rejects a memo naming a different intent', () => {
    const envelope = envelopeWith([
      memoInstruction('grp_someone_elses_intent'),
      transferCheckedInstruction(),
    ]);

    expectPaymentCode(envelope, 'MEMO_INTENT_MISMATCH');
  });

  test('rejects two memos even when one of them names this intent', () => {
    const envelope = envelopeWith([
      memoInstruction(),
      memoInstruction('grp_decoy_intent'),
      transferCheckedInstruction(),
    ]);

    expectPaymentCode(envelope, 'MEMO_INTENT_MISMATCH');
  });

  test('rejects a memo longer than the SPL memo program accepts', () => {
    const envelope = envelopeWith([memoInstruction('x'.repeat(567)), transferCheckedInstruction()]);

    expectPaymentCode(envelope, 'MEMO_INTENT_MISMATCH');
  });

  test('rejects a transferChecked that moves a mint other than the expected one', () => {
    const accountKeys = [...ACCOUNT_KEYS];
    accountKeys[3] = OTHER_TOKEN_ACCOUNT;
    const envelope = envelopeWith([memoInstruction(), transferCheckedInstruction()], {
      accountKeys,
    });

    expectPaymentCode(envelope, 'MINT_MISMATCH');
  });

  test('rejects two transfers crediting the same house token account', () => {
    const envelope = envelopeWith([
      memoInstruction(),
      transferCheckedInstruction(),
      transferInstruction(1n),
    ]);

    expectPaymentCode(envelope, 'AMBIGUOUS_PAYMENT_TRANSFER');
  });

  test('reports no transfer when the transaction only carries a memo', () => {
    const envelope = envelopeWith([memoInstruction()]);

    expectPaymentCode(envelope, 'TRANSFER_MISSING');
  });

  test('ignores transfers addressed to a token account other than the house one', () => {
    const envelope = envelopeWith([memoInstruction(), transferCheckedInstruction(TIER_PRICE, 6)]);

    expectPaymentCode(envelope, 'TRANSFER_MISSING');
  });

  test('ignores non-transfer token instructions sharing the transaction', () => {
    const approve: Instruction = {
      accounts: [1, 2, 0],
      data: bs58.encode(Buffer.from([4, 0])),
      programIdIndex: 4,
    };
    const envelope = envelopeWith([approve, memoInstruction(), transferCheckedInstruction()]);

    expect(verifyGachaPaymentTransaction(envelope, expectation()).instructionIndex).toBe(2);
  });

  test('ignores instructions belonging to unrelated programs', () => {
    const accountKeys = [...ACCOUNT_KEYS, '11111111111111111111111111111111'];
    const systemTransfer: Instruction = {
      accounts: [0, 2],
      data: transferData(TIER_PRICE),
      programIdIndex: 7,
    };
    const envelope = envelopeWith(
      [systemTransfer, memoInstruction(), transferCheckedInstruction()],
      {
        accountKeys,
      },
    );

    expect(verifyGachaPaymentTransaction(envelope, expectation()).instructionIndex).toBe(2);
  });

  test('rejects instruction data that is not valid base58', () => {
    const envelope = envelopeWith([
      memoInstruction(),
      { ...transferCheckedInstruction(), data: '0OIl' },
    ]);

    expectPaymentCode(envelope, 'INVALID_INSTRUCTION_ENCODING');
  });

  test('rejects a program index pointing past the account table', () => {
    const envelope = envelopeWith([{ ...transferCheckedInstruction(), programIdIndex: 99 }]);

    expectPaymentCode(envelope, 'INVALID_INSTRUCTION_INDEX');
  });

  test('rejects a transfer whose destination slot points past the account table', () => {
    const envelope = envelopeWith([
      memoInstruction(),
      { ...transferCheckedInstruction(), accounts: [1, 3, 99, 0] },
    ]);

    expectPaymentCode(envelope, 'INVALID_INSTRUCTION_INDEX');
  });

  test('rejects a transfer whose account list is too short to name a destination', () => {
    const envelope = envelopeWith([
      memoInstruction(),
      { ...transferCheckedInstruction(), accounts: [1, 3] },
    ]);

    expectPaymentCode(envelope, 'INVALID_INSTRUCTION_INDEX');
  });
});

describe('decodeSplTransfer', () => {
  test('reads the amount and account layout of transferChecked', () => {
    expect(decodeSplTransfer(Buffer.from(bs58.decode(transferCheckedData(1_234n))))).toEqual({
      amount: 1_234n,
      destinationIndex: 2,
      mintIndex: 1,
    });
  });

  test('reads the amount and account layout of a plain transfer', () => {
    expect(decodeSplTransfer(Buffer.from(bs58.decode(transferData(1_234n))))).toEqual({
      amount: 1_234n,
      destinationIndex: 1,
      mintIndex: null,
    });
  });

  test('refuses a transferChecked truncated before its decimals byte', () => {
    expect(decodeSplTransfer(Buffer.from([12, 1, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  test('refuses a transfer truncated before its full amount', () => {
    expect(decodeSplTransfer(Buffer.from([3, 1, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  test('refuses an empty instruction payload', () => {
    expect(decodeSplTransfer(Buffer.alloc(0))).toBeNull();
  });

  test('refuses an unrelated token instruction discriminator', () => {
    expect(decodeSplTransfer(Buffer.from([7, 1, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe('GachaPaymentError', () => {
  test('carries the failure code on both the name and the message', () => {
    const error = new GachaPaymentError('MEMO_MISSING');

    expect(error.name).toBe('GachaPaymentError');
    expect(error.code).toBe('MEMO_MISSING');
    expect(error.message).toContain('MEMO_MISSING');
  });
});
