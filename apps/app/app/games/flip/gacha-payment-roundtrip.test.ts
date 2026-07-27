import { describe, expect, test } from 'bun:test';

import { buildGachaPaymentTransaction } from '../../../../api/src/gacha/gacha-transaction';
import type {
  GachaPaymentIntent,
  PreparedGachaPaymentTransaction,
} from '../../solana/gacha-client';
import {
  decodeBase64Transaction,
  sha256Hex,
  validatePreparedTransaction,
} from './flip-machine-actions';

const PAYER = '9e5GLpBatYF8Utb9McZUxw96b17f22oJEtG72ZLUYqGV';
const HOUSE_TOKEN_ACCOUNT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const INTENT_ID = 'gachapay_4f6c1d90a37b48e2ac5518d0f27b6e34';
const MACHINE_KEY = 'dailydraft-devnet-football-50000000';
const BLOCKHASH = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

describe('server-built gacha payment round trip', () => {
  test('client validates the server hash against the compiled message, not the wire envelope', async () => {
    const built = buildGachaPaymentTransaction({
      amountMinor: 50_000_000n,
      decimals: 6,
      destinationTokenAccount: HOUSE_TOKEN_ACCOUNT,
      lastValidBlockHeight: 412_000_000n,
      memoNonce: INTENT_ID,
      mint: USDC_MINT,
      payerWallet: PAYER,
      recentBlockhash: BLOCKHASH,
    });
    const intent = {
      amountCurrency: 'USDC',
      amountDecimals: 6,
      amountMinor: '50000000',
      destinationTokenAccount: HOUSE_TOKEN_ACCOUNT,
      expiresAt: '2099-01-01T00:00:00.000Z',
      intentId: INTENT_ID,
      machineKey: MACHINE_KEY,
      memoNonce: INTENT_ID,
      mint: USDC_MINT,
      payerWallet: PAYER,
      resumed: false,
      signature: null,
      status: 'PENDING',
    } satisfies GachaPaymentIntent;
    const prepared = {
      amountMinor: intent.amountMinor,
      expectedMessageHash: built.expectedMessageHash,
      expiresAt: intent.expiresAt,
      intentId: intent.intentId,
      lastValidBlockHeight: '412000000',
      memoNonce: intent.memoNonce,
      recentBlockhash: BLOCKHASH,
      serializedTransactionBase64: built.serializedTransactionBase64,
      sourceTokenAccount: built.sourceTokenAccount,
    } satisfies PreparedGachaPaymentTransaction;
    const wireBytes = decodeBase64Transaction(prepared.serializedTransactionBase64);

    expect(await sha256Hex(wireBytes)).not.toBe(prepared.expectedMessageHash);
    await expect(
      validatePreparedTransaction(intent, prepared, wireBytes, Date.parse('2026-07-26T00:00:00Z')),
    ).resolves.toBeUndefined();
  });
});
