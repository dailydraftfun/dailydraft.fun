import bs58 from 'bs58';

import type { SolanaTransactionEnvelope } from '../transactions/transaction-monitor.types.js';

// A gacha rip is single-player, so there is no escrow instruction to bind it to.
// The duel path can lean on transaction-verifier.ts because the server prepares
// the instruction first and records its message hash; here the player builds the
// transfer in their own wallet, so nothing is known in advance and that verifier
// cannot be reused. What this module checks instead is the settled transaction:
// an SPL transfer of the tier price into the house token account, signed by the
// declared payer, carrying a memo that names exactly one payment intent.
//
// The memo is what makes the evidence non-transferable. Amount and destination
// alone would let any prior transfer of the same tier price be replayed against
// a fresh rip; binding the intent id into the signed message means the payer
// committed to this rip when they signed.

export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SPL_MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const TRANSFER_DISCRIMINATOR = 3;
const TRANSFER_CHECKED_DISCRIMINATOR = 12;
const MAX_MEMO_BYTES = 566;

export type GachaPaymentErrorCode =
  | 'AMBIGUOUS_PAYMENT_TRANSFER'
  | 'AMOUNT_BELOW_TIER_PRICE'
  | 'INVALID_INSTRUCTION_INDEX'
  | 'INVALID_INSTRUCTION_ENCODING'
  | 'MEMO_INTENT_MISMATCH'
  | 'MEMO_MISSING'
  | 'MINT_MISMATCH'
  | 'MISSING_TRANSACTION_META'
  | 'PAYER_NOT_SIGNER'
  | 'TRANSFER_MISSING'
  | 'TRANSACTION_EXECUTION_ERROR';

export class GachaPaymentError extends Error {
  constructor(readonly code: GachaPaymentErrorCode) {
    super(`Gacha payment verification failed: ${code}`);
    this.name = 'GachaPaymentError';
  }
}

export interface GachaPaymentExpectation {
  /** Payment intent id the memo must name, byte-for-byte. */
  readonly intentId: string;
  /** Minor units the transfer must meet or exceed. */
  readonly minimumAmountMinor: bigint;
  /** Mint the transfer must move; only enforceable on `transferChecked`. */
  readonly mint: string;
  /** Wallet that must have signed the transaction. */
  readonly payerWallet: string;
  /** House-owned associated token account the transfer must credit. */
  readonly destinationTokenAccount: string;
}

export interface GachaPaymentEvidence {
  readonly amountMinor: bigint;
  readonly instructionIndex: number;
  /** `transferChecked` carries the mint inline; plain `transfer` does not. */
  readonly mintVerifiedOnChain: boolean;
}

interface DecodedTransfer {
  readonly amount: bigint;
  readonly destinationIndex: number;
  readonly mintIndex: number | null;
}

/**
 * Assert that a settled transaction paid for exactly one rip intent.
 *
 * Throws {@link GachaPaymentError} on the first failed check rather than
 * returning a verdict object: every caller treats any failure as "this rip is
 * not funded", and a thrown code keeps the reason on the audit trail without
 * asking each call site to remember to inspect it.
 */
