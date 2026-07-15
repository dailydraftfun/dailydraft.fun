import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { DuelSide, ProviderMode } from '@openpacksduel/db';
import { PublicKey } from '@solana/web3.js';

import {
  createDepositCardAssetInstruction,
  createRefundExpiredCardInstruction,
  createRefundExpiredPaymentInstruction,
  createSubmitResultInstruction,
  deriveEscrowV2Addresses,
  ESCROW_V2_PROGRAM_ID,
} from '../contracts/openpacksduel-escrow-v2.js';
import {
  ProviderSettlementService,
  validateCanonicalEvidence,
} from './provider-settlement.service.js';
import { SolanaRpcGateway } from './solana-rpc.client.js';

const CREATOR = new PublicKey('9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1');
const OPPONENT = new PublicKey('Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW');
const PROVIDER = new PublicKey('Hk2BD9SiMsePPgbiX85BDuZRX9BbVsde7sdYR7RYgZVo');
const POLICY = 'ab'.repeat(32);
const REQUEST = 'cd'.repeat(32);

describe('provider settlement evidence', () => {
  test.each([
    ['creator', '200', '100'],
    ['opponent', '100', '200'],
    [null, '100', '100'],
  ] as const)('calculates %s deterministically from canonical integers', (winner, creator, opponent) => {
    expect(validateCanonicalEvidence(evidence(creator, opponent)).winner).toBe(winner);
  });

  test('rejects mock results, wrong policy, invalid mint, and u64 overflow', () => {
    expect(() =>
      validateCanonicalEvidence({ ...evidence(), providerMode: ProviderMode.MOCK }),
    ).toThrow('confirmed provider evidence');
    const wrongPolicy = evidence();
    requireOutcome(wrongPolicy, 1).valuationPolicyHash = 'ef'.repeat(32);
    expect(() => validateCanonicalEvidence(wrongPolicy)).toThrow('valuation policy');
    const wrongMint = evidence();
    requireOutcome(wrongMint, 0).assetReference = 'not-a-mint';
    expect(() => validateCanonicalEvidence(wrongMint)).toThrow('not a valid Solana address');
    const overflow = evidence();
    requireOutcome(overflow, 0).insuredValueAmount = 18_446_744_073_709_551_616n.toString();
    expect(() => validateCanonicalEvidence(overflow)).toThrow('exceeds u64');
  });
});

describe('verified escrow instruction vectors', () => {
  test('encodes card roles, result replay PDA, and refund payloads from escrow v2 IDL', () => {
    const duel = deriveEscrowV2Addresses(CREATOR, 7n).duel;
    const creatorDeposit = createDepositCardAssetInstruction({
      cardMint: CREATOR,
      depositor: PROVIDER,
      depositorSource: OPPONENT,
      duel,
      role: 'creator',
    });
    const opponentDeposit = createDepositCardAssetInstruction({
      cardMint: OPPONENT,
      depositor: PROVIDER,
      depositorSource: CREATOR,
      duel,
      role: 'opponent',
    });
    expect([...creatorDeposit.data]).toEqual([212, 169, 85, 35, 162, 91, 119, 42, 0, 0]);
    expect([...opponentDeposit.data]).toEqual([212, 169, 85, 35, 162, 91, 119, 42, 1, 0]);

    const result = () =>
      createSubmitResultInstruction({
        creator: CREATOR,
        creatorCardMint: CREATOR,
        creatorValue: 200n,
        duel,
        openedAt: 1_700_000_000n,
        opponent: OPPONENT,
        opponentCardMint: OPPONENT,
        opponentValue: 100n,
        providerRequestId: Uint8Array.from(Buffer.from(REQUEST, 'hex')),
        providerSigner: PROVIDER,
        valuationPolicyHash: Uint8Array.from(Buffer.from(POLICY, 'hex')),
      });
    expect(result().resultCommitment.equals(result().resultCommitment)).toBe(true);
    expect([...result().instruction.data.subarray(0, 8)]).toEqual([
      240, 42, 89, 180, 10, 239, 9, 214,
    ]);
    expect([
      ...createRefundExpiredCardInstruction({
        caller: CREATOR,
        cardMint: OPPONENT,
        destination: OPPONENT,
        duel,
        role: 'opponent',
      }).data,
    ]).toEqual([160, 130, 63, 132, 223, 30, 235, 144, 1]);
    expect([
      ...createRefundExpiredPaymentInstruction({
        caller: CREATOR,
        destination: OPPONENT,
        duel,
        paymentMint: CREATOR,
        paymentVault: OPPONENT,
        player: OPPONENT,
      }).data.subarray(0, 8),
    ]).toEqual([82, 5, 192, 101, 25, 133, 163, 209]);
  });
});

