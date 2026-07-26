import { randomUUID } from 'node:crypto';
import { type DatabaseClient, GachaRipPaymentStatus, type Prisma } from '@dailydraft/db';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { acquireNamespacedAdvisoryTransactionLock } from '../database/advisory-lock.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import { readHouseTreasuryConfig } from '../treasury/house-treasury.policy.js';
import { gachaDepositConfigurationErrors, gachaDevnetModeEnabled } from './gacha-capability.js';
import { GachaPaymentError, verifyGachaPaymentTransaction } from './gacha-payment.js';
import { gachaFixtureModeEnabled } from './sports-pack-gacha.fixture.js';

// A rip is paid for in four moves, each of which has to survive the client
// disappearing between them:
//
//   createIntent    -> PENDING   a nonce the payer must echo in their memo
//   claimSignature -> PENDING   the first signed transaction wins before broadcast
//   verifyIntent   -> VERIFIED  a landed transfer proven to name that nonce
//   consume...     -> CONSUMED  the intent spent by exactly one rip
//
// A database unique key reserves one unresolved payer+machine slot, while a
// namespaced advisory lock serializes creation, signature claims, and terminal
// release. Guarded writes keep replay idempotent after the lock is released.

const GACHA_PAYMENT_INTENT_TTL_MS = 15 * 60 * 1000;
const BASE58_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const MEMO_NONCE_PATTERN = /^gachapay_[a-f0-9]{32}$/;
const AMOUNT_MINOR_PATTERN = /^[0-9]+$/;
const GACHA_ACTIVE_PAYMENT_LOCK_NAMESPACE = 1_746_330_128;

export interface CreateGachaPaymentIntentInput {
  machineKey: string;
  payerWallet: string;
}

export interface GachaPaymentIntent {
  amountCurrency: string;
  amountDecimals: number;
  amountMinor: string;
  destinationTokenAccount: string;
  expiresAt: Date;
  intentId: string;
  machineKey: string;
  /** The exact bytes the payer must put in the transaction's memo instruction. */
  memoNonce: string;
  mint: string;
  payerWallet: string;
  /** True when createIntent resumed the payer's unresolved machine payment. */
  resumed: boolean;
  /** The only signature allowed to settle this active intent, once claimed. */
  signature: string | null;
  status: GachaRipPaymentStatus;
}

export interface VerifyGachaPaymentInput {
  intentId: string;
  signature: string;
}

export type ClaimGachaPaymentSignatureInput = VerifyGachaPaymentInput;

export interface VerifiedGachaPayment {
  amountMinor: string;
  intentId: string;
  mintVerifiedOnChain: boolean;
  signature: string;
  verifiedAt: Date;
}

export interface ConsumeGachaPaymentInput {
  intentId: string;
  machineKey: string;
  now: Date;
  /** Must match the wallet the intent was issued to, so one player's verified
   * payment can never fund another player's rip. */
  payerWallet: string;
  ripId: string;
}

export interface FindConsumedGachaPaymentInput {
  intentId: string;
  machineKey: string;
  payerWallet: string;
}

interface GachaDepositConfig {
  destinationTokenAccount: string;
  mint: string;
}

interface GachaPaymentIntentRecord {
  amountCurrency: string;
  amountDecimals: number;
  amountMinor: string;
  destinationTokenAccount: string;
  expiresAt: Date;
  id: string;
  machineKey: string;
  memoNonce: string;
  mint: string;
  payerWallet: string;
  signature: string | null;
  status: GachaRipPaymentStatus;
}

type GachaPaymentTransaction = Prisma.TransactionClient;

