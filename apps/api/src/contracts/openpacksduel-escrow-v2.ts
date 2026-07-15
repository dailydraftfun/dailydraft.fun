import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const ESCROW_V2_SOURCE_SHA = '4aa3bb7560443c0565ded2d6edee67c6a544dd5f';
export const ESCROW_V2_IDL_SHA256 =
  '53ed60b44d5cef022db0301e5d6495ca3bf84486a048c7dd7ce5621a499762e0';
export const ESCROW_V2_PROGRAM_ID = new PublicKey('Co198eFfQcmn1WzZRnHV6jxcSLBDCv1qNfPfiBYdCLfS');
export const ESCROW_V2_MAX_OPENING_FUTURE_SKEW_SECONDS = 30n;
export const FUND_DUEL_DISCRIMINATOR = Uint8Array.from([135, 82, 1, 209, 16, 87, 207, 32]);
export const INITIALIZE_DUEL_DISCRIMINATOR = Uint8Array.from([197, 5, 158, 89, 174, 188, 134, 6]);
export const DEPOSIT_CARD_ASSET_DISCRIMINATOR = Uint8Array.from([
  212, 169, 85, 35, 162, 91, 119, 42,
]);
export const SUBMIT_RESULT_DISCRIMINATOR = Uint8Array.from([240, 42, 89, 180, 10, 239, 9, 214]);
export const SETTLE_DUEL_DISCRIMINATOR = Uint8Array.from([148, 90, 251, 130, 217, 144, 190, 239]);
export const REFUND_EXPIRED_PAYMENT_DISCRIMINATOR = Uint8Array.from([
  82, 5, 192, 101, 25, 133, 163, 209,
]);
export const REFUND_EXPIRED_CARD_DISCRIMINATOR = Uint8Array.from([
  160, 130, 63, 132, 223, 30, 235, 144,
]);

export type EscrowV2Role = 'creator' | 'opponent';

export interface EscrowV2Addresses {
  duel: PublicKey;
  paymentVault: PublicKey;
}

export interface EscrowV2CardAddresses {
  creatorCardVault: PublicKey;
  opponentCardVault: PublicKey;
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

export function toEscrowV2UnixSeconds(value: Date): bigint {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new Error('escrow timestamp must be a valid date');
  return BigInt(Math.floor(milliseconds / 1_000));
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

export function deriveEscrowV2CardVault(duel: PublicKey, role: EscrowV2Role): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('card-vault'), duel.toBuffer(), Buffer.from(role)],
    ESCROW_V2_PROGRAM_ID,
  )[0];
}

export function deriveEscrowV2ResultCommitment(
  providerSigner: PublicKey,
  providerRequestId: Uint8Array,
): PublicKey {
  const requestId = encodeBytes32(providerRequestId, 'provider request ID');
  if (requestId.every((value) => value === 0))
    throw new Error('provider request ID cannot be zero');
  return PublicKey.findProgramAddressSync(
    [Buffer.from('result'), providerSigner.toBuffer(), requestId],
    ESCROW_V2_PROGRAM_ID,
  )[0];
}

export function createDepositCardAssetInstruction(input: {
  depositor: PublicKey;
  duel: PublicKey;
  depositorSource: PublicKey;
  cardMint: PublicKey;
  role: EscrowV2Role;
}): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.concat([
      Buffer.from(DEPOSIT_CARD_ASSET_DISCRIMINATOR),
      Buffer.from([roleIndex(input.role), 0]),
    ]),
    keys: [
      { pubkey: input.depositor, isSigner: true, isWritable: true },
      { pubkey: input.duel, isSigner: false, isWritable: true },
      { pubkey: input.depositorSource, isSigner: false, isWritable: true },
      {
        pubkey: deriveEscrowV2CardVault(input.duel, input.role),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: input.cardMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: ESCROW_V2_PROGRAM_ID,
  });
}

