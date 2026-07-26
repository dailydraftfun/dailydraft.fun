import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseClient, Prisma } from '@dailydraft/db';
import { GachaRipPaymentStatus } from '@dailydraft/db';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Keypair, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { type LegacySplTokenAccount, SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import type {
  SolanaAddressSignature,
  SolanaSignatureStatus,
  SolanaTransactionEnvelope,
} from '../transactions/transaction-monitor.types.js';
import { gachaDepositConfigurationErrors } from './gacha-capability.js';
import { SPL_MEMO_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID } from './gacha-payment.js';
import { GachaPaymentService } from './gacha-payment.service.js';
import { buildGachaPaymentTransaction } from './gacha-transaction.js';

// Both payers are real on-curve public keys. That is load-bearing rather than
// cosmetic: preparing the transfer derives the payer's associated token account,
// which is only defined for a key that lies on the Ed25519 curve.
const PAYER_KEYPAIR = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const ATTACKER_KEYPAIR = Keypair.fromSeed(
  Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
);
const PAYER = PAYER_KEYPAIR.publicKey.toBase58();
const OTHER_PAYER = ATTACKER_KEYPAIR.publicKey.toBase58();
/** Base58 and the right length, but no private key behind it. */
const OFF_CURVE_WALLET = 'BkS1e5Kx8dCVAV4vXHzr4y6bTs2hUcHYD9Y4tzk6Bdub';
const SOURCE_TOKEN_ACCOUNT = 'GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS';
const HOUSE_TOKEN_ACCOUNT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const DECOY_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const SIGNATURE =
  '5HxUXJ2mQm4FL4Y5MpHT9CzGSjeqxCT7QuBRGRcQZgYRC9nBWNe6RcT4tRSMFHRJXFmMSPPKHrjrfLxTX8N9pQzL';
const OTHER_SIGNATURE =
  '2VfUX9dqLgYtGZ4L5aVSLpNRBUEWXcCrLMdBGSBs4rMKcHTghMTU4hUGVbcTfaCMBrGxNW1TnBrGjJPzvXNMRTgQ';
const OTHER_BLOCKHASH = ATTACKER_KEYPAIR.publicKey.toBase58();
const MACHINE_KEY = 'collector-crypt-football-50000000-devnet-fixture';
const TIER_PRICE = 50_000_000n;

const ORIGINAL_ENV = {
  fixture: process.env.DAILYDRAFT_GACHA_FIXTURE_MODE,
  mint: process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_MINT,
  network: process.env.DAILYDRAFT_NETWORK,
  node: process.env.NODE_ENV,
  providerMode: process.env.DAILYDRAFT_PROVIDER_MODE,
  tokenAccount: process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT,
  vercel: process.env.VERCEL_ENV,
};

afterEach(() => {
  restoreEnvironment('DAILYDRAFT_GACHA_FIXTURE_MODE', ORIGINAL_ENV.fixture);
  restoreEnvironment('DAILYDRAFT_HOUSE_DEVNET_USDC_MINT', ORIGINAL_ENV.mint);
  restoreEnvironment('DAILYDRAFT_NETWORK', ORIGINAL_ENV.network);
  restoreEnvironment('NODE_ENV', ORIGINAL_ENV.node);
  restoreEnvironment('DAILYDRAFT_PROVIDER_MODE', ORIGINAL_ENV.providerMode);
  restoreEnvironment('DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT', ORIGINAL_ENV.tokenAccount);
  restoreEnvironment('VERCEL_ENV', ORIGINAL_ENV.vercel);
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

  test('migration enforces one unresolved payer-machine slot and terminal evidence', () => {
    const migrationPath = fileURLToPath(
      new URL(
        '../../../../packages/db/prisma/migrations/20260726160000_gacha_active_payment_idempotency/migration.sql',
        import.meta.url,
      ),
    );
    const migration = readFileSync(migrationPath, 'utf8');
    const enumMigration = readFileSync(
      fileURLToPath(
        new URL(
          '../../../../packages/db/prisma/migrations/20260726155000_gacha_payment_failed_status/migration.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );

    expect(enumMigration).toContain("ADD VALUE 'FAILED'");
    expect(migration).not.toContain("ADD VALUE 'FAILED'");
    expect(migration).toContain(`WHEN "status" IN ('PENDING', 'VERIFIED') THEN "payerWallet"`);
    expect(migration).toContain(`WHEN "status" IN ('PENDING', 'VERIFIED') THEN "machineKey"`);
    expect(migration).toContain('DROP CONSTRAINT "GachaRipPayment_contract_check",');
    expect(migration).toContain(`"status" = 'FAILED'`);
    expect(migration).not.toContain(`"status" = 'PENDING'\n      AND "signature" IS NULL`);
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "GachaRipPayment_activePayerWallet_activeMachineKey_key"',
    );
    expect(migration).toContain('"GachaRipPayment_active_slot_check"');
    expect(migration).toContain('"GachaRipPayment_signature_claim_check"');
    expect(migration).toContain('"claimedRecentBlockhash"');
    expect(migration).toContain('"GachaRipPayment_reconciliation_evidence_check"');
    expect(migration).toContain('"GachaRipPayment_terminal_evidence_check"');
    expect(migration).toContain('duplicate unresolved Gacha payments require reconciliation');
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
      resumed: false,
      signature: null,
      status: GachaRipPaymentStatus.PENDING,
    });
    expect(intent.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(database.payments[0]?.status).toBe(GachaRipPaymentStatus.PENDING);
  });

  test('resumes the one active intent for the same payer and machine', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());

    const first = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const replay = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });

    expect(replay).toEqual({ ...first, resumed: true });
    expect(database.payments).toHaveLength(1);
  });

  test('resumes persisted terms while deposit configuration is temporarily unavailable', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const first = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT = '';

    await expect(
      service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER }),
    ).resolves.toEqual({ ...first, resumed: true });
  });

  test('atomically collapses concurrent creates onto one active intent', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());

    const intents = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER }),
      ),
    );

    expect(new Set(intents.map((intent) => intent.intentId)).size).toBe(1);
    expect(intents.filter((intent) => !intent.resumed)).toHaveLength(1);
    expect(database.payments).toHaveLength(1);
  });

  test('releases only an expired unclaimed intent and issues fresh terms', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const first = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    database.expire(first.intentId);

    const replacement = await service.createIntent({
      machineKey: MACHINE_KEY,
      payerWallet: PAYER,
    });

    expect(replacement.intentId).not.toBe(first.intentId);
    expect(database.payments).toHaveLength(2);
    expect(database.payments[0]).toMatchObject({
      activeMachineKey: null,
      activePayerWallet: null,
      status: GachaRipPaymentStatus.EXPIRED,
      terminalReason: 'UNCLAIMED_INTENT_EXPIRED',
    });
  });

  test('keeps an expired claimed intent active because broadcast outcome is ambiguous', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const first = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, first.intentId);
    database.expire(first.intentId);

    const resumed = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });

    expect(resumed).toMatchObject({
      intentId: first.intentId,
      resumed: true,
      signature,
      status: GachaRipPaymentStatus.PENDING,
    });
    expect(database.payments).toHaveLength(1);
  });

  test('releases a claimed slot only after blockhash expiry and chain-proven signature absence', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const rpc = new PaymentRpc({ blockhashValid: false, signatureStatus: null });
    const service = new GachaPaymentService(asClient(database), rpc);
    const first = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, first.intentId);
    database.expire(first.intentId);

    const replacement = await service.createIntent({
      machineKey: MACHINE_KEY,
      payerWallet: PAYER,
    });

    expect(replacement.intentId).not.toBe(first.intentId);
    expect(database.payments[0]).toMatchObject({
      activeMachineKey: null,
      activePayerWallet: null,
      signature,
      status: GachaRipPaymentStatus.FAILED,
      terminalReason: 'BLOCKHASH_EXPIRED_SIGNATURE_ABSENT',
    });
  });

  test('refuses to issue deposit terms outside funded devnet mode', async () => {
    configureDevnet();
    process.env.DAILYDRAFT_PROVIDER_MODE = 'mock';
    const database = new PaymentDatabase();
    const rpc = new PaymentRpc();
    const service = new GachaPaymentService(asClient(database), rpc);

    await expect(
      service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER }),
    ).rejects.toThrow('disabled outside funded devnet mode');
    expect(database.payments).toHaveLength(0);
    expect(rpc.tokenAccountReads).toBe(0);
  });

  test('refuses to issue deposit terms when fixture mode overrides devnet', async () => {
    configureDevnet();
    process.env.NODE_ENV = 'test';
    process.env.DAILYDRAFT_GACHA_FIXTURE_MODE = 'true';
    delete process.env.VERCEL_ENV;
    const database = new PaymentDatabase();
    const rpc = new PaymentRpc();
    const service = new GachaPaymentService(asClient(database), rpc);

    await expect(
      service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER }),
    ).rejects.toThrow('disabled outside funded devnet mode');
    expect(database.payments).toHaveLength(0);
    expect(rpc.tokenAccountReads).toBe(0);
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

  test('rejects an off-curve wallet that could never sign the transfer', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());

    // A program-derived address passes the base58 check but owns no associated
    // token account, so it would fail at preparation instead — three calls later
    // and as an unmapped 500. Refusing it here keeps the failure explicable.
    await expect(
      service.createIntent({ machineKey: MACHINE_KEY, payerWallet: OFF_CURVE_WALLET }),
    ).rejects.toThrow('payerWallet is invalid');
    expect(database.payments).toHaveLength(0);
  });
});

