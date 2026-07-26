import { describe, expect, test } from 'bun:test';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Message, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import type { SolanaTransactionEnvelope } from '../transactions/transaction-monitor.types.js';
import {
  decodeSplTransfer,
  SPL_MEMO_PROGRAM_ID,
  verifyGachaPaymentTransaction,
} from './gacha-payment.js';
import { buildGachaPaymentTransaction } from './gacha-transaction.js';

// Unlike the verifier's fixtures, this one has to be a real on-curve public key:
// deriving an associated token account rejects off-curve owners, which is the
// correct behaviour for a wallet that must be able to sign.
const PAYER = '9e5GLpBatYF8Utb9McZUxw96b17f22oJEtG72ZLUYqGV';
const HOUSE_TOKEN_ACCOUNT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const INTENT_ID = 'gachapay_4f6c1d90a37b48e2ac5518d0f27b6e34';
const BLOCKHASH = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TIER_PRICE = 50_000_000n;

function build(overrides: Partial<Parameters<typeof buildGachaPaymentTransaction>[0]> = {}) {
  return buildGachaPaymentTransaction({
    amountMinor: TIER_PRICE,
    decimals: 6,
    destinationTokenAccount: HOUSE_TOKEN_ACCOUNT,
    lastValidBlockHeight: 412_000_000n,
    memoNonce: INTENT_ID,
    mint: USDC_MINT,
    payerWallet: PAYER,
    recentBlockhash: BLOCKHASH,
    ...overrides,
  });
}

/**
 * Re-read the built bytes the way the RPC would hand them back after landing.
 *
 * This is what makes the round-trip test meaningful: the envelope is decoded
 * from the actual serialized message rather than hand-written, so a builder that
 * emits instructions the verifier cannot parse fails here instead of on devnet.
 */
function landed(serializedTransactionBase64: string): SolanaTransactionEnvelope {
  const transaction = Transaction.from(Buffer.from(serializedTransactionBase64, 'base64'));
  const message = Message.from(transaction.serializeMessage());

  return {
    meta: { err: null },
    transaction: {
      message: {
        accountKeys: message.accountKeys.map((key) => key.toBase58()),
        header: message.header,
        instructions: message.instructions.map((instruction) => ({
          accounts: instruction.accounts,
          data: instruction.data,
          programIdIndex: instruction.programIdIndex,
        })),
        recentBlockhash: message.recentBlockhash,
      },
      signatures: [],
    },
  };
}

describe('buildGachaPaymentTransaction', () => {
  test('produces a transfer the payment verifier accepts', () => {
    const built = build();

    const evidence = verifyGachaPaymentTransaction(landed(built.serializedTransactionBase64), {
      destinationTokenAccount: HOUSE_TOKEN_ACCOUNT,
      intentId: INTENT_ID,
      minimumAmountMinor: TIER_PRICE,
      mint: USDC_MINT,
      payerWallet: PAYER,
    });

    expect(evidence).toEqual({
      amountMinor: TIER_PRICE,
      instructionIndex: 0,
      mintVerifiedOnChain: true,
    });
  });

  test('debits the payer associated token account', () => {
    const built = build();

    expect(built.sourceTokenAccount).toBe(
      getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(PAYER)).toBase58(),
    );
  });

  test('encodes transferChecked so the mint is provable from the transaction alone', () => {
    const envelope = landed(build().serializedTransactionBase64);
    const message = envelope.transaction.message;
    const transferInstruction = message.instructions.find(
      (instruction) =>
        message.accountKeys[instruction.programIdIndex] === TOKEN_PROGRAM_ID.toBase58(),
    );

    const decoded = decodeSplTransfer(Buffer.from(bs58.decode(transferInstruction?.data ?? '')));

    expect(decoded).toEqual({ amount: TIER_PRICE, destinationIndex: 2, mintIndex: 1 });
  });

  test('carries the intent id as the entire memo payload', () => {
    const envelope = landed(build().serializedTransactionBase64);
    const message = envelope.transaction.message;
    const memoInstruction = message.instructions.find(
      (instruction) => message.accountKeys[instruction.programIdIndex] === SPL_MEMO_PROGRAM_ID,
    );

    expect(memoInstruction?.accounts).toEqual([]);
    expect(Buffer.from(bs58.decode(memoInstruction?.data ?? '')).toString('utf8')).toBe(INTENT_ID);
  });

  test('puts the payer in the leading signer slot', () => {
    const message = landed(build().serializedTransactionBase64).transaction.message;

    expect(message.header.numRequiredSignatures).toBe(1);
    expect(message.accountKeys[0]).toBe(PAYER);
  });

  test('hashes the compiled message so the wallet can detect tampering', () => {
    // Identical inputs must hash identically or the client-side tamper check
    // would reject its own transaction; a changed amount must not.
    expect(build().expectedMessageHash).toBe(build().expectedMessageHash);
    expect(build({ amountMinor: TIER_PRICE + 1n }).expectedMessageHash).not.toBe(
      build().expectedMessageHash,
    );
  });
});
