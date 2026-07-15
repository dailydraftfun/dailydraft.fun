import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type DatabaseClient, DuelSide, ProviderMode } from '@openpacksduel/db';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

import {
  createDepositCardAssetInstruction,
  createRefundExpiredCardInstruction,
  createRefundExpiredPaymentInstruction,
  createSettleDuelInstruction,
  createSubmitResultInstruction,
  deriveEscrowV2Addresses,
  deriveEscrowV2CardVault,
  ESCROW_V2_PROGRAM_ID,
  type EscrowV2Role,
} from '../contracts/openpacksduel-escrow-v2.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway, SolanaRpcUnavailableError } from './solana-rpc.client.js';

const U64_MAX = 18_446_744_073_709_551_615n;

interface CanonicalOutcome {
  mint: PublicKey;
  openedAt: Date;
  providerReference: string;
  side: EscrowV2Role;
  value: bigint;
}

interface CanonicalEvidence {
  creator: CanonicalOutcome;
  opponent: CanonicalOutcome;
  policyHash: Uint8Array;
  winner: EscrowV2Role | null;
}

export interface PreparedProviderEscrowTransaction {
  action: 'commit_result' | 'deposit_card' | 'refund_card' | 'refund_payment' | 'settle';
  chain: 'solana:devnet';
  duelId: string;
  expectedSigner: string;
  instruction: {
    accounts: Array<{ address: string; index: number; isSigner: boolean; isWritable: boolean }>;
    dataBase58: string;
    dataBase58Sha256: string;
    name: string;
  };
  lastValidBlockHeight: string;
  messageSha256: string;
  programId: string;
  proof: Record<string, string | null>;
  recentBlockhash: string;
  serializedTransactionBase64: string;
  status: 'prepared';
  warnings: string[];
}