describe('GachaPaymentService.prepareTransaction', () => {
  test('answers a pending intent with a signable transfer bound to its nonce', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });

    const prepared = await service.prepareTransaction(intent.intentId);

    expect(prepared).toMatchObject({
      amountMinor: TIER_PRICE.toString(),
      intentId: intent.intentId,
      lastValidBlockHeight: '1',
      memoNonce: intent.memoNonce,
      recentBlockhash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    });
    expect(prepared.expectedMessageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.serializedTransactionBase64.length).toBeGreaterThan(0);
    // The intent stays spendable: preparing is not paying.
    expect(database.payments[0]?.status).toBe(GachaRipPaymentStatus.PENDING);
  });

  test('expires the returned bytes with the blockhash rather than the intent', async () => {
    configureDevnet();
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });

    const prepared = await service.prepareTransaction(intent.intentId);

    // An intent lives fifteen minutes and a blockhash about one, so the shorter
    // deadline is the honest one to show a player deciding whether to sign.
    expect(prepared.expiresAt.getTime()).toBeLessThan(intent.expiresAt.getTime());
    expect(prepared.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 75_000);
  });

  test('can be called again for the same intent when the player hesitates', async () => {
    configureDevnet();
    const rpc = new PaymentRpc();
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), rpc);
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });

    const first = await service.prepareTransaction(intent.intentId);
    const second = await service.prepareTransaction(intent.intentId);

    // Re-preparation is how a stale blockhash is recovered from, so it must not
    // consume the intent or change what the payer is being asked to send.
    expect(second.serializedTransactionBase64).toBe(first.serializedTransactionBase64);
    expect(second.amountMinor).toBe(first.amountMinor);
  });

  test('reports an unknown intent rather than inventing terms for it', async () => {
    configureDevnet();
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), new PaymentRpc());

    await expect(
      service.prepareTransaction('gachapay_4f6c1d90a37b48e2ac5518d0f27b6e34'),
    ).rejects.toThrow('was not found');
  });

  test('rejects an intent id that is not a payment nonce', async () => {
    configureDevnet();
    const service = new GachaPaymentService(asClient(new PaymentDatabase()), new PaymentRpc());

    await expect(service.prepareTransaction('gacharip_deadbeef')).rejects.toThrow(
      'intentId is invalid',
    );
  });

  test('refuses to re-issue bytes for an intent that has already been paid', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = await verifiedService(database);

    await expect(service.prepareTransaction(database.payments[0]?.id ?? '')).rejects.toThrow(
      'no longer awaiting a transfer',
    );
  });

  test('expires an intent whose window closed before the player asked to sign', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const rpc = new PaymentRpc();
    const service = new GachaPaymentService(asClient(database), rpc);
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    database.expire(intent.intentId);

    await expect(service.prepareTransaction(intent.intentId)).rejects.toThrow('has expired');
    expect(database.payments[0]?.status).toBe(GachaRipPaymentStatus.EXPIRED);
  });
});

