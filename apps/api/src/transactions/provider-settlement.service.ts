import { createHash, randomUUID } from 'node:crypto';
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
  DuelSide,
  DuelStatus,
  DuelTransactionAction,
  DuelTransactionStatus,
  type Prisma,
  ProviderMode,
} from '@openpacksduel/db';
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
import { nonceFromDuelId } from './duel-funding.service.js';
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

interface PersistTrackedIntentInput {
  action:
    | typeof DuelTransactionAction.COMMIT_RESULT
    | typeof DuelTransactionAction.REFUND
    | typeof DuelTransactionAction.SETTLE;
  caller: PublicKey;
  duelId: string;
  expectedFromStatus:
    | typeof DuelStatus.AWAITING_ASSETS
    | typeof DuelStatus.REFUNDING
    | typeof DuelStatus.SETTLING;
  expectedToStatus:
    | typeof DuelStatus.REFUNDING
    | typeof DuelStatus.SETTLED
    | typeof DuelStatus.SETTLING;
  idempotencyKey: string;
  instruction: TransactionInstruction;
  lastValidBlockHeight: bigint;
  messageSha256: string;
  proof: Record<string, string | null>;
  recentBlockhash: string;
  serializedTransaction: string;
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
  intentId: string | null;
  lastValidBlockHeight: string;
  messageSha256: string;
  programId: string;
  proof: Record<string, string | null>;
  recentBlockhash: string;
  reconciliation: 'operator-proof' | 'submission-monitor';
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
    idempotencyKey: string;
    operation: PreparedProviderEscrowTransaction['action'];
    providerRequestId?: string;
    side?: EscrowV2Role;
    sourceTokenAccount?: string;
  }): Promise<PreparedProviderEscrowTransaction> {
    await this.assertDevnet();
    assertEscrowProgramConfiguration();
    const caller = parsePublicKey(input.callerWallet, 'callerWallet');
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
      assertOperationState(input.operation, duel.status);
      requireExpired(duel.expiresAt);
      const side = requireSide(input.side);
      const player = side === 'creator' ? creator : opponent;
      const destination = getAssociatedTokenAddressSync(NATIVE_MINT, player);
      return this.prepareTransaction({
        action: input.operation,
        caller,
        duelId: duel.id,
        idempotencyKey: input.idempotencyKey,
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

    const configuration = loadProviderConfiguration();
    const evidence = validateCanonicalEvidence(duel);
    if (input.assetStandard !== 'legacy-spl-nft') {
      throw new BadRequestException('assetStandard must be canonical legacy-spl-nft');
    }

    if (input.operation === 'deposit_card') {
      assertOperationState(input.operation, duel.status);
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
        idempotencyKey: input.idempotencyKey,
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

    if (input.operation === 'commit_result') {
      assertOperationState(input.operation, duel.status);
      const requestId = parseBytes32(input.providerRequestId, 'providerRequestId');
      await this.assertVaults(addresses.duel, evidence);
      if (!caller.equals(configuration.providerSigner)) {
        throw new ConflictException('Result commitment must be signed by the provider signer');
      }
      const openedAt = canonicalOpenedAt(evidence);
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
        idempotencyKey: input.idempotencyKey,
        instruction: built.instruction,
        instructionName: 'submit_result',
        proof: proof(evidence, input.providerRequestId ?? '', built.resultCommitment.toBase58()),
      });
    }

    if (input.operation === 'settle') {
      assertOperationState(input.operation, duel.status);
      const requestId = parseBytes32(input.providerRequestId, 'providerRequestId');
      await this.assertVaults(addresses.duel, evidence);
      const builtResult = createSubmitResultInstruction({
        creator,
        creatorCardMint: evidence.creator.mint,
        creatorValue: evidence.creator.value,
        duel: addresses.duel,
        openedAt: BigInt(Math.floor(canonicalOpenedAt(evidence).getTime() / 1_000)),
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
        idempotencyKey: input.idempotencyKey,
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

    assertOperationState('refund_card', duel.status);
    requireExpired(duel.expiresAt);
    const side = requireSide(input.side);
    const outcome = evidence[side];
    await this.assertVault(addresses.duel, side, outcome);
    const player = side === 'creator' ? creator : opponent;
    const destination = getAssociatedTokenAddressSync(outcome.mint, player);
    return this.prepareTransaction({
      action: 'refund_card',
      caller,
      duelId: duel.id,
      idempotencyKey: input.idempotencyKey,
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
    idempotencyKey: string;
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
    const serializedTransaction = transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');
    const messageSha256 = digest(transaction.serializeMessage());
    const tracked = trackedTransition(input.action);
    const intent = tracked
      ? await this.persistTrackedIntent({
          action: tracked.action,
          caller: input.caller,
          duelId: input.duelId,
          expectedFromStatus: tracked.from,
          expectedToStatus: tracked.to,
          idempotencyKey: input.idempotencyKey,
          instruction: input.instruction,
          lastValidBlockHeight: latest.lastValidBlockHeight,
          messageSha256,
          proof: input.proof,
          recentBlockhash: latest.blockhash,
          serializedTransaction,
        })
      : null;
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
      intentId: intent?.id ?? null,
      lastValidBlockHeight: (
        intent?.lastValidBlockHeight ?? latest.lastValidBlockHeight
      ).toString(),
      messageSha256: intent?.expectedMessageHash ?? messageSha256,
      programId: ESCROW_V2_PROGRAM_ID.toBase58(),
      proof: input.proof,
      recentBlockhash: intent?.recentBlockhash ?? latest.blockhash,
      reconciliation: intent ? 'submission-monitor' : 'operator-proof',
      serializedTransactionBase64: intent?.serializedTransaction ?? serializedTransaction,
      status: 'prepared',
      warnings: [
        'Unsigned devnet transaction: inspect, sign externally, submit, then verify finalized chain state.',
        ...(input.action === 'deposit_card'
          ? ['Card deposit remains operator-proof and does not advance the duel database state.']
          : []),
        ...(input.action === 'refund_card' || input.action === 'refund_payment'
          ? [
              'Finalization records this per-asset refund proof; the duel remains refunding pending full custody quorum.',
            ]
          : []),
      ],
    };
  }

  private async persistTrackedIntent(input: PersistTrackedIntentInput) {
    const requestHash = digest(
      stableJson({
        action: input.action,
        caller: input.caller.toBase58(),
        duelId: input.duelId,
        instructionAccounts: input.instruction.keys.map((account) => ({
          address: account.pubkey.toBase58(),
          isSigner: account.isSigner,
          isWritable: account.isWritable,
        })),
        instructionData: bs58.encode(input.instruction.data),
        programId: input.instruction.programId.toBase58(),
        proof: input.proof,
      }),
    );
    const accounts = input.instruction.keys.map((account) => ({
      address: account.pubkey.toBase58(),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    }));
    const intent = await this.database.duelTransaction.upsert({
      create: {
        action: input.action,
        allowMultipleInstructionMatches: false,
        duelId: input.duelId,
        expectedAccounts: accounts as unknown as Prisma.InputJsonValue,
        expectedFromStatus: input.expectedFromStatus,
        expectedInstructionAccounts: accounts as unknown as Prisma.InputJsonValue,
        expectedInstructionDataHash: digest(bs58.encode(input.instruction.data)),
        expectedMessageHash: input.messageSha256,
        expectedProgramId: ESCROW_V2_PROGRAM_ID.toBase58(),
        expectedSigner: input.caller.toBase58(),
        expectedToStatus: input.expectedToStatus,
        expiresAt: new Date(Date.now() + 75_000),
        id: `tx_${randomUUID().replaceAll('-', '')}`,
        idempotencyKey: input.idempotencyKey,
        lastValidBlockHeight: input.lastValidBlockHeight,
        metadata: {
          operation: input.action.toLowerCase(),
          prepareRequestHash: requestHash,
          proof: input.proof,
        } as unknown as Prisma.InputJsonValue,
        network: 'DEVNET',
        providerReference:
          typeof input.proof.providerRequestId === 'string' ? input.proof.providerRequestId : null,
        recentBlockhash: input.recentBlockhash,
        serializedTransaction: input.serializedTransaction,
        status: DuelTransactionStatus.PREPARED,
        wallet: input.caller.toBase58(),
      },
      update: {},
      where: { idempotencyKey: input.idempotencyKey },
    });
    const metadata = parsePreparationMetadata(intent.metadata);
    if (
      intent.duelId !== input.duelId ||
      intent.wallet !== input.caller.toBase58() ||
      metadata?.prepareRequestHash !== requestHash
    ) {
      throw new ConflictException('Idempotency-Key was already used for another transaction');
    }
    if (
      intent.status !== DuelTransactionStatus.PREPARED ||
      !intent.serializedTransaction ||
      !intent.recentBlockhash ||
      intent.lastValidBlockHeight === null ||
      !intent.expectedMessageHash ||
      !intent.expiresAt ||
      intent.expiresAt <= new Date()
    ) {
      throw new ConflictException('Idempotent transaction intent is no longer reusable');
    }
    return intent;
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
      await this.assertVault(duel, side, evidence[side]);
    }
  }

  private async assertVault(
    duel: PublicKey,
    side: EscrowV2Role,
    outcome: CanonicalOutcome,
  ): Promise<void> {
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

function assertEscrowProgramConfiguration(): void {
  if (process.env.OPENPACKSDUEL_NETWORK !== 'solana-devnet') {
    throw new ServiceUnavailableException('Provider settlement is devnet-only');
  }
  const configuredProgram = parseConfigurationKey('ESCROW_PROGRAM_ID');
  if (!configuredProgram.equals(ESCROW_V2_PROGRAM_ID)) {
    throw new ServiceUnavailableException('Configured escrow program does not match escrow v2');
  }
}

function loadProviderConfiguration(): { feeRecipient: PublicKey; providerSigner: PublicKey } {
  if (process.env.OPENPACKSDUEL_PROVIDER_ASSET_STANDARD !== 'legacy-spl-nft') {
    throw new ServiceUnavailableException('Canonical provider asset standard is not confirmed');
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

export function assertOperationState(
  operation: PreparedProviderEscrowTransaction['action'],
  status: string,
): void {
  const allowed =
    operation === 'deposit_card' || operation === 'commit_result'
      ? ['AWAITING_ASSETS']
      : operation === 'settle'
        ? ['SETTLING']
        : ['REFUNDING'];
  if (!allowed.includes(status)) {
    throw new ConflictException(`${operation} cannot be prepared from ${status.toLowerCase()}`);
  }
}

function trackedTransition(action: PreparedProviderEscrowTransaction['action']): {
  action: PersistTrackedIntentInput['action'];
  from: PersistTrackedIntentInput['expectedFromStatus'];
  to: PersistTrackedIntentInput['expectedToStatus'];
} | null {
  if (action === 'commit_result') {
    return {
      action: DuelTransactionAction.COMMIT_RESULT,
      from: DuelStatus.AWAITING_ASSETS,
      to: DuelStatus.SETTLING,
    };
  }
  if (action === 'settle') {
    return {
      action: DuelTransactionAction.SETTLE,
      from: DuelStatus.SETTLING,
      to: DuelStatus.SETTLED,
    };
  }
  if (action === 'refund_card' || action === 'refund_payment') {
    return {
      action: DuelTransactionAction.REFUND,
      from: DuelStatus.REFUNDING,
      to: DuelStatus.REFUNDING,
    };
  }
  return null;
}

function parsePreparationMetadata(
  value: Prisma.JsonValue | null,
): { prepareRequestHash: string } | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const prepareRequestHash = value.prepareRequestHash;
  return typeof prepareRequestHash === 'string' ? { prepareRequestHash } : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
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

function canonicalOpenedAt(evidence: CanonicalEvidence): Date {
  return new Date(
    Math.max(evidence.creator.openedAt.getTime(), evidence.opponent.openedAt.getTime()),
  );
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
