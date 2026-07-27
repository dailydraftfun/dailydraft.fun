import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createDatabaseClient,
  type DatabaseClient,
  GachaRipPaymentStatus,
  GachaSport,
} from '@dailydraft/db';
import { Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { type LegacySplTokenAccount, SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import type {
  SolanaAddressSignature,
  SolanaSignatureStatus,
  SolanaTransactionEnvelope,
} from '../transactions/transaction-monitor.types.js';
import { GachaPaymentService } from './gacha-payment.service.js';
import { buildGachaPaymentTransaction } from './gacha-transaction.js';

const PAYER_KEYPAIR = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const PAYER = PAYER_KEYPAIR.publicKey.toBase58();
const HOUSE_TOKEN_ACCOUNT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const FIRST_BLOCKHASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const SECOND_BLOCKHASH = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const databaseUrl = process.env.DATABASE_URL;

if (process.env.REQUIRE_DB_INTEGRATION === '1' && !databaseUrl) {
  throw new Error('REQUIRE_DB_INTEGRATION=1 but DATABASE_URL is unset');
}

const describeDatabase =
  process.env.REQUIRE_DB_INTEGRATION === '1' && databaseUrl ? describe : describe.skip;

describeDatabase('Gacha payment idempotency against a real Postgres', () => {
  let database: DatabaseClient;
  let machineKey: string;
  const originalEnvironment = {
    fixture: process.env.DAILYDRAFT_GACHA_FIXTURE_MODE,
    mint: process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_MINT,
    network: process.env.DAILYDRAFT_NETWORK,
    providerMode: process.env.DAILYDRAFT_PROVIDER_MODE,
    tokenAccount: process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT,
  };

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl ?? '');
    machineKey = `dbtest-gacha-payment-${crypto.randomUUID().replaceAll('-', '')}`;
    delete process.env.DAILYDRAFT_GACHA_FIXTURE_MODE;
    process.env.DAILYDRAFT_NETWORK = 'solana-devnet';
    process.env.DAILYDRAFT_PROVIDER_MODE = 'dailydraft-devnet';
    process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT = HOUSE_TOKEN_ACCOUNT;
    process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_MINT = USDC_MINT;
    await database.gachaMachine.create({
      data: {
        active: true,
        committedPoolSize: 1,
        displayName: 'Database idempotency test machine',
        id: `gachamachine_${crypto.randomUUID().replaceAll('-', '')}`,
        machineKey,
        sport: GachaSport.FOOTBALL,
        tierPriceCurrency: 'USDC',
        tierPriceDecimals: 6,
        tierPriceMinor: '50000000',
      },
    });
  });

  afterAll(async () => {
    await database.gachaRipPayment.deleteMany({ where: { machineKey } });
    await database.gachaMachine.delete({ where: { machineKey } });
    await database.$disconnect();
    restoreEnvironment('DAILYDRAFT_GACHA_FIXTURE_MODE', originalEnvironment.fixture);
    restoreEnvironment('DAILYDRAFT_HOUSE_DEVNET_USDC_MINT', originalEnvironment.mint);
    restoreEnvironment('DAILYDRAFT_NETWORK', originalEnvironment.network);
    restoreEnvironment('DAILYDRAFT_PROVIDER_MODE', originalEnvironment.providerMode);
    restoreEnvironment(
      'DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT',
      originalEnvironment.tokenAccount,
    );
  });

  test('collapses concurrent creates and lets only one pre-broadcast signature win', async () => {
    const service = new GachaPaymentService(database, new DatabasePaymentRpc());
    const intents = await Promise.all(
      Array.from({ length: 8 }, () => service.createIntent({ machineKey, payerWallet: PAYER })),
    );
    const intentId = intents[0]?.intentId;

    if (!intentId) throw new Error('concurrent create returned no payment intent');
    expect(new Set(intents.map((intent) => intent.intentId)).size).toBe(1);
    expect(intents.filter((intent) => !intent.resumed)).toHaveLength(1);
    const pendingPaymentCount = await database.gachaRipPayment.count({
      where: {
        activeMachineKey: machineKey,
        activePayerWallet: PAYER,
        status: GachaRipPaymentStatus.PENDING,
      },
    });
    expect(pendingPaymentCount).toBe(1);

    const firstClaim = signedPayment(intentId, FIRST_BLOCKHASH);
    const secondClaim = signedPayment(intentId, SECOND_BLOCKHASH);
    const claims = await Promise.allSettled(
      [firstClaim, secondClaim].map((claim) =>
        service.claimSignature({
          intentId,
          signedTransactionBase64: claim.signedTransactionBase64,
        }),
      ),
    );
    expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(claims.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const stored = await database.gachaRipPayment.findUniqueOrThrow({
      where: { id: intentId },
    });
    expect([firstClaim.signature, secondClaim.signature]).toContain(stored.signature ?? '');
    await expect(service.createIntent({ machineKey, payerWallet: PAYER })).resolves.toMatchObject({
      intentId,
      resumed: true,
      signature: stored.signature,
    });

    const terminalAt = new Date();
    await database.gachaRipPayment.update({
      data: {
        activeMachineKey: null,
        activePayerWallet: null,
        status: GachaRipPaymentStatus.FAILED,
        terminalAt,
        terminalReason: 'DATABASE_TEST_FINALIZED_REJECTION',
      },
      where: { id: intentId },
    });
    const replacement = await service.createIntent({ machineKey, payerWallet: PAYER });
    expect(replacement.intentId).not.toBe(intentId);

    // Historical terminal rows deliberately share the same payer+machine. Their
    // nullable active slot must not collide with each other or with the new
    // unresolved replacement.
    const expiredAt = new Date();
    const createExpiredHistory = () => {
      const id = `gachapay_${crypto.randomUUID().replaceAll('-', '')}`;
      return database.gachaRipPayment.create({
        data: {
          amountCurrency: 'USDC',
          amountDecimals: 6,
          amountMinor: '50000000',
          destinationTokenAccount: HOUSE_TOKEN_ACCOUNT,
          expiresAt: new Date(expiredAt.getTime() + 60_000),
          id,
          machineKey,
          memoNonce: id,
          mint: USDC_MINT,
          payerWallet: PAYER,
          status: GachaRipPaymentStatus.EXPIRED,
          terminalAt: expiredAt,
          terminalReason: 'SEEDED_TERMINAL_HISTORY',
        },
      });
    };
    await expect(
      Promise.all([createExpiredHistory(), createExpiredHistory()]),
    ).resolves.toHaveLength(2);
  });
});