@Injectable()
export class ProviderSettlementService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly rpc: SolanaRpcGateway,
  ) {}

  async prepare(input: {
    assetStandard?: 'legacy-spl-nft';
    callerWallet: string;
    duelId: string;
    operation: PreparedProviderEscrowTransaction['action'];
    providerRequestId?: string;
    side?: EscrowV2Role;
    sourceTokenAccount?: string;
  }): Promise<PreparedProviderEscrowTransaction> {
    await this.assertDevnet();
    const caller = parsePublicKey(input.callerWallet, 'callerWallet');
    const configuration = loadConfiguration();
    const duel = await this.database.duel.findUnique({
      include: { packOutcomes: true },
      where: { id: input.duelId },
    });
    if (!duel) throw new NotFoundException(`Duel ${input.duelId} was not found`);
    if (!duel.opponentWallet) throw new ConflictException('Duel has no committed opponent');
    const creator = parsePublicKey(duel.creatorWallet, 'creator wallet');
    const opponent = parsePublicKey(duel.opponentWallet, 'opponent wallet');
    const addresses = deriveEscrowV2Addresses(creator, nonceFromDuelId(duel.id));
    if (duel.escrowAddress !== addresses.duel.toBase58()) {
      throw new ConflictException('Persisted duel escrow does not match escrow v2 PDA');
    }

    if (input.operation === 'refund_payment') {
      requireExpired(duel.expiresAt);
      const side = requireSide(input.side);
      const player = side === 'creator' ? creator : opponent;
      const destination = getAssociatedTokenAddressSync(NATIVE_MINT, player);
      return this.prepareTransaction({
        action: input.operation,
        caller,
        duelId: duel.id,
        instruction: createRefundExpiredPaymentInstruction({
          caller,
          destination,
          duel: addresses.duel,
          paymentMint: NATIVE_MINT,
          paymentVault: addresses.paymentVault,
          player,
        }),
        instructionName: 'refund_expired_payment',
        prefix: [ata(caller, destination, player, NATIVE_MINT)],
        proof: { player: player.toBase58(), side },
      });
    }

    const evidence = validateCanonicalEvidence(duel);
    if (input.assetStandard !== 'legacy-spl-nft') {
      throw new BadRequestException('assetStandard must be canonical legacy-spl-nft');
    }

    if (input.operation === 'deposit_card') {
      const side = requireSide(input.side);
      const outcome = evidence[side];
      const source = parsePublicKey(input.sourceTokenAccount ?? '', 'sourceTokenAccount');
      const player = side === 'creator' ? creator : opponent;
      if (!caller.equals(player) && !caller.equals(configuration.providerSigner)) {
        throw new ConflictException('Card depositor must be the participant or provider signer');
      }
      await this.assertCanonicalSource(source, caller, outcome.mint);
      return this.prepareTransaction({
        action: input.operation,
        caller,
        duelId: duel.id,
        instruction: createDepositCardAssetInstruction({
          cardMint: outcome.mint,
          depositor: caller,
          depositorSource: source,
          duel: addresses.duel,
          role: side,
        }),
        instructionName: 'deposit_card_asset',
        proof: {
          cardMint: outcome.mint.toBase58(),
          providerReference: outcome.providerReference,
          side,
        },
      });
    }

    const requestId = parseBytes32(input.providerRequestId, 'providerRequestId');
    await this.assertVaults(addresses.duel, evidence);
    if (input.operation === 'commit_result') {
      if (!caller.equals(configuration.providerSigner)) {
        throw new ConflictException('Result commitment must be signed by the provider signer');
      }
      const openedAt = new Date(
        Math.max(evidence.creator.openedAt.getTime(), evidence.opponent.openedAt.getTime()),
      );
      const built = createSubmitResultInstruction({
        creator,
        creatorCardMint: evidence.creator.mint,
        creatorValue: evidence.creator.value,
        duel: addresses.duel,
        openedAt: BigInt(Math.floor(openedAt.getTime() / 1_000)),
        opponent,
        opponentCardMint: evidence.opponent.mint,
        opponentValue: evidence.opponent.value,
        providerRequestId: requestId,
        providerSigner: configuration.providerSigner,
        valuationPolicyHash: evidence.policyHash,
      });
      return this.prepareTransaction({
        action: input.operation,
        caller,
        duelId: duel.id,
        instruction: built.instruction,
        instructionName: 'submit_result',
        proof: proof(evidence, input.providerRequestId ?? '', built.resultCommitment.toBase58()),
      });
    }

    if (input.operation === 'settle') {
      const builtResult = createSubmitResultInstruction({
        creator,
        creatorCardMint: evidence.creator.mint,
        creatorValue: evidence.creator.value,
        duel: addresses.duel,
        openedAt: BigInt(Math.floor(evidence.opponent.openedAt.getTime() / 1_000)),
        opponent,
        opponentCardMint: evidence.opponent.mint,
        opponentValue: evidence.opponent.value,
        providerRequestId: requestId,
        providerSigner: configuration.providerSigner,
        valuationPolicyHash: evidence.policyHash,
      });
      const creatorCardOwner = evidence.winner === 'opponent' ? opponent : creator;
      const opponentCardOwner = evidence.winner === 'creator' ? creator : opponent;
      const destinations = {
        creatorCard: getAssociatedTokenAddressSync(evidence.creator.mint, creatorCardOwner),
        creatorPayment: getAssociatedTokenAddressSync(NATIVE_MINT, creator),
        fee: getAssociatedTokenAddressSync(NATIVE_MINT, configuration.feeRecipient),
        opponentCard: getAssociatedTokenAddressSync(evidence.opponent.mint, opponentCardOwner),
        opponentPayment: getAssociatedTokenAddressSync(NATIVE_MINT, opponent),
      };
      return this.prepareTransaction({
        action: input.operation,
        caller,
        duelId: duel.id,
        instruction: createSettleDuelInstruction({
          caller,
          creatorCardDestination: destinations.creatorCard,
          creatorCardMint: evidence.creator.mint,
          creatorPaymentDestination: destinations.creatorPayment,
          duel: addresses.duel,
          feeDestination: destinations.fee,
          opponentCardDestination: destinations.opponentCard,
          opponentCardMint: evidence.opponent.mint,
          opponentPaymentDestination: destinations.opponentPayment,
          paymentMint: NATIVE_MINT,
          paymentVault: addresses.paymentVault,
          resultCommitment: builtResult.resultCommitment,
        }),
        instructionName: 'settle_duel',
        prefix: [
          ata(caller, destinations.creatorPayment, creator, NATIVE_MINT),
          ata(caller, destinations.opponentPayment, opponent, NATIVE_MINT),
          ata(caller, destinations.fee, configuration.feeRecipient, NATIVE_MINT),
          ata(caller, destinations.creatorCard, creatorCardOwner, evidence.creator.mint),
          ata(caller, destinations.opponentCard, opponentCardOwner, evidence.opponent.mint),
        ],
        proof: proof(
          evidence,
          input.providerRequestId ?? '',
          builtResult.resultCommitment.toBase58(),
        ),
      });
    }

    requireExpired(duel.expiresAt);
    const side = requireSide(input.side);
    const outcome = evidence[side];
    const player = side === 'creator' ? creator : opponent;
    const destination = getAssociatedTokenAddressSync(outcome.mint, player);
    return this.prepareTransaction({
      action: 'refund_card',
      caller,
      duelId: duel.id,
      instruction: createRefundExpiredCardInstruction({
        caller,
        cardMint: outcome.mint,
        destination,
        duel: addresses.duel,
        role: side,
      }),
      instructionName: 'refund_expired_card',
      prefix: [ata(caller, destination, player, outcome.mint)],
      proof: { cardMint: outcome.mint.toBase58(), side },
    });
  }

  private async prepareTransaction(input: {
    action: PreparedProviderEscrowTransaction['action'];
    caller: PublicKey;
    duelId: string;
    instruction: TransactionInstruction;
    instructionName: string;
    prefix?: TransactionInstruction[];
    proof: Record<string, string | null>;
  }): Promise<PreparedProviderEscrowTransaction> {
    const latest = await this.rpc.getLatestBlockhash();
    const transaction = new Transaction({
      blockhash: latest.blockhash,
      feePayer: input.caller,
      lastValidBlockHeight: Number(latest.lastValidBlockHeight),
    }).add(...(input.prefix ?? []), input.instruction);
    const dataBase58 = bs58.encode(input.instruction.data);
    return {
      action: input.action,
      chain: 'solana:devnet',
      duelId: input.duelId,
      expectedSigner: input.caller.toBase58(),
      instruction: {
        accounts: input.instruction.keys.map((account, index) => ({
          address: account.pubkey.toBase58(),
          index,
          isSigner: account.isSigner,
          isWritable: account.isWritable,
        })),
        dataBase58,
        dataBase58Sha256: digest(dataBase58),
        name: input.instructionName,
      },
      lastValidBlockHeight: latest.lastValidBlockHeight.toString(),
      messageSha256: digest(transaction.serializeMessage()),
      programId: ESCROW_V2_PROGRAM_ID.toBase58(),
      proof: input.proof,
      recentBlockhash: latest.blockhash,
      serializedTransactionBase64: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
      status: 'prepared',
      warnings: [
        'Unsigned devnet transaction: inspect, sign externally, submit, then verify finalized chain state.',
      ],
    };
  }

  private async assertCanonicalSource(
    source: PublicKey,
    owner: PublicKey,
    mint: PublicKey,
  ): Promise<void> {
    await this.assertMint(mint);
    const account = await this.rpc.getLegacyTokenAccount(source.toBase58());
    if (
      account.mint !== mint.toBase58() ||
      account.owner !== owner.toBase58() ||
      account.amount < 1n
    ) {
      throw new ConflictException('Source does not hold the canonical legacy SPL NFT');
    }
  }

  private async assertVaults(duel: PublicKey, evidence: CanonicalEvidence): Promise<void> {
    for (const side of ['creator', 'opponent'] as const) {
      const outcome = evidence[side];
      await this.assertMint(outcome.mint);
      const vault = await this.rpc.getLegacyTokenAccount(
        deriveEscrowV2CardVault(duel, side).toBase58(),
      );
      if (
        vault.mint !== outcome.mint.toBase58() ||
        vault.owner !== duel.toBase58() ||
        vault.amount !== 1n
      ) {
        throw new ConflictException(`Missing canonical ${side} card in escrow vault`);
      }
    }
  }

  private async assertMint(mint: PublicKey): Promise<void> {
    const metadata = await this.rpc.getLegacyMint(mint.toBase58());
    if (metadata.decimals !== 0 || metadata.supply !== 1n) {
      throw new ConflictException('Card mint is not a canonical legacy SPL NFT');
    }
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

export function validateCanonicalEvidence(duel: {
  providerMode: ProviderMode;
  valuationPolicyHash: string | null;
  packOutcomes: Array<{
    assetReference: string;
    insuredValueAmount: string;
    insuredValueCurrency: string;
    insuredValueDecimals: number;
    isMock: boolean;
    openedAt: Date;
    providerReference: string;
    side: DuelSide;
    valuationPolicyHash: string;
  }>;
}): CanonicalEvidence {
  if (duel.providerMode !== ProviderMode.COLLECTOR_CRYPT_SANDBOX) {
    throw new ServiceUnavailableException('Live settlement requires confirmed provider evidence');
  }
  if (duel.packOutcomes.length !== 2 || duel.packOutcomes.some((outcome) => outcome.isMock)) {
    throw new ServiceUnavailableException('Mock or incomplete outcomes cannot settle real assets');
  }
  const policyHash = duel.valuationPolicyHash;
  if (!policyHash || !/^[a-f0-9]{64}$/.test(policyHash)) {
    throw new ServiceUnavailableException('Duel valuation policy is not canonical');
  }
  const outcomes = Object.fromEntries(
    duel.packOutcomes.map((outcome) => {
      if (
        outcome.insuredValueCurrency !== 'USDC' ||
        outcome.insuredValueDecimals !== 6 ||
        !/^\d+$/.test(outcome.insuredValueAmount)
      ) {
        throw new ServiceUnavailableException('Outcome lacks canonical integer insured value');
      }
      const value = BigInt(outcome.insuredValueAmount);
      if (value > U64_MAX) throw new ServiceUnavailableException('Insured value exceeds u64');
      if (
        outcome.valuationPolicyHash !== policyHash ||
        !/^[a-f0-9]{64}$/.test(outcome.valuationPolicyHash)
      ) {
        throw new ServiceUnavailableException('Outcome valuation policy is not canonical');
      }
      const side = outcome.side === DuelSide.CREATOR ? 'creator' : 'opponent';
      return [
        side,
        {
          mint: parsePublicKey(outcome.assetReference, `${side} assetReference`),
          openedAt: outcome.openedAt,
          providerReference: outcome.providerReference,
          side,
          value,
        },
      ];
    }),
  ) as Record<EscrowV2Role, CanonicalOutcome>;
  if (!outcomes.creator || !outcomes.opponent) {
    throw new ServiceUnavailableException('Outcomes must contain creator and opponent sides');
  }
  return {
    creator: outcomes.creator,
    opponent: outcomes.opponent,
    policyHash: Uint8Array.from(Buffer.from(policyHash, 'hex')),
    winner:
      outcomes.creator.value === outcomes.opponent.value
        ? null
        : outcomes.creator.value > outcomes.opponent.value
          ? 'creator'
          : 'opponent',
  };
}

function loadConfiguration(): { feeRecipient: PublicKey; providerSigner: PublicKey } {
  if (process.env.OPENPACKSDUEL_NETWORK !== 'solana-devnet') {
    throw new ServiceUnavailableException('Provider settlement is devnet-only');
  }
  if (process.env.OPENPACKSDUEL_PROVIDER_ASSET_STANDARD !== 'legacy-spl-nft') {
    throw new ServiceUnavailableException('Canonical provider asset standard is not confirmed');
  }
  const configuredProgram = parseConfigurationKey('ESCROW_PROGRAM_ID');
  if (!configuredProgram.equals(ESCROW_V2_PROGRAM_ID)) {
    throw new ServiceUnavailableException('Configured escrow program does not match escrow v2');
  }
  return {
    feeRecipient: parseConfigurationKey('ESCROW_FEE_RECIPIENT'),
    providerSigner: parseConfigurationKey('ESCROW_PROVIDER_SIGNER'),
  };
}

function parseConfigurationKey(name: string): PublicKey {
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

function parseBytes32(value: string | undefined, label: string): Uint8Array {
  if (!value || !/^[a-f0-9]{64}$/.test(value) || /^0+$/.test(value)) {
    throw new BadRequestException(`${label} must be a nonzero lowercase 32-byte hex value`);
  }
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

function requireSide(side: EscrowV2Role | undefined): EscrowV2Role {
  if (!side) throw new BadRequestException('side is required for this operation');
  return side;
}

function requireExpired(expiresAt: Date): void {
  if (expiresAt.getTime() > Date.now()) throw new ConflictException('Duel has not expired');
}

function nonceFromDuelId(duelId: string): bigint {
  const hash = createHash('sha256').update(`openpacksduel:escrow-v2:${duelId}`).digest();
  return hash.readBigUInt64LE(0);
}

function ata(payer: PublicKey, address: PublicKey, owner: PublicKey, mint: PublicKey) {
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    address,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

function proof(
  evidence: CanonicalEvidence,
  providerRequestId: string,
  resultCommitment: string,
): Record<string, string | null> {
  return {
    creatorMint: evidence.creator.mint.toBase58(),
    creatorProviderReference: evidence.creator.providerReference,
    creatorValue: evidence.creator.value.toString(),
    opponentMint: evidence.opponent.mint.toBase58(),
    opponentProviderReference: evidence.opponent.providerReference,
    opponentValue: evidence.opponent.value.toString(),
    providerRequestId,
    resultCommitment,
    valuationPolicyHash: Buffer.from(evidence.policyHash).toString('hex'),
    winner: evidence.winner,
  };
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
