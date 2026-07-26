import { randomUUID } from 'node:crypto';
import { type DatabaseClient, GachaRipPaymentStatus, type Prisma } from '@dailydraft/db';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
// biome-ignore lint/style/useImportType: Nest uses the abstract class as a runtime injection token.
import { SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import {
  type HouseTreasuryConfig,
  readHouseTreasuryConfig,
} from '../treasury/house-treasury.policy.js';
import { GachaPaymentError, verifyGachaPaymentTransaction } from './gacha-payment.js';

// A rip is paid for in three moves, each of which has to survive the client
// disappearing between them:
//
//   createIntent  -> PENDING   a nonce the payer must echo in their memo
//   verifyIntent  -> VERIFIED  a landed transfer proven to name that nonce
//   consume...    -> CONSUMED  the intent spent by exactly one rip
//
// Every transition is a guarded `updateMany` requiring `count === 1`, which is
// the same shape `gacha-rip.service.ts` uses for seed commitments. That is what
// makes the rail safe under concurrency: two racing consumers both issue the
// same conditional write, and the loser sees zero rows rather than a second rip.

const GACHA_PAYMENT_INTENT_TTL_MS = 15 * 60 * 1000;
const BASE58_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const MEMO_NONCE_PATTERN = /^gachapay_[a-f0-9]{32}$/;
const AMOUNT_MINOR_PATTERN = /^[0-9]+$/;

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
}

export interface VerifyGachaPaymentInput {
  intentId: string;
  signature: string;
}

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

interface GachaDepositConfig {
  destinationTokenAccount: string;
  mint: string;
}

/**
 * Validate only the treasury settings a deposit rail actually depends on.
 *
 * `houseTreasuryConfigurationErrors` is deliberately not reused here: it also
 * demands `DAILYDRAFT_HOUSE_ENABLED`, a funding signer, a separated withdrawal
 * authority, and three positive exposure limits. Those exist because the house
 * acts as a *counterparty* in duels and can lose money. A gacha rip only ever
 * moves USDC inward, so coupling Flip's availability to the duel risk controls
 * would gate it on settings that have nothing to do with taking a payment.
 */
export function gachaDepositConfigurationErrors(config: HouseTreasuryConfig): string[] {
  const errors: string[] = [];
  if (config.network !== 'solana-devnet') errors.push('devnet_required');
  if (!isBase58Address(config.tokenAccount)) errors.push('usdc_token_account_missing');
  if (!isBase58Address(config.usdcMint)) errors.push('usdc_mint_missing');
  return errors;
}

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
    const machineKey = requireKey(input.machineKey, 'machineKey');
    const payerWallet = requireAddress(input.payerWallet, 'payerWallet');
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

    const intentId = createId('gachapay');
    const createdAt = new Date();
    const payment = await this.database.gachaRipPayment.create({
      data: {
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
    };
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
    if (!payment) throw new ConflictException('Gacha payment intent was not found');

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
    if (payment.expiresAt.getTime() <= Date.now()) {
      await this.expireIntent(intentId);
      throw new ConflictException('Gacha payment intent has expired');
    }

    const envelope = await this.rpc.getTransaction(signature, 'confirmed');
    if (!envelope) {
      throw new ConflictException('Gacha payment transaction has not been confirmed yet');
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
        throw new ConflictException(`Gacha payment transaction was rejected: ${error.code}`);
      }
      throw error;
    }

    const verifiedAt = new Date();
    const verified = await this.database.gachaRipPayment.updateMany({
      data: { mintVerifiedOnChain, signature, status: GachaRipPaymentStatus.VERIFIED, verifiedAt },
      where: { id: intentId, status: GachaRipPaymentStatus.PENDING },
    });
    if (verified.count !== 1) {
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
    const consumed = await transaction.gachaRipPayment.updateMany({
      data: {
        consumedAt: input.now,
        consumedByRipId: input.ripId,
        status: GachaRipPaymentStatus.CONSUMED,
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

  /**
   * Time out an unpaid intent. Deliberately unguarded on the row count: a
   * transfer that landed in the same instant legitimately wins this race, and
   * the caller refuses the attempt either way.
   */
  private async expireIntent(intentId: string): Promise<void> {
    await this.database.gachaRipPayment.updateMany({
      data: { status: GachaRipPaymentStatus.EXPIRED },
      where: { id: intentId, status: GachaRipPaymentStatus.PENDING },
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