@Injectable()
export class GachaPaymentService {
  /**
   * An SPL token account's mint is fixed when the account is created and can
   * never change, so the out-of-band lookup only has to run once per
   * destination rather than once per intent.
   */
  private readonly verifiedDestinationMints = new Map<string, string>();

  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly rpc: SolanaRpcGateway,
  ) {}

  /**
   * Issue the payment terms for one rip.
   *
   * The returned `memoNonce` is what the payer signs over, and it is also the
   * row's primary key: a transfer can therefore only ever answer the intent
   * whose nonce it names, and the unique index on `memoNonce` means that
   * mapping stays one-to-one.
   */
  async createIntent(input: CreateGachaPaymentIntentInput): Promise<GachaPaymentIntent> {
    if (gachaFixtureModeEnabled() || !gachaDevnetModeEnabled()) {
      throw new ServiceUnavailableException(
        'Gacha payment intents are disabled outside funded devnet mode',
      );
    }
    const machineKey = requireKey(input.machineKey, 'machineKey');
    const payerWallet = requireAddress(input.payerWallet, 'payerWallet');

    const resumed = await this.findOrExpireActiveIntent(payerWallet, machineKey);
    if (resumed) return toPaymentIntent(resumed, true);

    const config = resolveGachaDepositConfig();
    const machine = await this.database.gachaMachine.findUnique({
      select: {
        active: true,
        tierPriceCurrency: true,
        tierPriceDecimals: true,
        tierPriceMinor: true,
      },
      where: { machineKey },
    });
    if (!machine?.active) {
      throw new ConflictException('Gacha machine is not accepting rips');
    }
    if (machine.tierPriceCurrency !== 'USDC' || machine.tierPriceDecimals !== 6) {
      throw new ServiceUnavailableException('Gacha tier price is not denominated in devnet USDC');
    }
    const amountMinor = requireAmountMinor(machine.tierPriceMinor);

    await this.assertDestinationHoldsMint(config);

    return this.database.$transaction(async (transaction) => {
      await lockActivePayment(transaction, payerWallet, machineKey);
      const existing = await findActivePayment(transaction, payerWallet, machineKey);
      if (existing) {
        if (!unclaimedIntentExpired(existing, new Date())) {
          return toPaymentIntent(existing, true);
        }
        await expireUnclaimedIntent(transaction, existing.id, new Date());
      }

      const intentId = createId('gachapay');
      const createdAt = new Date();
      const payment = await transaction.gachaRipPayment.create({
        data: {
          activeMachineKey: machineKey,
          activePayerWallet: payerWallet,
          amountCurrency: 'USDC',
          amountDecimals: 6,
          amountMinor,
          destinationTokenAccount: config.destinationTokenAccount,
          expiresAt: new Date(createdAt.getTime() + GACHA_PAYMENT_INTENT_TTL_MS),
          id: intentId,
          machineKey,
          memoNonce: intentId,
          mint: config.mint,
          payerWallet,
        },
      });
      return toPaymentIntent(payment, false);
    });
  }

  /**
   * Atomically bind the first wallet signature before the client broadcasts it.
   *
   * Exact replay is the recovery path. A second signature can never replace the
   * first, even when tabs or devices race against each other.
   */
  async claimSignature(input: ClaimGachaPaymentSignatureInput): Promise<GachaPaymentIntent> {
    const intentId = requireMemoNonce(input.intentId);
    const signature = requireSignature(input.signature);
    const initial = await this.database.gachaRipPayment.findUnique({ where: { id: intentId } });
    if (!initial) throw new NotFoundException('Gacha payment intent was not found');

    const outcome = await this.database.$transaction(async (transaction) => {
      await lockActivePayment(transaction, initial.payerWallet, initial.machineKey);
      const payment = await transaction.gachaRipPayment.findUnique({ where: { id: intentId } });
      if (!payment) return { kind: 'missing' } as const;
      if (payment.status !== GachaRipPaymentStatus.PENDING) {
        if (payment.status === GachaRipPaymentStatus.VERIFIED && payment.signature === signature) {
          return { kind: 'claimed', payment } as const;
        }
        return { kind: 'terminal' } as const;
      }
      if (payment.signature) {
        return payment.signature === signature
          ? ({ kind: 'claimed', payment } as const)
          : ({ kind: 'conflict' } as const);
      }
      if (payment.expiresAt.getTime() <= Date.now()) {
        await expireUnclaimedIntent(transaction, intentId, new Date());
        return { kind: 'expired' } as const;
      }

      const signatureClaimedAt = new Date();
      const claimed = await transaction.gachaRipPayment.updateMany({
        data: { signature, signatureClaimedAt },
        where: {
          activeMachineKey: payment.machineKey,
          activePayerWallet: payment.payerWallet,
          id: intentId,
          signature: null,
          status: GachaRipPaymentStatus.PENDING,
        },
      });
      if (claimed.count !== 1) return { kind: 'conflict' } as const;
      return {
        kind: 'claimed',
        payment: { ...payment, signature, signatureClaimedAt },
      } as const;
    });

    if (outcome.kind === 'missing') {
      throw new NotFoundException('Gacha payment intent was not found');
    }
    if (outcome.kind === 'expired') {
      throw new ConflictException('Gacha payment intent expired before a signature was claimed');
    }
    if (outcome.kind === 'terminal') {
      throw new ConflictException('Gacha payment intent is no longer active');
    }
    if (outcome.kind === 'conflict') {
      throw new ConflictException('Gacha payment intent already claimed a different signature');
    }
    return toPaymentIntent(outcome.payment, true);
  }

  /**
   * Promote a pending intent to `VERIFIED` against a landed transaction.
   *
   * A signature the RPC has no record of is reported as a conflict rather than
   * a rejection: the overwhelmingly common cause is that the client polled
   * faster than the cluster confirmed, and the intent is still perfectly good.
   */
  async verifyIntent(input: VerifyGachaPaymentInput): Promise<VerifiedGachaPayment> {
    const intentId = requireMemoNonce(input.intentId);
    const signature = requireSignature(input.signature);

    const payment = await this.database.gachaRipPayment.findUnique({ where: { id: intentId } });
    if (!payment) throw new NotFoundException('Gacha payment intent was not found');

    // Re-verifying the same signature is how a client recovers from a dropped
    // response, so replay the recorded evidence instead of re-reading the chain.
    if (
      payment.status === GachaRipPaymentStatus.VERIFIED &&
      payment.signature === signature &&
      payment.verifiedAt
    ) {
      return {
        amountMinor: payment.amountMinor,
        intentId,
        mintVerifiedOnChain: payment.mintVerifiedOnChain,
        signature,
        verifiedAt: payment.verifiedAt,
      };
    }
    if (payment.status !== GachaRipPaymentStatus.PENDING) {
      throw new ConflictException('Gacha payment intent is no longer awaiting a transfer');
    }
    if (!payment.signature) {
      if (payment.expiresAt.getTime() <= Date.now()) {
        await this.expireUnclaimedPayment(payment);
        throw new ConflictException('Gacha payment intent expired before broadcast');
      }
      throw new ConflictException('Gacha payment signature must be claimed before verification');
    }
    if (payment.signature !== signature) {
      throw new ConflictException('Gacha payment intent already claimed a different signature');
    }

    const envelope = await this.rpc.getTransaction(signature, 'finalized');
    if (!envelope) {
      throw new ConflictException('Gacha payment transaction has not been finalized yet');
    }

    let mintVerifiedOnChain: boolean;
    try {
      ({ mintVerifiedOnChain } = verifyGachaPaymentTransaction(envelope, {
        destinationTokenAccount: payment.destinationTokenAccount,
        intentId: payment.memoNonce,
        minimumAmountMinor: BigInt(payment.amountMinor),
        mint: payment.mint,
        payerWallet: payment.payerWallet,
      }));
    } catch (error) {
      if (error instanceof GachaPaymentError) {
        if (error.code !== 'MISSING_TRANSACTION_META') {
          await this.failClaimedPayment(payment, error.code);
        }
        throw new ConflictException(`Gacha payment transaction was rejected: ${error.code}`);
      }
      throw error;
    }

    const verifiedAt = new Date();
    const verified = await this.database.gachaRipPayment.updateMany({
      data: { mintVerifiedOnChain, status: GachaRipPaymentStatus.VERIFIED, verifiedAt },
      where: {
        activeMachineKey: payment.machineKey,
        activePayerWallet: payment.payerWallet,
        id: intentId,
        signature,
        status: GachaRipPaymentStatus.PENDING,
      },
    });
    if (verified.count !== 1) {
      const replay = await this.database.gachaRipPayment.findUnique({ where: { id: intentId } });
      if (
        replay?.status === GachaRipPaymentStatus.VERIFIED &&
        replay.signature === signature &&
        replay.verifiedAt
      ) {
        return {
          amountMinor: replay.amountMinor,
          intentId,
          mintVerifiedOnChain: replay.mintVerifiedOnChain,
          signature,
          verifiedAt: replay.verifiedAt,
        };
      }
      throw new ConflictException('Gacha payment intent was settled concurrently');
    }

    return {
      amountMinor: payment.amountMinor,
      intentId,
      mintVerifiedOnChain,
      signature,
      verifiedAt,
    };
  }

  /**
   * Spend a verified intent on one rip, inside the caller's transaction.
   *
   * This runs in `createFixtureRip`'s existing transaction so the payment and
   * the seed commitment are consumed under the same advisory lock — a rip can
   * never be created against a payment that a concurrent request already spent.
   */
  async consumeVerifiedPayment(
    transaction: Prisma.TransactionClient,
    input: ConsumeGachaPaymentInput,
  ): Promise<void> {
    await lockActivePayment(transaction, input.payerWallet, input.machineKey);
    const now = input.now;
    const consumed = await transaction.gachaRipPayment.updateMany({
      data: {
        activeMachineKey: null,
        activePayerWallet: null,
        consumedAt: now,
        consumedByRipId: input.ripId,
        status: GachaRipPaymentStatus.CONSUMED,
        terminalAt: now,
        terminalReason: 'CONSUMED_BY_RIP',
      },
      where: {
        id: requireMemoNonce(input.intentId),
        machineKey: input.machineKey,
        payerWallet: input.payerWallet,
        status: GachaRipPaymentStatus.VERIFIED,
      },
    });
    if (consumed.count !== 1) {
      throw new ConflictException('Gacha rip payment is not verified or was already consumed');
    }
  }

  /**
   * Resolve the rip already funded by this intent after a dropped response.
   *
   * `paymentIntentId` is itself a durable idempotency anchor: once consumed it
   * points at exactly one rip through a unique foreign key, so a client can
   * recover even when it omitted the optional HTTP Idempotency-Key.
   */
  async findConsumedRip(
    transaction: Prisma.TransactionClient,
    input: FindConsumedGachaPaymentInput,
  ): Promise<string | null> {
    const payment = await transaction.gachaRipPayment.findUnique({
      select: { consumedByRipId: true, machineKey: true, payerWallet: true },
      where: { id: requireMemoNonce(input.intentId) },
    });
    if (!payment?.consumedByRipId) return null;
    if (payment.machineKey !== input.machineKey || payment.payerWallet !== input.payerWallet) {
      throw new ConflictException('Gacha payment replay changed its committed request');
    }
    return payment.consumedByRipId;
  }

  /**
   * Prove the destination token account actually holds the configured mint.
   *
   * A plain SPL `transfer` does not name a mint, so on its own it cannot show
   * which token moved. Resolving the destination's mint here closes that gap
   * permanently: a token account can only ever hold the one mint it was opened
   * for, so any transfer that credits this account credited USDC.
   */
  private async assertDestinationHoldsMint(config: GachaDepositConfig): Promise<void> {
    if (this.verifiedDestinationMints.get(config.destinationTokenAccount) === config.mint) return;

    let account: { mint: string };
    try {
      account = await this.rpc.getLegacyTokenAccount(config.destinationTokenAccount);
    } catch (error) {
      throw new ServiceUnavailableException(
        `Gacha payment destination could not be read: ${describeError(error)}`,
      );
    }
    if (account.mint !== config.mint) {
      throw new ServiceUnavailableException(
        'Gacha payment destination token account does not hold the configured mint',
      );
    }
    this.verifiedDestinationMints.set(config.destinationTokenAccount, account.mint);
  }

  private async findOrExpireActiveIntent(
    payerWallet: string,
    machineKey: string,
  ): Promise<GachaPaymentIntentRecord | null> {
    return this.database.$transaction(async (transaction) => {
      await lockActivePayment(transaction, payerWallet, machineKey);
      const payment = await findActivePayment(transaction, payerWallet, machineKey);
      if (!payment) return null;
      if (!unclaimedIntentExpired(payment, new Date())) return payment;
      await expireUnclaimedIntent(transaction, payment.id, new Date());
      return null;
    });
  }

  private async expireUnclaimedPayment(payment: GachaPaymentIntentRecord): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await lockActivePayment(transaction, payment.payerWallet, payment.machineKey);
      await expireUnclaimedIntent(transaction, payment.id, new Date());
    });
  }

  private async failClaimedPayment(
    payment: GachaPaymentIntentRecord,
    reason: string,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await lockActivePayment(transaction, payment.payerWallet, payment.machineKey);
      const terminalAt = new Date();
      await transaction.gachaRipPayment.updateMany({
        data: {
          activeMachineKey: null,
          activePayerWallet: null,
          status: GachaRipPaymentStatus.FAILED,
          terminalAt,
          terminalReason: reason,
        },
        where: {
          activeMachineKey: payment.machineKey,
          activePayerWallet: payment.payerWallet,
          id: payment.id,
          signature: payment.signature,
          status: GachaRipPaymentStatus.PENDING,
        },
      });
    });
  }
}

