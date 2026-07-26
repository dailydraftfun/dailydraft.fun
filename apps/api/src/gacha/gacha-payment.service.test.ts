import { afterEach, describe, expect, test } from 'bun:test';
import type { DatabaseClient, Prisma } from '@dailydraft/db';
import { GachaRipPaymentStatus } from '@dailydraft/db';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import bs58 from 'bs58';

import { type LegacySplTokenAccount, SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import type {
  SolanaAddressSignature,
  SolanaSignatureStatus,
  SolanaTransactionEnvelope,
} from '../transactions/transaction-monitor.types.js';
import { SPL_MEMO_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID } from './gacha-payment.js';
import { GachaPaymentService, gachaDepositConfigurationErrors } from './gacha-payment.service.js';

const PAYER = 'BkS1e5Kx8dCVAV4vXHzr4y6bTs2hUcHYD9Y4tzk6Bdub';
const OTHER_PAYER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const SOURCE_TOKEN_ACCOUNT = 'GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS';
const HOUSE_TOKEN_ACCOUNT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const DECOY_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const SIGNATURE =
  '5HxUXJ2mQm4FL4Y5MpHT9CzGSjeqxCT7QuBRGRcQZgYRC9nBWNe6RcT4tRSMFHRJXFmMSPPKHrjrfLxTX8N9pQzL';
const OTHER_SIGNATURE =
  '2VfUX9dqLgYtGZ4L5aVSLpNRBUEWXcCrLMdBGSBs4rMKcHTghMTU4hUGVbcTfaCMBrGxNW1TnBrGjJPzvXNMRTgQ';
const MACHINE_KEY = 'collector-crypt-football-50000000-devnet-fixture';
const TIER_PRICE = 50_000_000n;

const ORIGINAL_ENV = {
  mint: process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_MINT,
  network: process.env.DAILYDRAFT_NETWORK,
  tokenAccount: process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT,
};

afterEach(() => {
  restoreEnvironment('DAILYDRAFT_HOUSE_DEVNET_USDC_MINT', ORIGINAL_ENV.mint);
  restoreEnvironment('DAILYDRAFT_NETWORK', ORIGINAL_ENV.network);
  restoreEnvironment('DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT', ORIGINAL_ENV.tokenAccount);
});

describe('gachaDepositConfigurationErrors', () => {
  test('accepts a devnet deposit destination without the duel-side house risk controls', () => {
    // The house risk limits exist because the house is a duel counterparty. A rip
    // only moves USDC inward, so an unset exposure cap must not gate Flip.
    expect(
      gachaDepositConfigurationErrors({
        network: 'solana-devnet',
        tokenAccount: HOUSE_TOKEN_ACCOUNT,
        usdcMint: USDC_MINT,
      } as never),
    ).toEqual([]);
  });

  test('names every missing deposit setting at once', () => {
    expect(
      gachaDepositConfigurationErrors({
        network: 'solana-mainnet',
        tokenAccount: null,
        usdcMint: 'not-base58-!!',
      } as never),
    ).toEqual(['devnet_required', 'usdc_token_account_missing', 'usdc_mint_missing']);
  });
});

describe('GachaPaymentService.createIntent', () => {
  test('issues a pending intent whose id is the memo the payer must sign over', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());

    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });

    expect(intent.intentId).toMatch(/^gachapay_[a-f0-9]{32}$/);
    expect(intent.memoNonce).toBe(intent.intentId);
    expect(intent).toMatchObject({
      amountCurrency: 'USDC',
      amountDecimals: 6,
      amountMinor: TIER_PRICE.toString(),
      destinationTokenAccount: HOUSE_TOKEN_ACCOUNT,
      machineKey: MACHINE_KEY,
      mint: USDC_MINT,
      payerWallet: PAYER,
    });
    expect(intent.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(database.payments[0]?.status).toBe(GachaRipPaymentStatus.PENDING);
  });

  test('resolves the destination mint on chain so a plain transfer is still provably USDC', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    // A bare SPL `transfer` never names a mint. Proving the destination account
    // holds USDC is what makes crediting it sufficient evidence, so a destination
    // holding anything else has to fail before an intent is ever handed out.
    const rpc = new PaymentRpc({ destinationMint: DECOY_MINT });
    const service = new GachaPaymentService(asClient(database), rpc);

    await expect(
      service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(database.payments).toHaveLength(0);
  });

  test('resolves the destination mint once and reuses it across intents', async () => {
    configureDevnet();
    const rpc = new PaymentRpc();
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), rpc);

    await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: OTHER_PAYER });

    // A token account's mint is fixed at creation, so re-reading it per intent
    // would buy nothing and put an RPC round trip on the critical path.
    expect(rpc.tokenAccountReads).toBe(1);
  });

  test('refuses to price a rip when the deposit destination is unconfigured', async () => {
    configureDevnet();
    process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT = '';
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), new PaymentRpc());

    await expect(
      service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER }),
    ).rejects.toThrow('usdc_token_account_missing');
  });

  test('refuses a machine that is not accepting rips', async () => {
    configureDevnet();
    const database = new PaymentDatabase({ active: false });
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());

    await expect(
      service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  test('rejects a payer wallet that is not a Solana address', async () => {
    configureDevnet();
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), new PaymentRpc());

    await expect(
      service.createIntent({ machineKey: MACHINE_KEY, payerWallet: 'devnet-fixture-wallet' }),
    ).rejects.toThrow('payerWallet is invalid');
  });
});

