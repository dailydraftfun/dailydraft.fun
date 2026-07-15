import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type DatabaseClient,
  DuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
  type Prisma,
} from '@openpacksduel/db';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AdminService } from '../admin/admin.service.js';
import {
  createFundDuelInstruction,
  createInitializeDuelInstruction,
  deriveEscrowV2Addresses,
  ESCROW_V2_IDL_SHA256,
  ESCROW_V2_PROGRAM_ID,
  ESCROW_V2_SOURCE_SHA,
  FUND_DUEL_DISCRIMINATOR,
  fundDuelAccountConstraints,
} from '../contracts/openpacksduel-escrow-v2.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import { CANONICAL_VALUATION_POLICY_HASH } from '../providers/valuation-policy.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { HouseTreasuryService } from '../treasury/house-treasury.service.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway, SolanaRpcUnavailableError } from './solana-rpc.client.js';
import type { ExpectedAccountConstraint } from './transaction-monitor.types.js';

const BLOCKHASH_REVIEW_WINDOW_MS = 75_000;
const MIN_BLOCKHEIGHT_REVIEW_BUFFER = 20n;
export const ACTIVE_FUNDING_STATUSES = [
  DuelTransactionStatus.SUBMITTED,
  DuelTransactionStatus.CONFIRMED,
  DuelTransactionStatus.FINALIZED,
] as const;

export interface PreparedFundingIntent {
  action: 'fund';
  chain: 'solana:devnet';
  cluster: 'devnet';
  duelId: string;
  escrowAddress: string;
  expiresAt: string;
  feeAmountLamports: string;
  feeAmountSol: string;
  feeRecipient: string;
  fundingSide: 'creator' | 'opponent';
  id: string;
  lastValidBlockHeight: string;
  paymentMint: string;
  programId: string;
  recentBlockhash: string;
  serializedTransactionBase64: string;
  status: 'prepared';
  wallet: string;
  warnings: string[];
}