function resolveGachaDepositConfig(): GachaDepositConfig {
  const config = readHouseTreasuryConfig();
  const errors = gachaDepositConfigurationErrors(config);
  const { tokenAccount, usdcMint } = config;
  if (errors.length > 0 || !tokenAccount || !usdcMint) {
    throw new ServiceUnavailableException(
      `Gacha payments are not configured: ${errors.join(', ')}`,
    );
  }
  return { destinationTokenAccount: tokenAccount, mint: usdcMint };
}

async function lockActivePayment(
  transaction: GachaPaymentTransaction,
  payerWallet: string,
  machineKey: string,
): Promise<void> {
  await acquireNamespacedAdvisoryTransactionLock(
    transaction,
    `${payerWallet}:${machineKey}`,
    GACHA_ACTIVE_PAYMENT_LOCK_NAMESPACE,
  );
}

async function findActivePayment(
  transaction: GachaPaymentTransaction,
  payerWallet: string,
  machineKey: string,
): Promise<GachaPaymentIntentRecord | null> {
  return transaction.gachaRipPayment.findUnique({
    where: {
      activePayerWallet_activeMachineKey: {
        activeMachineKey: machineKey,
        activePayerWallet: payerWallet,
      },
    },
  });
}

function unclaimedIntentExpired(payment: GachaPaymentIntentRecord, now: Date): boolean {
  return (
    payment.status === GachaRipPaymentStatus.PENDING &&
    payment.signature === null &&
    payment.expiresAt.getTime() <= now.getTime()
  );
}