describe('GachaPaymentService.verifyIntent', () => {
  test('promotes a pending intent once the memo-bound transfer has landed', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const rpc = new PaymentRpc({ envelope: paidEnvelope(intent.memoNonce) });
    const verifier = new GachaPaymentService(asClient(database), rpc);

    const verified = await verifier.verifyIntent({
      intentId: intent.intentId,
      signature: SIGNATURE,
    });

    expect(verified).toMatchObject({
      amountMinor: TIER_PRICE.toString(),
      intentId: intent.intentId,
      mintVerifiedOnChain: true,
      signature: SIGNATURE,
    });
    expect(database.payments[0]).toMatchObject({
      signature: SIGNATURE,
      status: GachaRipPaymentStatus.VERIFIED,
    });
    expect(rpc.transactionCommitments).toEqual(['finalized']);
  });

  test('reports a non-finalized signature as retryable rather than rejecting the intent', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({ envelope: null }),
    );

    await expect(
      verifier.verifyIntent({ intentId: intent.intentId, signature: SIGNATURE }),
    ).rejects.toThrow('has not been finalized yet');
    // The client polls faster than the cluster confirms far more often than it
    // sends a bad signature, so the intent must stay spendable.
    expect(database.payments[0]?.status).toBe(GachaRipPaymentStatus.PENDING);
  });

  test('surfaces the verifier failure code when the memo names a different intent', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({ envelope: paidEnvelope('gachapay_00000000000000000000000000000000') }),
    );

    await expect(
      verifier.verifyIntent({ intentId: intent.intentId, signature: SIGNATURE }),
    ).rejects.toThrow('MEMO_INTENT_MISMATCH');
  });

  test('expires an intent whose window closed before the transfer landed', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    database.expire(intent.intentId);
    const rpc = new PaymentRpc({ envelope: paidEnvelope(intent.memoNonce) });
    const verifier = new GachaPaymentService(asClient(database), rpc);

    await expect(
      verifier.verifyIntent({ intentId: intent.intentId, signature: SIGNATURE }),
    ).rejects.toThrow('has expired');
    expect(database.payments[0]?.status).toBe(GachaRipPaymentStatus.EXPIRED);
    // The chain is never read for an intent that already timed out.
    expect(rpc.transactionReads).toBe(0);
  });

  test('replays recorded evidence when the same signature is verified twice', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const rpc = new PaymentRpc({ envelope: paidEnvelope(intent.memoNonce) });
    const verifier = new GachaPaymentService(asClient(database), rpc);

    const first = await verifier.verifyIntent({ intentId: intent.intentId, signature: SIGNATURE });
    const replay = await verifier.verifyIntent({ intentId: intent.intentId, signature: SIGNATURE });

    expect(replay).toEqual(first);
    // A dropped response must not cost a second chain read, and must not look
    // like a second payment.
    expect(rpc.transactionReads).toBe(1);
  });

  test('refuses a second signature against an already verified intent', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({ envelope: paidEnvelope(intent.memoNonce) }),
    );
    await verifier.verifyIntent({ intentId: intent.intentId, signature: SIGNATURE });

    await expect(
      verifier.verifyIntent({ intentId: intent.intentId, signature: OTHER_SIGNATURE }),
    ).rejects.toThrow('no longer awaiting a transfer');
  });

  test('rejects an intent id that is not a payment nonce', async () => {
    configureDevnet();
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), new PaymentRpc());

    await expect(
      service.verifyIntent({ intentId: 'gacharip_deadbeef', signature: SIGNATURE }),
    ).rejects.toThrow('intentId is invalid');
  });

  test('rejects a malformed signature before reading the chain', async () => {
    configureDevnet();
    const rpc = new PaymentRpc();
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), rpc);

    await expect(
      service.verifyIntent({
        intentId: 'gachapay_4f6c1d90a37b48e2ac5518d0f27b6e34',
        signature: 'not-a-signature',
      }),
    ).rejects.toThrow('signature is invalid');
    expect(rpc.transactionReads).toBe(0);
  });

  test('reports an unknown intent rather than treating it as unpaid', async () => {
    configureDevnet();
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), new PaymentRpc());

    await expect(
      service.verifyIntent({
        intentId: 'gachapay_4f6c1d90a37b48e2ac5518d0f27b6e34',
        signature: SIGNATURE,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('GachaPaymentService.consumeVerifiedPayment', () => {
  test('spends a verified intent exactly once', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = await verifiedService(database);
    const intentId = database.payments[0]?.id ?? '';

    await service.consumeVerifiedPayment(asTransaction(database), {
      intentId,
      machineKey: MACHINE_KEY,
      now: new Date(),
      payerWallet: PAYER,
      ripId: 'gacharip_0123456789abcdef0123456789abcdef',
    });

    expect(database.payments[0]).toMatchObject({
      consumedByRipId: 'gacharip_0123456789abcdef0123456789abcdef',
      status: GachaRipPaymentStatus.CONSUMED,
    });
    await expect(
      service.findConsumedRip(asTransaction(database), {
        intentId,
        machineKey: MACHINE_KEY,
        payerWallet: PAYER,
      }),
    ).resolves.toBe('gacharip_0123456789abcdef0123456789abcdef');

    // The second attempt is the concurrency case: two rips racing for one
    // payment must not both find it spendable.
    await expect(
      service.consumeVerifiedPayment(asTransaction(database), {
        intentId,
        machineKey: MACHINE_KEY,
        now: new Date(),
        payerWallet: PAYER,
        ripId: 'gacharip_ffffffffffffffffffffffffffffffff',
      }),
    ).rejects.toThrow('already consumed');
  });

  test('refuses to fund a rip for a wallet the intent was not issued to', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = await verifiedService(database);

    await expect(
      service.consumeVerifiedPayment(asTransaction(database), {
        intentId: database.payments[0]?.id ?? '',
        machineKey: MACHINE_KEY,
        now: new Date(),
        payerWallet: OTHER_PAYER,
        ripId: 'gacharip_0123456789abcdef0123456789abcdef',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.payments[0]?.status).toBe(GachaRipPaymentStatus.VERIFIED);
  });

  test('refuses a payment that was never verified', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });

    await expect(
      service.consumeVerifiedPayment(asTransaction(database), {
        intentId: intent.intentId,
        machineKey: MACHINE_KEY,
        now: new Date(),
        payerWallet: PAYER,
        ripId: 'gacharip_0123456789abcdef0123456789abcdef',
      }),
    ).rejects.toThrow('is not verified');
  });
});

