import { createHash } from 'node:crypto';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';

import { SPL_MEMO_PROGRAM_ID } from './gacha-payment.js';

// The counterpart to gacha-payment.ts: that module reads a settled transfer, this
// one writes the transfer it expects to read back.
//
// The player's wallet does not build this transaction. Every other on-chain path
// in the codebase — duel funding, devnet demo signing, provider settlement — has
// the server assemble the instructions and hand the client opaque bytes to sign,
// and the gacha rail follows suit for the same two reasons. The web app carries
// no Solana SDK, so a client-side build would mean hand-rolling wire
// serialization; and a server-built message can be hashed here and re-checked in
// the wallet, which is how `wallet-provider.tsx` detects tampering between
// preparation and signature.
//
// `transferChecked` is used rather than plain `transfer` deliberately: it names
// the mint inline, so `verifyGachaPaymentTransaction` can prove USDC moved from
// the transaction alone and reports `mintVerifiedOnChain: true`.

export interface GachaPaymentTransactionInput {
  /** Tier price in minor units; must match the intent exactly. */
  readonly amountMinor: bigint;
  readonly decimals: number;
  readonly destinationTokenAccount: string;
  readonly lastValidBlockHeight: bigint;
  /** Entire memo payload — the only thing binding this transfer to the intent. */
  readonly memoNonce: string;
  readonly mint: string;
  readonly payerWallet: string;
  readonly recentBlockhash: string;
}

export interface BuiltGachaPaymentTransaction {
  /** sha256 of the compiled message, for the wallet-side tamper check. */
  readonly expectedMessageHash: string;
  readonly serializedTransactionBase64: string;
  /** The payer's associated token account the transfer debits. */
  readonly sourceTokenAccount: string;
}

/**
 * Compose the unsigned transfer + memo a payer must sign to fund one rip.
 *
 * The payer is the fee payer as well as the token owner, so they occupy the
 * leading signer slot and satisfy the `PAYER_NOT_SIGNER` check on the way back
 * in. No associated-token-account creation instruction is added: a payer with no
 * USDC account has no USDC to send, and paying rent to open an empty account
 * would only turn an obvious failure into a silent one.
 */
export function buildGachaPaymentTransaction(
  input: GachaPaymentTransactionInput,
): BuiltGachaPaymentTransaction {
  const payer = new PublicKey(input.payerWallet);
  const mint = new PublicKey(input.mint);
  const destination = new PublicKey(input.destinationTokenAccount);
  const source = getAssociatedTokenAddressSync(mint, payer);

  const transaction = new Transaction({
    blockhash: input.recentBlockhash,
    feePayer: payer,
    lastValidBlockHeight: Number(input.lastValidBlockHeight),
  });
  transaction.add(
    createTransferCheckedInstruction(
      source,
      mint,
      destination,
      payer,
      input.amountMinor,
      input.decimals,
    ),
    createMemoInstruction(input.memoNonce),
  );

  return {
    expectedMessageHash: createHash('sha256').update(transaction.serializeMessage()).digest('hex'),
    serializedTransactionBase64: transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64'),
    sourceTokenAccount: source.toBase58(),
  };
}

/**
 * An SPL memo carrying the intent id and nothing else.
 *
 * The memo program treats every account passed to it as a co-signer to record,
 * so the key list stays empty: the payer already signs the transaction, and
 * naming them again would add a signature requirement without adding evidence.
 */
function createMemoInstruction(memoNonce: string): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.from(memoNonce, 'utf8'),
    keys: [],
    programId: new PublicKey(SPL_MEMO_PROGRAM_ID),
  });
}