async function expireUnclaimedIntent(
  transaction: GachaPaymentTransaction,
  intentId: string,
  now: Date,
): Promise<void> {
  const expired = await transaction.gachaRipPayment.updateMany({
    data: {
      activeMachineKey: null,
      activePayerWallet: null,
      status: GachaRipPaymentStatus.EXPIRED,
      terminalAt: now,
      terminalReason: 'UNCLAIMED_INTENT_EXPIRED',
    },
    where: {
      id: intentId,
      signature: null,
      status: GachaRipPaymentStatus.PENDING,
    },
  });
  if (expired.count !== 1) {
    throw new ConflictException('Gacha payment intent could not be expired safely');
  }
}

function toPaymentIntent(payment: GachaPaymentIntentRecord, resumed: boolean): GachaPaymentIntent {
  return {
    amountCurrency: payment.amountCurrency,
    amountDecimals: payment.amountDecimals,
    amountMinor: payment.amountMinor,
    destinationTokenAccount: payment.destinationTokenAccount,
    expiresAt: payment.expiresAt,
    intentId: payment.id,
    machineKey: payment.machineKey,
    memoNonce: payment.memoNonce,
    mint: payment.mint,
    payerWallet: payment.payerWallet,
    resumed,
    signature: payment.signature,
    status: payment.status,
  };
}

function isBase58Address(value: string | null): boolean {
  return typeof value === 'string' && BASE58_ADDRESS_PATTERN.test(value);
}

function requireKey(value: string, field: string): string {
  if (typeof value !== 'string') throw new ConflictException(`${field} is invalid`);
  const canonical = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(canonical)) {
    throw new ConflictException(`${field} is invalid`);
  }
  return canonical;
}

function requireAddress(value: string, field: string): string {
  if (!isBase58Address(value)) throw new ConflictException(`${field} is invalid`);
  return value;
}

function requireSignature(value: string): string {
  if (typeof value !== 'string' || !SOLANA_SIGNATURE_PATTERN.test(value)) {
    throw new ConflictException('signature is invalid');
  }
  return value;
}

function requireMemoNonce(value: string): string {
  if (typeof value !== 'string' || !MEMO_NONCE_PATTERN.test(value)) {
    throw new ConflictException('intentId is invalid');
  }
  return value;
}

function requireAmountMinor(value: string): string {
  if (typeof value !== 'string' || !AMOUNT_MINOR_PATTERN.test(value) || BigInt(value) <= 0n) {
    throw new ServiceUnavailableException('Gacha tier price is invalid');
  }
  return value;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : 'unknown error';
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}