async function verifiedService(database: PaymentDatabase): Promise<GachaPaymentService> {
  const issuer = new GachaPaymentService(asClient(database), new PaymentRpc());
  const intent = await issuer.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
  const service = new GachaPaymentService(
    asClient(database),
    new PaymentRpc({ envelope: paidEnvelope(intent.memoNonce) }),
  );
  await service.verifyIntent({ intentId: intent.intentId, signature: SIGNATURE });
  return service;
}

function configureDevnet(): void {
  process.env.DAILYDRAFT_NETWORK = 'solana-devnet';
  process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT = HOUSE_TOKEN_ACCOUNT;
  process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_MINT = USDC_MINT;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

/** A settled `transferChecked` of the tier price, memo-bound to `intentId`. */
function paidEnvelope(intentId: string): SolanaTransactionEnvelope {
  const transfer = Buffer.alloc(10);
  transfer.writeUInt8(12, 0);
  transfer.writeBigUInt64LE(TIER_PRICE, 1);
  transfer.writeUInt8(6, 9);

  return {
    meta: { err: null, loadedAddresses: null },
    transaction: {
      message: {
        // Signers occupy the leading slots of a compiled message; the payer is 0.
        accountKeys: [
          PAYER,
          SOURCE_TOKEN_ACCOUNT,
          USDC_MINT,
          HOUSE_TOKEN_ACCOUNT,
          SPL_TOKEN_PROGRAM_ID,
          SPL_MEMO_PROGRAM_ID,
        ],
        header: {
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 3,
          numRequiredSignatures: 1,
        },
        instructions: [
          { accounts: [1, 2, 3, 0], data: bs58.encode(transfer), programIdIndex: 4 },
          { accounts: [], data: bs58.encode(Buffer.from(intentId, 'utf8')), programIdIndex: 5 },
        ],
        recentBlockhash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      },
      signatures: [SIGNATURE],
    },
  };
}

interface StoredPayment {
  amountCurrency: string;
  amountDecimals: number;
  amountMinor: string;
  consumedAt: Date | null;
  consumedByRipId: string | null;
  destinationTokenAccount: string;
  expiresAt: Date;
  id: string;
  machineKey: string;
  memoNonce: string;
  mint: string;
  mintVerifiedOnChain: boolean;
  payerWallet: string;
  signature: string | null;
  status: GachaRipPaymentStatus;
  verifiedAt: Date | null;
}

class PaymentDatabase {
  readonly payments: StoredPayment[] = [];

  constructor(private readonly machine: { active: boolean } = { active: true }) {}

  /** Drag an intent's window into the past without waiting out the real TTL. */
  expire(intentId: string): void {
    const payment = this.payments.find((candidate) => candidate.id === intentId);
    if (payment) payment.expiresAt = new Date(Date.now() - 1_000);
  }

  readonly gachaMachine = {
    findUnique: async ({ where }: { where: { machineKey: string } }) => {
      if (where.machineKey !== MACHINE_KEY) return null;
      return {
        active: this.machine.active,
        tierPriceCurrency: 'USDC',
        tierPriceDecimals: 6,
        tierPriceMinor: TIER_PRICE.toString(),
      };
    },
  };

  readonly gachaRipPayment = {
    create: async ({ data }: { data: Partial<StoredPayment> }) => {
      const payment: StoredPayment = {
        consumedAt: null,
        consumedByRipId: null,
        mintVerifiedOnChain: false,
        signature: null,
        status: GachaRipPaymentStatus.PENDING,
        verifiedAt: null,
        ...data,
      } as StoredPayment;
      this.payments.push(payment);
      return payment;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.payments.find((payment) => payment.id === where.id) ?? null;
    },
    updateMany: async ({
      data,
      where,
    }: {
      data: Partial<StoredPayment>;
      where: Partial<StoredPayment> & { id: string };
    }) => {
      const matched = this.payments.filter((payment) =>
        Object.entries(where).every(
          ([field, value]) => payment[field as keyof StoredPayment] === value,
        ),
      );
      for (const payment of matched) Object.assign(payment, data);
      return { count: matched.length };
    },
  };
}

class PaymentRpc extends SolanaRpcGateway {
  tokenAccountReads = 0;
  transactionCommitments: Array<'confirmed' | 'finalized'> = [];
  transactionReads = 0;

  constructor(
    private readonly options: {
      destinationMint?: string;
      envelope?: SolanaTransactionEnvelope | null;
    } = {},
  ) {
    super();
  }

  async assertDevnet(): Promise<void> {}

  async getBlockHeight(): Promise<bigint> {
    return 1n;
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    return { blockhash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', lastValidBlockHeight: 1n };
  }

  // The abstract base throws for this read, so the double has to answer it
  // explicitly rather than inherit.
  override async getLegacyTokenAccount(address: string): Promise<LegacySplTokenAccount> {
    this.tokenAccountReads += 1;
    return {
      amount: 0n,
      delegate: null,
      delegatedAmount: 0n,
      mint: this.options.destinationMint ?? USDC_MINT,
      owner: address,
    };
  }

  async getFinalizedSignaturesForAddress(): Promise<SolanaAddressSignature[]> {
    return [];
  }

  async getSignatureStatuses(): Promise<Array<SolanaSignatureStatus | null>> {
    return [];
  }

  async getTransaction(
    _signature: string,
    commitment: 'confirmed' | 'finalized',
  ): Promise<SolanaTransactionEnvelope | null> {
    this.transactionCommitments.push(commitment);
    this.transactionReads += 1;
    return this.options.envelope ?? null;
  }
}

function asClient(database: PaymentDatabase): DatabaseClient {
  return database as unknown as DatabaseClient;
}

function asTransaction(database: PaymentDatabase): Prisma.TransactionClient {
  return database as unknown as Prisma.TransactionClient;
}