export function verifyGachaPaymentTransaction(
  envelope: SolanaTransactionEnvelope,
  expectation: GachaPaymentExpectation,
): GachaPaymentEvidence {
  if (!envelope.meta) throw new GachaPaymentError('MISSING_TRANSACTION_META');
  if (envelope.meta.err !== null) throw new GachaPaymentError('TRANSACTION_EXECUTION_ERROR');

  const message = envelope.transaction.message;
  const accountKeys = message.accountKeys;
  // Signers occupy the leading slots of the compiled account list. Checking the
  // payer against that prefix — rather than against the whole list — is what
  // stops a transaction that merely *mentions* the payer from counting as one
  // they authorised.
  const signerCount = message.header.numRequiredSignatures;
  if (!accountKeys.slice(0, signerCount).includes(expectation.payerWallet)) {
    throw new GachaPaymentError('PAYER_NOT_SIGNER');
  }

  assertMemoNamesIntent(envelope, expectation.intentId);

  let matched: GachaPaymentEvidence | null = null;
  for (const [index, instruction] of message.instructions.entries()) {
    if (accountKeyAt(accountKeys, instruction.programIdIndex) !== SPL_TOKEN_PROGRAM_ID) continue;
    const transfer = decodeSplTransfer(decodeInstructionData(instruction.data));
    if (!transfer) continue;
    const destination = accountKeyAt(accountKeys, instruction.accounts[transfer.destinationIndex]);
    if (destination !== expectation.destinationTokenAccount) continue;

    if (transfer.mintIndex !== null) {
      const mint = accountKeyAt(accountKeys, instruction.accounts[transfer.mintIndex]);
      if (mint !== expectation.mint) throw new GachaPaymentError('MINT_MISMATCH');
    }
    // Two transfers into the same token account in one transaction leave the
    // credited amount ambiguous, and picking either one would let a payer stage
    // a decoy alongside a real payment. Refuse rather than guess.
    if (matched) throw new GachaPaymentError('AMBIGUOUS_PAYMENT_TRANSFER');
    matched = {
      amountMinor: transfer.amount,
      instructionIndex: index,
      mintVerifiedOnChain: transfer.mintIndex !== null,
    };
  }

  if (!matched) throw new GachaPaymentError('TRANSFER_MISSING');
  if (matched.amountMinor < expectation.minimumAmountMinor) {
    throw new GachaPaymentError('AMOUNT_BELOW_TIER_PRICE');
  }
  return matched;
}

/**
 * Require exactly one memo instruction naming this intent.
 *
 * A second memo is rejected outright: wallets and explorers surface only the
 * first, so a transaction carrying two would show the player one intent while
 * settling another.
 */
function assertMemoNamesIntent(envelope: SolanaTransactionEnvelope, intentId: string): void {
  const { accountKeys, instructions } = envelope.transaction.message;
  const memos = instructions
    .filter(
      (instruction) =>
        accountKeyAt(accountKeys, instruction.programIdIndex) === SPL_MEMO_PROGRAM_ID,
    )
    .map((instruction) => decodeInstructionData(instruction.data));

  const [memo, ...extraMemos] = memos;
  if (!memo) throw new GachaPaymentError('MEMO_MISSING');
  if (extraMemos.length > 0) throw new GachaPaymentError('MEMO_INTENT_MISMATCH');
  if (memo.length > MAX_MEMO_BYTES) throw new GachaPaymentError('MEMO_INTENT_MISMATCH');
  if (memo.toString('utf8') !== intentId) throw new GachaPaymentError('MEMO_INTENT_MISMATCH');
}

/**
 * Read the amount and account layout of an SPL token transfer.
 *
 * Returns null for any other token instruction so the caller can keep scanning:
 * approvals, account creation, and closes routinely share a transaction with the
 * transfer being verified.
 */
export function decodeSplTransfer(data: Buffer): DecodedTransfer | null {
  const discriminator = data[0];
  // `transferChecked` names the mint inline, which is the only way to prove the
  // transfer moved USDC rather than an arbitrary token minted to look like it.
  // Plain `transfer` omits it; that gap is closed by the caller resolving the
  // destination token account's mint out of band before the intent is issued.
  if (discriminator === TRANSFER_CHECKED_DISCRIMINATOR && data.length >= 10) {
    return { amount: data.readBigUInt64LE(1), destinationIndex: 2, mintIndex: 1 };
  }
  if (discriminator === TRANSFER_DISCRIMINATOR && data.length >= 9) {
    return { amount: data.readBigUInt64LE(1), destinationIndex: 1, mintIndex: null };
  }
  return null;
}

function decodeInstructionData(data: string): Buffer {
  try {
    return Buffer.from(bs58.decode(data));
  } catch {
    throw new GachaPaymentError('INVALID_INSTRUCTION_ENCODING');
  }
}

function accountKeyAt(accountKeys: readonly string[], index: number | undefined): string {
  const key = index === undefined ? undefined : accountKeys[index];
  if (key === undefined) throw new GachaPaymentError('INVALID_INSTRUCTION_INDEX');
  return key;
}