@Injectable()
export class DuelFundingService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly rpc: SolanaRpcGateway,
    private readonly admin: AdminService,
    private readonly treasury: HouseTreasuryService,
  ) {}

  async prepare(input: {
    duelId: string;
    idempotencyKey: string;
    wallet: string;
  }): Promise<PreparedFundingIntent> {
    await this.admin.assertNotPaused();
    const configuration = loadEscrowConfiguration();
    await this.assertDevnet();
    const wallet = parsePublicKey(input.wallet, 'wallet');
    const duel = await this.database.duel.findUnique({ where: { id: input.duelId } });
    if (!duel) throw new NotFoundException(`Duel ${input.duelId} was not found`);
    const valuationPolicyHash = parsePolicyHash(duel.valuationPolicyHash);
    await this.treasury.assertFundingAllowed(duel.id);
    const side = validateFundingDuelForPreparation(duel, input.wallet, new Date());
    if (side === 'opponent') {
      const creatorFunding = await this.database.duelTransaction.findFirst({
        where: {
          action: DuelTransactionAction.FUND,
          duelId: duel.id,
          status: DuelTransactionStatus.FINALIZED,
          wallet: duel.creatorWallet,
        },
      });
      if (!creatorFunding) {
        throw new ConflictException('Opponent funding waits for finalized creator funding');
      }
    }
    const currentBlockHeight = await this.rpc.getBlockHeight();
    const activeFunding = await this.database.duelTransaction.findFirst({
      where: {
        action: DuelTransactionAction.FUND,
        duelId: input.duelId,
        status: { in: [...ACTIVE_FUNDING_STATUSES] },
        wallet: input.wallet,
      },
    });
    assertNoActiveFunding(activeFunding);
    const reusable = await this.findReusable(
      input,
      configuration,
      currentBlockHeight,
      CANONICAL_VALUATION_POLICY_HASH,
    );
    if (reusable) return reusable;

    const opponent = parsePublicKey(duel.opponentWallet ?? '', 'opponent wallet');
    const nonce = nonceFromDuelId(duel.id);
    const addresses = deriveEscrowV2Addresses(parsePublicKey(duel.creatorWallet, 'creator'), nonce);
    const playerSource = getAssociatedTokenAddressSync(NATIVE_MINT, wallet);
    const latestBlockhash = await this.rpc.getLatestBlockhash();
    const fundingAccounts = fundDuelAccountConstraints({
      addresses,
      paymentMint: NATIVE_MINT,
      player: wallet,
      playerSource,
    });
    const transaction = new Transaction({
      blockhash: latestBlockhash.blockhash,
      feePayer: wallet,
      lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
    });
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        wallet,
        playerSource,
        wallet,
        NATIVE_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      SystemProgram.transfer({
        fromPubkey: wallet,
        lamports: configuration.feeAmount,
        toPubkey: playerSource,
      }),
      createSyncNativeInstruction(playerSource, TOKEN_PROGRAM_ID),
    );
    if (side === 'creator') {
      transaction.add(
        createInitializeDuelInstruction({
          addresses,
          args: {
            expiresAt: BigInt(Math.floor(duel.expiresAt.getTime() / 1_000)),
            feeAmount: configuration.feeAmount,
            feeRecipient: configuration.feeRecipient,
            nonce,
            opponent,
            providerSigner: configuration.providerSigner,
            valuationPolicyHash,
          },
          creator: wallet,
          paymentMint: NATIVE_MINT,
        }),
      );
    }
    transaction.add(
      createFundDuelInstruction({
        addresses,
        paymentMint: NATIVE_MINT,
        player: wallet,
        playerSource,
      }),
    );

    const expiresAt = new Date(
      Math.min(duel.expiresAt.getTime(), Date.now() + BLOCKHASH_REVIEW_WINDOW_MS),
    );
    const serializedTransaction = transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');
    const instructionAccounts = fundingAccounts.map(toConstraint);
    const expectedMessageHash = createHash('sha256')
      .update(transaction.serializeMessage())
      .digest('hex');
    const requestHash = preparationHash({
      duelId: duel.id,
      feeAmount: configuration.feeAmount.toString(),
      feeRecipient: configuration.feeRecipient.toBase58(),
      programId: configuration.programId.toBase58(),
      providerSigner: configuration.providerSigner.toBase58(),
      sourceSha: ESCROW_V2_SOURCE_SHA,
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
      wallet: input.wallet,
    });
    const metadata = buildMetadata({
      addresses,
      feeAmount: configuration.feeAmount,
      feeRecipient: configuration.feeRecipient,
      playerSource,
      requestHash,
      side,
    });
    const row = await this.persistPrepared({
      duel,
      expiresAt,
      expectedMessageHash,
      idempotencyKey: input.idempotencyKey,
      instructionAccounts,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      metadata,
      recentBlockhash: latestBlockhash.blockhash,
      serializedTransaction,
      wallet: input.wallet,
    });
    return toIntent(row, metadata);
  }

  private async findReusable(
    input: { duelId: string; idempotencyKey: string; wallet: string },
    configuration: EscrowConfiguration,
    currentBlockHeight: bigint,
    valuationPolicyHash: string,
  ): Promise<PreparedFundingIntent | null> {
    const requestHash = preparationHash({
      duelId: input.duelId,
      feeAmount: configuration.feeAmount.toString(),
      feeRecipient: configuration.feeRecipient.toBase58(),
      programId: configuration.programId.toBase58(),
      providerSigner: configuration.providerSigner.toBase58(),
      sourceSha: ESCROW_V2_SOURCE_SHA,
      valuationPolicyHash,
      wallet: input.wallet,
    });
    const existing = await this.database.duelTransaction.findFirst({
      orderBy: { createdAt: 'desc' },
      where: {
        action: DuelTransactionAction.FUND,
        duelId: input.duelId,
        status: DuelTransactionStatus.PREPARED,
        wallet: input.wallet,
      },
    });
    if (!existing) return null;
    const metadata = parseFundingMetadata(existing.metadata);
    if (!metadata || metadata.prepareRequestHash !== requestHash) {
      throw new ConflictException('An active funding intent has different constraints');
    }
    if (
      existing.serializedTransaction &&
      existing.recentBlockhash &&
      existing.lastValidBlockHeight !== null &&
      isPreparedBlockhashReusable(existing.lastValidBlockHeight, currentBlockHeight) &&
      existing.expiresAt &&
      existing.expiresAt > new Date()
    ) {
      return toIntent(existing, metadata);
    }
    return null;
  }

  private async persistPrepared(input: PersistPreparedInput) {
    return this.database.$transaction(async (database) => {
      const current = await database.duel.findUnique({ where: { id: input.duel.id } });
      if (!current) throw new NotFoundException(`Duel ${input.duel.id} was not found`);
      fundingPreparationStatus(current.status);
      if (current.status === DuelStatus.MATCHED && current.creatorWallet !== input.wallet) {
        throw new ConflictException('Creator must initialize escrow before opponent funding');
      }

      const stale = await database.duelTransaction.findFirst({
        orderBy: { createdAt: 'desc' },
        where: {
          action: DuelTransactionAction.FUND,
          duelId: current.id,
          status: DuelTransactionStatus.PREPARED,
          wallet: input.wallet,
        },
      });
      const data = {
        allowMultipleInstructionMatches: false,
        errorCode: null,
        errorMessage: null,
        expectedAccounts: input.instructionAccounts as unknown as Prisma.InputJsonValue,
        expectedFromStatus: DuelStatus.COMMITTING,
        expectedMessageHash: input.expectedMessageHash,
        expectedInstructionAccounts: input.instructionAccounts as unknown as Prisma.InputJsonValue,
        expectedInstructionDataHash: hashFundInstructionData(),
        expectedProgramId: ESCROW_V2_PROGRAM_ID.toBase58(),
        expectedSigner: input.wallet,
        expectedToStatus: DuelStatus.FUNDED,
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
        lastValidBlockHeight: input.lastValidBlockHeight,
        metadata: input.metadata as unknown as Prisma.InputJsonValue,
        recentBlockhash: input.recentBlockhash,
        serializedTransaction: input.serializedTransaction,
      };
      if (stale) {
        return database.duelTransaction.update({ data, where: { id: stale.id } });
      }
      return database.duelTransaction.create({
        data: {
          ...data,
          action: DuelTransactionAction.FUND,
          duelId: current.id,
          id: createId('tx'),
          network: 'DEVNET',
          status: DuelTransactionStatus.PREPARED,
          wallet: input.wallet,
        },
      });
    });
  }

  private async assertDevnet(): Promise<void> {
    try {
      await this.rpc.assertDevnet();
    } catch (error) {
      if (error instanceof SolanaRpcUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }
}

interface EscrowConfiguration {
  feeAmount: bigint;
  feeRecipient: PublicKey;
  programId: PublicKey;
  providerSigner: PublicKey;
}

interface FundingMetadata {
  escrowAddress: string;
  feeAmountLamports: string;
  feeRecipient: string;
  fundingSide: 'creator' | 'opponent';
  idlSha256: string;
  paymentMint: string;
  playerSource: string;
  prepareRequestHash: string;
  sourceSha: string;
}

interface PersistPreparedInput {
  duel: { creatorWallet: string; id: string };
  expiresAt: Date;
  expectedMessageHash: string;
  idempotencyKey: string;
  instructionAccounts: ExpectedAccountConstraint[];
  lastValidBlockHeight: bigint;
  metadata: FundingMetadata;
  recentBlockhash: string;
  serializedTransaction: string;
  wallet: string;
}

function loadEscrowConfiguration(): EscrowConfiguration {
  if (process.env.OPENPACKSDUEL_NETWORK !== 'solana-devnet') {
    throw new ServiceUnavailableException('Funding is enabled only for configured Solana devnet');
  }
  const programId = configuredPublicKey('ESCROW_PROGRAM_ID');
  if (!programId.equals(ESCROW_V2_PROGRAM_ID)) {
    throw new ServiceUnavailableException('Configured escrow program does not match escrow v2');
  }
  const configuredFee = process.env.OPENPACKSDUEL_DEVNET_FEE_LAMPORTS?.trim();
  if (!configuredFee || !/^\d+$/.test(configuredFee) || BigInt(configuredFee) <= 0n) {
    throw new ServiceUnavailableException('Escrow platform fee is not configured');
  }
  return {
    feeAmount: BigInt(configuredFee),
    feeRecipient: configuredPublicKey('ESCROW_FEE_RECIPIENT'),
    programId,
    providerSigner: configuredPublicKey('ESCROW_PROVIDER_SIGNER'),
  };
}

function configuredPublicKey(name: string): PublicKey {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceUnavailableException(`${name} is not configured`);
  try {
    return new PublicKey(value);
  } catch {
    throw new ServiceUnavailableException(`${name} is invalid`);
  }
}

function parsePublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new BadRequestException(`${label} is not a valid Solana address`);
  }
}