describe('GachaPaymentService.claimSignature', () => {
  test('cryptographically proves the first signed transaction and replays it idempotently', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const signed = signedPaymentTransaction(intent.intentId);

    const claimed = await service.claimSignature({
      intentId: intent.intentId,
      signedTransactionBase64: signed.signedTransactionBase64,
    });
    const replay = await service.claimSignature({
      intentId: intent.intentId,
      signedTransactionBase64: signed.signedTransactionBase64,
    });

    expect(claimed).toMatchObject({ resumed: true, signature: signed.signature });
    expect(replay).toEqual(claimed);
    expect(database.payments[0]?.signatureClaimedAt).toBeInstanceOf(Date);
    expect(database.payments[0]?.claimedRecentBlockhash).toBe(
      'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    );
  });

  test('rejects an attacker-signed victim transaction without locking the intent', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const attackerSigned = signedPaymentTransaction(intent.intentId, {
      signer: ATTACKER_KEYPAIR,
    });

    await expect(
      service.claimSignature({
        intentId: intent.intentId,
        signedTransactionBase64: attackerSigned.signedTransactionBase64,
      }),
    ).rejects.toThrow('fee payer changed');
    expect(database.payments[0]).toMatchObject({
      signature: null,
      signatureClaimedAt: null,
    });
  });

  test('rejects invalid Ed25519 signatures and mismatched transaction fields', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const invalid = signedPaymentTransaction(intent.intentId);
    const invalidTransaction = Transaction.from(
      Buffer.from(invalid.signedTransactionBase64, 'base64'),
    );
    const firstSignature = invalidTransaction.signatures[0]?.signature;
    if (!firstSignature) throw new Error('test transaction signature missing');
    firstSignature[0] = (firstSignature[0] ?? 0) ^ 0xff;

    await expect(
      service.claimSignature({
        intentId: intent.intentId,
        signedTransactionBase64: invalidTransaction
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString('base64'),
      }),
    ).rejects.toThrow('signature is invalid');

    const wrongAmount = signedPaymentTransaction(intent.intentId, {
      amountMinor: TIER_PRICE + 1n,
    });
    await expect(
      service.claimSignature({
        intentId: intent.intentId,
        signedTransactionBase64: wrongAmount.signedTransactionBase64,
      }),
    ).rejects.toThrow('does not match');
    expect(database.payments[0]?.signature).toBeNull();
  });

  test('allows exactly one valid signed transaction when different blockhashes race', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const first = signedPaymentTransaction(intent.intentId);
    const second = signedPaymentTransaction(intent.intentId, { blockhash: OTHER_BLOCKHASH });

    const results = await Promise.allSettled(
      [first, second].map((signed) =>
        service.claimSignature({
          intentId: intent.intentId,
          signedTransactionBase64: signed.signedTransactionBase64,
        }),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect([first.signature, second.signature]).toContain(database.payments[0]?.signature ?? '');
  });
});