function signedPayment(
  intentId: string,
  recentBlockhash: string,
): { signature: string; signedTransactionBase64: string } {
  const built = buildGachaPaymentTransaction({
    amountMinor: 50_000_000n,
    decimals: 6,
    destinationTokenAccount: HOUSE_TOKEN_ACCOUNT,
    lastValidBlockHeight: 1n,
    memoNonce: intentId,
    mint: USDC_MINT,
    payerWallet: PAYER,
    recentBlockhash,
  });
  const transaction = Transaction.from(Buffer.from(built.serializedTransactionBase64, 'base64'));
  transaction.partialSign(PAYER_KEYPAIR);
  if (!transaction.signature) throw new Error('database test transaction was not signed');
  return {
    signature: bs58.encode(transaction.signature),
    signedTransactionBase64: transaction.serialize().toString('base64'),
  };
}

class DatabasePaymentRpc extends SolanaRpcGateway {
  async assertDevnet(): Promise<void> {}

  async getBlockHeight(): Promise<bigint> {
    return 1n;
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    return {
      blockhash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      lastValidBlockHeight: 1n,
    };
  }

  override async getLegacyTokenAccount(address: string): Promise<LegacySplTokenAccount> {
    return {
      amount: 0n,
      delegate: null,
      delegatedAmount: 0n,
      mint: USDC_MINT,
      owner: address,
    };
  }

  async getFinalizedSignaturesForAddress(): Promise<SolanaAddressSignature[]> {
    return [];
  }

  async getSignatureStatuses(): Promise<Array<SolanaSignatureStatus | null>> {
    return [];
  }

  async getTransaction(): Promise<SolanaTransactionEnvelope | null> {
    return null;
  }
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