export function createSubmitResultInstruction(input: {
  providerSigner: PublicKey;
  duel: PublicKey;
  providerRequestId: Uint8Array;
  creator: PublicKey;
  opponent: PublicKey;
  creatorCardMint: PublicKey;
  opponentCardMint: PublicKey;
  valuationPolicyHash: Uint8Array;
  creatorValue: bigint;
  opponentValue: bigint;
  openedAt: bigint;
}): { instruction: TransactionInstruction; resultCommitment: PublicKey } {
  const resultCommitment = deriveEscrowV2ResultCommitment(
    input.providerSigner,
    input.providerRequestId,
  );
  const instruction = new TransactionInstruction({
    data: Buffer.concat([
      Buffer.from(SUBMIT_RESULT_DISCRIMINATOR),
      input.duel.toBuffer(),
      encodeBytes32(input.providerRequestId, 'provider request ID'),
      input.creator.toBuffer(),
      input.opponent.toBuffer(),
      input.creatorCardMint.toBuffer(),
      input.opponentCardMint.toBuffer(),
      Buffer.from([0, 0]),
      encodeValuationPolicyHash(input.valuationPolicyHash),
      encodeInteger(input.creatorValue),
      encodeInteger(input.opponentValue),
      encodeInteger(input.openedAt),
    ]),
    keys: [
      { pubkey: input.providerSigner, isSigner: true, isWritable: true },
      { pubkey: input.duel, isSigner: false, isWritable: true },
      { pubkey: resultCommitment, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: ESCROW_V2_PROGRAM_ID,
  });
  return { instruction, resultCommitment };
}

export function createSettleDuelInstruction(input: {
  caller: PublicKey;
  duel: PublicKey;
  resultCommitment: PublicKey;
  paymentVault: PublicKey;
  paymentMint: PublicKey;
  creatorPaymentDestination: PublicKey;
  opponentPaymentDestination: PublicKey;
  feeDestination: PublicKey;
  creatorCardMint: PublicKey;
  creatorCardDestination: PublicKey;
  opponentCardMint: PublicKey;
  opponentCardDestination: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.from(SETTLE_DUEL_DISCRIMINATOR),
    keys: [
      { pubkey: input.caller, isSigner: true, isWritable: false },
      { pubkey: input.duel, isSigner: false, isWritable: true },
      { pubkey: input.resultCommitment, isSigner: false, isWritable: true },
      { pubkey: input.paymentVault, isSigner: false, isWritable: true },
      { pubkey: input.paymentMint, isSigner: false, isWritable: false },
      { pubkey: input.creatorPaymentDestination, isSigner: false, isWritable: true },
      { pubkey: input.opponentPaymentDestination, isSigner: false, isWritable: true },
      { pubkey: input.feeDestination, isSigner: false, isWritable: true },
      {
        pubkey: deriveEscrowV2CardVault(input.duel, 'creator'),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: input.creatorCardMint, isSigner: false, isWritable: false },
      { pubkey: input.creatorCardDestination, isSigner: false, isWritable: true },
      {
        pubkey: deriveEscrowV2CardVault(input.duel, 'opponent'),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: input.opponentCardMint, isSigner: false, isWritable: false },
      { pubkey: input.opponentCardDestination, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ESCROW_V2_PROGRAM_ID,
  });
}

export function createRefundExpiredPaymentInstruction(input: {
  caller: PublicKey;
  duel: PublicKey;
  paymentVault: PublicKey;
  destination: PublicKey;
  paymentMint: PublicKey;
  player: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.concat([
      Buffer.from(REFUND_EXPIRED_PAYMENT_DISCRIMINATOR),
      input.player.toBuffer(),
    ]),
    keys: [
      { pubkey: input.caller, isSigner: true, isWritable: false },
      { pubkey: input.duel, isSigner: false, isWritable: true },
      { pubkey: input.paymentVault, isSigner: false, isWritable: true },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: input.paymentMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ESCROW_V2_PROGRAM_ID,
  });
}

export function createRefundExpiredCardInstruction(input: {
  caller: PublicKey;
  duel: PublicKey;
  destination: PublicKey;
  cardMint: PublicKey;
  role: EscrowV2Role;
}): TransactionInstruction {
  return new TransactionInstruction({
    data: Buffer.concat([
      Buffer.from(REFUND_EXPIRED_CARD_DISCRIMINATOR),
      Buffer.from([roleIndex(input.role)]),
    ]),
    keys: [
      { pubkey: input.caller, isSigner: true, isWritable: false },
      { pubkey: input.duel, isSigner: false, isWritable: true },
      {
        pubkey: deriveEscrowV2CardVault(input.duel, input.role),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: input.cardMint, isSigner: false, isWritable: false },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: ESCROW_V2_PROGRAM_ID,
  });
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

function encodeBytes32(value: Uint8Array, label: string): Buffer {
  if (value.length !== 32) throw new Error(`${label} must contain 32 bytes`);
  return Buffer.from(value);
}

function roleIndex(role: EscrowV2Role): number {
  return role === 'creator' ? 0 : 1;
}