describe('GachaPaymentService.verifyIntent', () => {
  test('never reads the chain before the signature is claimed', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const rpc = new PaymentRpc();
    const service = new GachaPaymentService(asClient(database), rpc);
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });

    await expect(
      service.verifyIntent({ intentId: intent.intentId, signature: SIGNATURE }),
    ).rejects.toThrow('must be claimed before verification');
    expect(rpc.transactionReads).toBe(0);
  });

  test('promotes a pending intent once the memo-bound transfer has landed', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, intent.intentId);
    const rpc = new PaymentRpc({ envelope: paidEnvelope(intent.memoNonce) });
    const verifier = new GachaPaymentService(asClient(database), rpc);

    const verified = await verifier.verifyIntent({
      intentId: intent.intentId,
      signature,
    });

    expect(verified).toMatchObject({
      amountMinor: TIER_PRICE.toString(),
      intentId: intent.intentId,
      mintVerifiedOnChain: true,
      signature,
    });
    expect(database.payments[0]).toMatchObject({
      signature,
      status: GachaRipPaymentStatus.VERIFIED,
    });
    expect(rpc.transactionCommitments).toEqual(['finalized']);
  });

  test('reports a non-finalized signature as retryable rather than rejecting the intent', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, intent.intentId);
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({ envelope: null }),
    );

    await expect(verifier.verifyIntent({ intentId: intent.intentId, signature })).rejects.toThrow(
      'has not been finalized yet',
    );
    // The client polls faster than the cluster confirms far more often than it
    // sends a bad signature, so the intent must stay spendable.
    expect(database.payments[0]?.status).toBe(GachaRipPaymentStatus.PENDING);
  });

  test('keeps a finalized credited transfer fail-closed when its memo is ambiguous', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, intent.intentId);
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({ envelope: paidEnvelope('gachapay_00000000000000000000000000000000') }),
    );

    await expect(verifier.verifyIntent({ intentId: intent.intentId, signature })).rejects.toThrow(
      'MEMO_INTENT_MISMATCH',
    );
    expect(database.payments[0]).toMatchObject({
      activeMachineKey: MACHINE_KEY,
      activePayerWallet: PAYER,
      reconciliationReason: 'MEMO_INTENT_MISMATCH',
      status: GachaRipPaymentStatus.PENDING,
      terminalReason: null,
    });

    const replacement = await service.createIntent({
      machineKey: MACHINE_KEY,
      payerWallet: PAYER,
    });
    expect(replacement).toMatchObject({
      intentId: intent.intentId,
      resumed: true,
      signature,
    });
  });

  test('keeps an underpayment fail-closed for reconciliation instead of reopening the slot', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, intent.intentId);
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({
        envelope: paidEnvelope(intent.memoNonce, { amountMinor: TIER_PRICE - 1n }),
      }),
    );

    await expect(verifier.verifyIntent({ intentId: intent.intentId, signature })).rejects.toThrow(
      'AMOUNT_BELOW_TIER_PRICE',
    );
    expect(database.payments[0]).toMatchObject({
      activeMachineKey: MACHINE_KEY,
      activePayerWallet: PAYER,
      reconciliationReason: 'AMOUNT_BELOW_TIER_PRICE',
      status: GachaRipPaymentStatus.PENDING,
      terminalReason: null,
    });

    const resumed = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    expect(resumed).toMatchObject({ intentId: intent.intentId, resumed: true, signature });
  });

  test('keeps multiple destination credits fail-closed for reconciliation', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, intent.intentId);
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({
        envelope: paidEnvelope(intent.memoNonce, { duplicateDestinationTransfer: true }),
      }),
    );

    await expect(verifier.verifyIntent({ intentId: intent.intentId, signature })).rejects.toThrow(
      'AMBIGUOUS_PAYMENT_TRANSFER',
    );
    expect(database.payments[0]).toMatchObject({
      activeMachineKey: MACHINE_KEY,
      activePayerWallet: PAYER,
      reconciliationReason: 'AMBIGUOUS_PAYMENT_TRANSFER',
      status: GachaRipPaymentStatus.PENDING,
      terminalReason: null,
    });
  });

  test('keeps a successful envelope with missing transfer evidence fail-closed', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, intent.intentId);
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({
        envelope: paidEnvelope(intent.memoNonce, { omitDestinationTransfer: true }),
      }),
    );

    await expect(verifier.verifyIntent({ intentId: intent.intentId, signature })).rejects.toThrow(
      'TRANSFER_MISSING',
    );
    expect(database.payments[0]).toMatchObject({
      activeMachineKey: MACHINE_KEY,
      activePayerWallet: PAYER,
      reconciliationReason: 'TRANSFER_MISSING',
      status: GachaRipPaymentStatus.PENDING,
      terminalReason: null,
    });

    const resumed = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    expect(resumed).toMatchObject({ intentId: intent.intentId, resumed: true, signature });
  });

  test('releases the active slot only when finalized execution proves no credit occurred', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, intent.intentId);
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({
        envelope: paidEnvelope(intent.memoNonce, {
          transactionError: { InstructionError: [0, 'Custom'] },
        }),
      }),
    );

    await expect(verifier.verifyIntent({ intentId: intent.intentId, signature })).rejects.toThrow(
      'TRANSACTION_EXECUTION_ERROR',
    );
    expect(database.payments[0]).toMatchObject({
      activeMachineKey: null,
      activePayerWallet: null,
      status: GachaRipPaymentStatus.FAILED,
      terminalReason: 'TRANSACTION_EXECUTION_ERROR',
    });

    const replacement = await service.createIntent({
      machineKey: MACHINE_KEY,
      payerWallet: PAYER,
    });
    expect(replacement).toMatchObject({ resumed: false, signature: null });
    expect(replacement.intentId).not.toBe(intent.intentId);
  });

  test('expires an unclaimed intent whose window closed before broadcast', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    database.expire(intent.intentId);
    const rpc = new PaymentRpc({ envelope: paidEnvelope(intent.memoNonce) });
    const verifier = new GachaPaymentService(asClient(database), rpc);

    await expect(
      verifier.verifyIntent({ intentId: intent.intentId, signature: SIGNATURE }),
    ).rejects.toThrow('expired before broadcast');
    expect(database.payments[0]?.status).toBe(GachaRipPaymentStatus.EXPIRED);
    // The chain is never read for an intent that already timed out.
    expect(rpc.transactionReads).toBe(0);
  });

  test('replays recorded evidence when the same signature is verified twice', async () => {
    configureDevnet();
    const database = new PaymentDatabase();
    const service = new GachaPaymentService(asClient(database), new PaymentRpc());
    const intent = await service.createIntent({ machineKey: MACHINE_KEY, payerWallet: PAYER });
    const { signature } = await claimSignedPayment(service, intent.intentId);
    const rpc = new PaymentRpc({ envelope: paidEnvelope(intent.memoNonce) });
    const verifier = new GachaPaymentService(asClient(database), rpc);

    const first = await verifier.verifyIntent({ intentId: intent.intentId, signature });
    const replay = await verifier.verifyIntent({ intentId: intent.intentId, signature });

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
    const { signature } = await claimSignedPayment(service, intent.intentId);
    const verifier = new GachaPaymentService(
      asClient(database),
      new PaymentRpc({ envelope: paidEnvelope(intent.memoNonce) }),
    );
    await verifier.verifyIntent({ intentId: intent.intentId, signature });

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
      activeMachineKey: null,
      activePayerWallet: null,
      consumedByRipId: 'gacharip_0123456789abcdef0123456789abcdef',
      status: GachaRipPaymentStatus.CONSUMED,
      terminalReason: 'CONSUMED_BY_RIP',
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
  const { signature, signedTransactionBase64 } = signedPaymentTransaction(intent.intentId);
  await service.claimSignature({ intentId: intent.intentId, signedTransactionBase64 });
  await service.verifyIntent({ intentId: intent.intentId, signature });
  return service;
}

function signedPaymentTransaction(
  intentId: string,
  overrides: {
    amountMinor?: bigint;
    blockhash?: string;
    destinationTokenAccount?: string;
    memoNonce?: string;
    signer?: Keypair;
  } = {},
): { signature: string; signedTransactionBase64: string } {
  const signer = overrides.signer ?? PAYER_KEYPAIR;
  const built = buildGachaPaymentTransaction({
    amountMinor: overrides.amountMinor ?? TIER_PRICE,
    decimals: 6,
    destinationTokenAccount: overrides.destinationTokenAccount ?? HOUSE_TOKEN_ACCOUNT,
    lastValidBlockHeight: 1n,
    memoNonce: overrides.memoNonce ?? intentId,
    mint: USDC_MINT,
    payerWallet: signer.publicKey.toBase58(),
    recentBlockhash: overrides.blockhash ?? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  });
  const transaction = Transaction.from(Buffer.from(built.serializedTransactionBase64, 'base64'));
  transaction.partialSign(signer);
  const signatureBytes = transaction.signature;
  if (!signatureBytes) throw new Error('test transaction was not signed');
  return {
    signature: bs58.encode(signatureBytes),
    signedTransactionBase64: transaction.serialize().toString('base64'),
  };
}

async function claimSignedPayment(
  service: GachaPaymentService,
  intentId: string,
  overrides: Parameters<typeof signedPaymentTransaction>[1] = {},
): Promise<{ signature: string; signedTransactionBase64: string }> {
  const signed = signedPaymentTransaction(intentId, overrides);
  await service.claimSignature({
    intentId,
    signedTransactionBase64: signed.signedTransactionBase64,
  });
  return signed;
}

function configureDevnet(): void {
  delete process.env.DAILYDRAFT_GACHA_FIXTURE_MODE;
  process.env.DAILYDRAFT_NETWORK = 'solana-devnet';
  process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT = HOUSE_TOKEN_ACCOUNT;
  process.env.DAILYDRAFT_HOUSE_DEVNET_USDC_MINT = USDC_MINT;
  process.env.DAILYDRAFT_PROVIDER_MODE = 'dailydraft-devnet';
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

/** A settled `transferChecked` of the tier price, memo-bound to `intentId`. */
function paidEnvelope(
  intentId: string,
  options: {
    amountMinor?: bigint;
    duplicateDestinationTransfer?: boolean;
    omitDestinationTransfer?: boolean;
    transactionError?: unknown;
  } = {},
): SolanaTransactionEnvelope {
  const transfer = Buffer.alloc(10);
  transfer.writeUInt8(12, 0);
  transfer.writeBigUInt64LE(options.amountMinor ?? TIER_PRICE, 1);
  transfer.writeUInt8(6, 9);
  const transferInstruction = {
    accounts: [1, 2, 3, 0],
    data: bs58.encode(transfer),
    programIdIndex: 4,
  };

  return {
    meta: { err: options.transactionError ?? null, loadedAddresses: null },
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
          ...(options.omitDestinationTransfer ? [] : [transferInstruction]),
          ...(options.duplicateDestinationTransfer ? [transferInstruction] : []),
          { accounts: [], data: bs58.encode(Buffer.from(intentId, 'utf8')), programIdIndex: 5 },
        ],
        recentBlockhash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      },
      signatures: [SIGNATURE],
    },
  };
}