describe('ProviderSettlementService', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.OPENPACKSDUEL_NETWORK = 'solana-devnet';
    process.env.OPENPACKSDUEL_PROVIDER_ASSET_STANDARD = 'legacy-spl-nft';
    process.env.ESCROW_PROGRAM_ID = ESCROW_V2_PROGRAM_ID.toBase58();
    process.env.ESCROW_PROVIDER_SIGNER = PROVIDER.toBase58();
    process.env.ESCROW_FEE_RECIPIENT = CREATOR.toBase58();
  });

  afterEach(() => {
    process.env = { ...original };
  });

  test('fails closed when either canonical card is missing from its vault', async () => {
    const duel = databaseDuel(new Date(Date.now() + 60_000));
    const rpc = new FixtureRpc();
    rpc.vaultAmount = 0n;
    const service = new ProviderSettlementService(database(duel), rpc);

    await expect(
      service.prepare({
        assetStandard: 'legacy-spl-nft',
        callerWallet: PROVIDER.toBase58(),
        duelId: duel.id,
        operation: 'commit_result',
        providerRequestId: REQUEST,
      }),
    ).rejects.toThrow('Missing canonical creator card');
  });

  test('prepares a permissionless expired payment refund without server signing', async () => {
    const duel = databaseDuel(new Date(Date.now() - 60_000));
    const service = new ProviderSettlementService(database(duel), new FixtureRpc());
    const prepared = await service.prepare({
      callerWallet: CREATOR.toBase58(),
      duelId: duel.id,
      operation: 'refund_payment',
      side: 'creator',
    });

    expect(prepared.action).toBe('refund_payment');
    expect(prepared.expectedSigner).toBe(CREATOR.toBase58());
    expect(prepared.instruction.name).toBe('refund_expired_payment');
    expect(prepared.serializedTransactionBase64.length).toBeGreaterThan(100);
  });
});

function evidence(creator = '200', opponent = '100') {
  return {
    packOutcomes: [
      outcome(DuelSide.CREATOR, CREATOR.toBase58(), creator),
      outcome(DuelSide.OPPONENT, OPPONENT.toBase58(), opponent),
    ],
    providerMode: ProviderMode.COLLECTOR_CRYPT_SANDBOX,
    valuationPolicyHash: POLICY,
  };
}

function outcome(side: DuelSide, assetReference: string, value: string) {
  return {
    assetReference,
    insuredValueAmount: value,
    insuredValueCurrency: 'USDC',
    insuredValueDecimals: 6,
    isMock: false,
    openedAt: new Date('2026-07-15T20:00:00.000Z'),
    providerReference: `provider-${side.toLowerCase()}`,
    side,
    valuationPolicyHash: POLICY,
  };
}

function requireOutcome(value: ReturnType<typeof evidence>, index: number) {
  const result = value.packOutcomes[index];
  if (!result) throw new Error(`Missing fixture outcome ${index}`);
  return result;
}

function databaseDuel(expiresAt: Date) {
  const id = 'duel_provider_settlement_01';
  const nonce = createHash('sha256')
    .update(`openpacksduel:escrow-v2:${id}`)
    .digest()
    .readBigUInt64LE(0);
  return {
    ...evidence(),
    creatorWallet: CREATOR.toBase58(),
    escrowAddress: deriveEscrowV2Addresses(CREATOR, nonce).duel.toBase58(),
    expiresAt,
    id,
    opponentWallet: OPPONENT.toBase58(),
  };
}

function database(duel: ReturnType<typeof databaseDuel>): never {
  return { duel: { findUnique: () => Promise.resolve(duel) } } as never;
}

class FixtureRpc extends SolanaRpcGateway {
  vaultAmount = 1n;
  async assertDevnet() {}
  async getBlockHeight() {
    return 100n;
  }
  async getLatestBlockhash() {
    return { blockhash: CREATOR.toBase58(), lastValidBlockHeight: 150n };
  }
  async getLegacyMint() {
    return { decimals: 0, supply: 1n };
  }
  async getLegacyTokenAccount(address: string) {
    const isCreator = address.includes('never-matches');
    return {
      amount: this.vaultAmount,
      mint: isCreator ? CREATOR.toBase58() : CREATOR.toBase58(),
      owner: deriveEscrowV2Addresses(
        CREATOR,
        createHash('sha256')
          .update('openpacksduel:escrow-v2:duel_provider_settlement_01')
          .digest()
          .readBigUInt64LE(0),
      ).duel.toBase58(),
    };
  }
  async getSignatureStatuses() {
    return [];
  }
  async getTransaction() {
    return null;
  }
}
