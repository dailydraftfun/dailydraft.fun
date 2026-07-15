import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const ESCROW_V2_SOURCE_SHA = '4aa3bb7560443c0565ded2d6edee67c6a544dd5f';
export const ESCROW_V2_IDL_SHA256 =
  '53ed60b44d5cef022db0301e5d6495ca3bf84486a048c7dd7ce5621a499762e0';
export const ESCROW_V2_PROGRAM_ID = new PublicKey('Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS');
export const FUND_DUEL_DISCRIMINATOR = Uint8Array.from([135, 82, 1, 209, 16, 87, 207, 32]);
export const INITIALIZE_DUEL_DISCRIMINATOR = Uint8Array.from([197, 5, 158, 89, 174, 188, 134, 6]);

export interface EscrowV2Addresses {
  duel: PublicKey;
  paymentVault: PublicKey;
}

export interface InitializeDuelArgs {
  nonce: bigint;
  opponent: PublicKey;
  feeAmount: bigint;
  expiresAt: bigint;
  providerSigner: PublicKey;
  feeRecipient: PublicKey;
  valuationPolicyHash: Uint8Array;
}

export function deriveEscrowV2Addresses(creator: PublicKey, nonce: bigint): EscrowV2Addresses {
  const nonceBytes = encodeInteger(nonce);
  const [duel] = PublicKey.findProgramAddressSync(
    [Buffer.from('duel'), creator.toBuffer(), nonceBytes],
    ESCROW_V2_PROGRAM_ID,
  );
  const [paymentVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), duel.toBuffer()],
    ESCROW_V2_PROGRAM_ID,
  );
  return { duel, paymentVault };
}

export function createInitializeDuelInstruction(input: {
  creator: PublicKey;
  paymentMint: PublicKey;
  addresses: EscrowV2Addresses;
  args: InitializeDuelArgs;
}): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.concat([
      Buffer.from(INITIALIZE_DUEL_DISCRIMINATOR),
      encodeInteger(input.args.nonce),
      Buffer.from([1]),
      input.args.opponent.toBuffer(),
      encodeInteger(input.args.feeAmount),
      encodeInteger(input.args.expiresAt),
      input.args.providerSigner.toBuffer(),
      input.args.feeRecipient.toBuffer(),
      encodeValuationPolicyHash(input.args.valuationPolicyHash),
    ]),
    keys: [
      { pubkey: input.creator, isSigner: true, isWritable: true },
      { pubkey: input.addresses.duel, isSigner: false, isWritable: true },
      { pubkey: input.addresses.paymentVault, isSigner: false, isWritable: true },
      { pubkey: input.paymentMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: ESCROW_V2_PROGRAM_ID,
  });
}

export function createFundDuelInstruction(input: {
  player: PublicKey;
  playerSource: PublicKey;
  paymentMint: PublicKey;
  addresses: EscrowV2Addresses;
}): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.from(FUND_DUEL_DISCRIMINATOR),
    keys: fundDuelAccountConstraints(input),
    programId: ESCROW_V2_PROGRAM_ID,
  });
}

export function fundDuelAccountConstraints(input: {
  player: PublicKey;
  playerSource: PublicKey;
  paymentMint: PublicKey;
  addresses: EscrowV2Addresses;
}): Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }> {
  return [
    { pubkey: input.player, isSigner: true, isWritable: true },
    { pubkey: input.addresses.duel, isSigner: false, isWritable: true },
    { pubkey: input.playerSource, isSigner: false, isWritable: true },
    { pubkey: input.addresses.paymentVault, isSigner: false, isWritable: true },
    { pubkey: input.paymentMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
}

function encodeInteger(value: bigint): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt.asUintN(64, value));
  return bytes;
}

function encodeValuationPolicyHash(value: Uint8Array): Buffer {
  if (value.length !== 32) throw new Error('valuation policy hash must contain 32 bytes');
  return Buffer.from(value);
}