export function parsePolicyHash(value: string | null): Uint8Array {
  if (value !== CANONICAL_VALUATION_POLICY_HASH) {
    throw new ServiceUnavailableException(
      'Duel valuation policy does not match the supported canonical policy',
    );
  }
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

export function validateFundingDuelForPreparation(
  duel: {
    creatorWallet: string;
    expiresAt: Date;
    opponentWallet: string | null;
    status: DuelStatus;
  },
  wallet: string,
  now: Date,
): 'creator' | 'opponent' {
  const side =
    wallet === duel.creatorWallet ? 'creator' : wallet === duel.opponentWallet ? 'opponent' : null;
  if (!side) throw new ConflictException('Only a matched duel participant can fund escrow');
  if (duel.expiresAt <= now) throw new ConflictException('Duel has expired');
  if (
    side === 'creator' &&
    duel.status !== DuelStatus.MATCHED &&
    duel.status !== DuelStatus.COMMITTING
  ) {
    throw new ConflictException('Creator funding requires a matched duel');
  }
  if (side === 'opponent' && duel.status !== DuelStatus.COMMITTING) {
    throw new ConflictException('Opponent funding waits for creator escrow initialization');
  }
  return side;
}

export function assertNoActiveFunding(active: { id: string } | null): void {
  if (active) throw new ConflictException('This wallet already has an active funding transaction');
}

export function fundingPreparationStatus(status: DuelStatus): DuelStatus {
  if (status !== DuelStatus.MATCHED && status !== DuelStatus.COMMITTING) {
    throw new ConflictException('Duel state changed before funding preparation');
  }
  return status;
}

export function isPreparedBlockhashReusable(
  lastValidBlockHeight: bigint,
  currentBlockHeight: bigint,
): boolean {
  return lastValidBlockHeight > currentBlockHeight + MIN_BLOCKHEIGHT_REVIEW_BUFFER;
}

export function nonceFromDuelId(duelId: string): bigint {
  return createHash('sha256').update(duelId).digest().readBigUInt64LE(0);
}

function toConstraint(account: {
  isSigner: boolean;
  isWritable: boolean;
  pubkey: PublicKey;
}): ExpectedAccountConstraint {
  return {
    address: account.pubkey.toBase58(),
    isSigner: account.isSigner,
    isWritable: account.isWritable,
  };
}

function hashFundInstructionData(): string {
  return createHash('sha256').update(bs58.encode(FUND_DUEL_DISCRIMINATOR)).digest('hex');
}

function preparationHash(input: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function buildMetadata(input: {
  addresses: { duel: PublicKey };
  feeAmount: bigint;
  feeRecipient: PublicKey;
  playerSource: PublicKey;
  requestHash: string;
  side: 'creator' | 'opponent';
}): FundingMetadata {
  return {
    escrowAddress: input.addresses.duel.toBase58(),
    feeAmountLamports: input.feeAmount.toString(),
    feeRecipient: input.feeRecipient.toBase58(),
    fundingSide: input.side,
    idlSha256: ESCROW_V2_IDL_SHA256,
    paymentMint: NATIVE_MINT.toBase58(),
    playerSource: input.playerSource.toBase58(),
    prepareRequestHash: input.requestHash,
    sourceSha: ESCROW_V2_SOURCE_SHA,
  };
}

function parseFundingMetadata(value: Prisma.JsonValue | null): FundingMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = [
    'escrowAddress',
    'feeAmountLamports',
    'feeRecipient',
    'fundingSide',
    'paymentMint',
    'playerSource',
    'prepareRequestHash',
  ] as const;
  if (fields.some((field) => typeof value[field] !== 'string')) return null;
  if (value.fundingSide !== 'creator' && value.fundingSide !== 'opponent') return null;
  return value as unknown as FundingMetadata;
}

function toIntent(
  row: {
    duelId: string;
    expiresAt: Date | null;
    id: string;
    lastValidBlockHeight: bigint | null;
    recentBlockhash: string | null;
    serializedTransaction: string | null;
    wallet: string;
  },
  metadata: FundingMetadata,
): PreparedFundingIntent {
  if (
    !row.expiresAt ||
    row.lastValidBlockHeight === null ||
    !row.recentBlockhash ||
    !row.serializedTransaction
  ) {
    throw new ConflictException('Prepared funding intent is incomplete');
  }
  return {
    action: 'fund',
    chain: 'solana:devnet',
    cluster: 'devnet',
    duelId: row.duelId,
    escrowAddress: metadata.escrowAddress,
    expiresAt: row.expiresAt.toISOString(),
    feeAmountLamports: metadata.feeAmountLamports,
    feeAmountSol: formatSol(metadata.feeAmountLamports),
    feeRecipient: metadata.feeRecipient,
    fundingSide: metadata.fundingSide,
    id: row.id,
    lastValidBlockHeight: row.lastValidBlockHeight.toString(),
    paymentMint: metadata.paymentMint,
    programId: ESCROW_V2_PROGRAM_ID.toBase58(),
    recentBlockhash: row.recentBlockhash,
    serializedTransactionBase64: row.serializedTransaction,
    status: 'prepared',
    wallet: row.wallet,
    warnings: [
      'This transaction escrows only the disclosed platform fee in wrapped SOL.',
      'Pack purchase value is not included and no pack is purchased by this transaction.',
      'Solana network fees and recoverable token-account rent are additional.',
    ],
  };
}

function formatSol(lamports: string): string {
  const value = BigInt(lamports);
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}