interface StoredPayment {
  activeMachineKey: string | null;
  activePayerWallet: string | null;
  amountCurrency: string;
  amountDecimals: number;
  amountMinor: string;
  claimedRecentBlockhash: string | null;
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
  reconciliationCheckedAt: Date | null;
  reconciliationReason: string | null;
  signature: string | null;
  signatureClaimedAt: Date | null;
  status: GachaRipPaymentStatus;
  terminalAt: Date | null;
  terminalReason: string | null;
  verifiedAt: Date | null;
}

class PaymentDatabase {
  readonly payments: StoredPayment[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

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
      if (
        data.activePayerWallet &&
        data.activeMachineKey &&
        this.payments.some(
          (payment) =>
            payment.activePayerWallet === data.activePayerWallet &&
            payment.activeMachineKey === data.activeMachineKey,
        )
      ) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const payment: StoredPayment = {
        activeMachineKey: null,
        activePayerWallet: null,
        claimedRecentBlockhash: null,
        consumedAt: null,
        consumedByRipId: null,
        mintVerifiedOnChain: false,
        reconciliationCheckedAt: null,
        reconciliationReason: null,
        signature: null,
        signatureClaimedAt: null,
        status: GachaRipPaymentStatus.PENDING,
        terminalAt: null,
        terminalReason: null,
        verifiedAt: null,
        ...data,
      } as StoredPayment;
      this.payments.push(payment);
      return payment;
    },
    findUnique: async ({
      where,
    }: {
      where:
        | { id: string }
        | {
            activePayerWallet_activeMachineKey: {
              activeMachineKey: string;
              activePayerWallet: string;
            };
          };
    }) => {
      if ('id' in where) {
        return this.payments.find((payment) => payment.id === where.id) ?? null;
      }
      const active = where.activePayerWallet_activeMachineKey;
      return (
        this.payments.find(
          (payment) =>
            payment.activeMachineKey === active.activeMachineKey &&
            payment.activePayerWallet === active.activePayerWallet,
        ) ?? null
      );
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

  async $executeRaw(): Promise<number> {
    return 1;
  }

  async $transaction<T>(
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let release = () => {};
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback(asTransaction(this));
    } finally {
      release();
    }
  }
}

class PaymentRpc extends SolanaRpcGateway {
  tokenAccountReads = 0;
  transactionCommitments: Array<'confirmed' | 'finalized'> = [];
  transactionReads = 0;

  constructor(
    private readonly options: {
      blockhashValid?: boolean;
      destinationMint?: string;
      envelope?: SolanaTransactionEnvelope | null;
      signatureStatus?: SolanaSignatureStatus | null;
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

  override async isBlockhashValid(): Promise<boolean> {
    return this.options.blockhashValid ?? true;
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

  async getSignatureStatuses(signatures: string[]): Promise<Array<SolanaSignatureStatus | null>> {
    if (!('signatureStatus' in this.options)) return [];
    return signatures.map(() => this.options.signatureStatus ?? null);
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
