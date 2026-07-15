import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { DuelSide, DuelStatus, DuelTransactionStatus, ProviderMode } from '@openpacksduel/db';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import {
  createDepositCardAssetInstruction,
  createRefundExpiredCardInstruction,
  createRefundExpiredPaymentInstruction,
  createSubmitResultInstruction,
  deriveEscrowV2Addresses,
  deriveEscrowV2CardVault,
  ESCROW_V2_PROGRAM_ID,
} from '../contracts/openpacksduel-escrow-v2.js';
import { normalizeProviderResult } from '../providers/provider-result.js';
import { CANONICAL_VALUATION_POLICY_HASH } from '../providers/valuation-policy.js';
import { PrismaTransactionMonitorRepository } from './prisma-transaction-monitor.repository.js';
import {
  canonicalOpenedAt,
  ProviderSettlementService,
  validateCanonicalEvidence,
} from './provider-settlement.service.js';
import { SolanaRpcGateway } from './solana-rpc.client.js';

const CREATOR = fixturePublicKey(1);
const OPPONENT = fixturePublicKey(2);
const PROVIDER = fixturePublicKey(3);
const POLICY = CANONICAL_VALUATION_POLICY_HASH;
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
    const wrongValue = evidence();
    requireOutcome(wrongValue, 0).insuredValueAmount = '199';
    expect(() => validateCanonicalEvidence(wrongValue)).toThrow(
      'result hash does not match its proof inputs',
    );
    const overflow = evidence();
    requireOutcome(overflow, 0).insuredValueAmount = 18_446_744_073_709_551_616n.toString();
    expect(() => validateCanonicalEvidence(overflow)).toThrow('exceeds u64');
    const mixedPool = evidence();
    requireOutcome(mixedPool, 1).poolVersion = 'collector-crypt-pool-v2';
    expect(() => validateCanonicalEvidence(mixedPool)).toThrow('one provider pool version');
    const stale = evidence();
    requireOutcome(stale, 0).sourceTimestamp = new Date('2026-07-15T19:54:59.000Z');
    expect(() => validateCanonicalEvidence(stale)).toThrow('snapshot is not canonical');
  });

  test('commits provider opening time instead of the older valuation snapshot time', () => {
    const canonical = validateCanonicalEvidence(evidence());

    expect(canonicalOpenedAt(canonical).toISOString()).toBe('2026-07-15T20:00:00.000Z');
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
        idempotencyKey: 'missing-vault-commit',
        operation: 'commit_result',
        providerRequestId: REQUEST,
      }),
    ).rejects.toThrow('Missing canonical creator card');
  });

  test('prepares a permissionless expired payment refund without server signing', async () => {
    delete process.env.OPENPACKSDUEL_PROVIDER_ASSET_STANDARD;
    delete process.env.ESCROW_PROVIDER_SIGNER;
    delete process.env.ESCROW_FEE_RECIPIENT;
    const duel: MutableDuelFixture = {
      ...databaseDuel(new Date(Date.now() - 60_000)),
      escrowAddress: null,
      status: DuelStatus.CANCELLED,
      version: 1,
    };
    const recovery = recoveryDatabase(duel);
    const monitor = new PrismaTransactionMonitorRepository(recovery.client);
    await monitor.recordRecoveryAlert({
      code: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH',
      nextRecoveryCheckAt: new Date(Date.now() + 60_000),
      now: new Date(),
      signature: '4'.repeat(88),
      transactionId: 'tx_lost_creator_funding',
    });

    expect(duel.status).toBe(DuelStatus.REFUNDING);
    expect(duel.escrowAddress).toBe(
      deriveEscrowV2Addresses(CREATOR, nonceFromFixtureDuel()).duel.toBase58(),
    );
    expect(recovery.events).toHaveLength(1);
    const service = new ProviderSettlementService(database(duel), new FixtureRpc());
    const prepared = await service.prepare({
      callerWallet: CREATOR.toBase58(),
      duelId: duel.id,
      idempotencyKey: 'expired-creator-payment-refund',
      operation: 'refund_payment',
      side: 'creator',
    });

    expect(prepared.action).toBe('refund_payment');
    expect(prepared.expectedSigner).toBe(CREATOR.toBase58());
    expect(prepared.intentId).toStartWith('tx_');
    expect(prepared.instruction.name).toBe('refund_expired_payment');
    expect(prepared.reconciliation).toBe('submission-monitor');
    expect(prepared.serializedTransactionBase64.length).toBeGreaterThan(100);
  });

  test('prepares an independently monitored expired card refund to its original owner', async () => {
    const duel = databaseDuel(new Date(Date.now() - 60_000));
    const service = new ProviderSettlementService(database(duel), new FixtureRpc());

    const prepared = await service.prepare({
      assetStandard: 'legacy-spl-nft',
      callerWallet: CREATOR.toBase58(),
      duelId: duel.id,
      idempotencyKey: 'expired-opponent-card-refund',
      operation: 'refund_card',
      side: 'opponent',
    });

    const opponentDestination = getAssociatedTokenAddressSync(OPPONENT, OPPONENT).toBase58();
    expect(prepared.action).toBe('refund_card');
    expect(prepared.intentId).toStartWith('tx_');
    expect(prepared.instruction.name).toBe('refund_expired_card');
    expect(prepared.instruction.accounts.map((account) => account.address)).toContain(
      opponentDestination,
    );
    expect(prepared.proof).toEqual(
      expect.objectContaining({ cardMint: OPPONENT.toBase58(), side: 'opponent' }),
    );
    expect(prepared.reconciliation).toBe('submission-monitor');
  });

  test('keeps card and result operations fail-closed when asset standard is unset', async () => {
    delete process.env.OPENPACKSDUEL_PROVIDER_ASSET_STANDARD;
    const duel = databaseDuel(new Date(Date.now() + 60_000));
    const service = new ProviderSettlementService(database(duel), new FixtureRpc());

    await expect(
      service.prepare({
        assetStandard: 'legacy-spl-nft',
        callerWallet: PROVIDER.toBase58(),
        duelId: duel.id,
        idempotencyKey: 'unconfirmed-standard-result',
        operation: 'commit_result',
        providerRequestId: REQUEST,
      }),
    ).rejects.toThrow('Canonical provider asset standard is not confirmed');
  });

  test('persists and replays a provider result intent by idempotency key', async () => {
    const duel = databaseDuel(new Date(Date.now() + 60_000));
    const service = new ProviderSettlementService(database(duel), new FixtureRpc());
    const input = {
      assetStandard: 'legacy-spl-nft' as const,
      callerWallet: PROVIDER.toBase58(),
      duelId: duel.id,
      idempotencyKey: 'provider-result-commitment',
      operation: 'commit_result' as const,
      providerRequestId: REQUEST,
    };

    const first = await service.prepare(input);
    const replay = await service.prepare(input);

    expect(first.intentId).toStartWith('tx_');
    expect(first.proof.creatorMint).toBe(CREATOR.toBase58());
    expect(first.proof.opponentMint).toBe(OPPONENT.toBase58());
    expect(replay.intentId).toBe(first.intentId);
    expect(replay.serializedTransactionBase64).toBe(first.serializedTransactionBase64);
    expect(first.reconciliation).toBe('submission-monitor');
    await expect(service.prepare({ ...input, providerRequestId: 'ef'.repeat(32) })).rejects.toThrow(
      'Idempotency-Key was already used for another transaction',
    );
  });

  test.each([
    ['creator', '200', '100', CREATOR, CREATOR],
    ['opponent', '100', '200', OPPONENT, OPPONENT],
    [null, '100', '100', CREATOR, OPPONENT],
  ] as const)('routes a %s result to exact card destinations in a monitored settlement intent', async (winner, creatorValue, opponentValue, creatorCardOwner, opponentCardOwner) => {
    const duel = {
      ...databaseDuel(new Date(Date.now() + 60_000)),
      ...evidence(creatorValue, opponentValue),
      status: 'SETTLING',
    };
    const service = new ProviderSettlementService(database(duel), new FixtureRpc());

    const prepared = await service.prepare({
      assetStandard: 'legacy-spl-nft',
      callerWallet: CREATOR.toBase58(),
      duelId: duel.id,
      idempotencyKey: `duel-settlement-${winner ?? 'tie'}`,
      operation: 'settle',
      providerRequestId: REQUEST,
    });

    const accounts = prepared.instruction.accounts.map((account) => account.address);
    expect(prepared.action).toBe('settle');
    expect(prepared.intentId).toStartWith('tx_');
    expect(prepared.instruction.name).toBe('settle_duel');
    expect(prepared.proof.winner).toBe(winner);
    expect(accounts).toContain(getAssociatedTokenAddressSync(CREATOR, creatorCardOwner).toBase58());
    expect(accounts).toContain(
      getAssociatedTokenAddressSync(OPPONENT, opponentCardOwner).toBase58(),
    );
    expect(prepared.reconciliation).toBe('submission-monitor');
  });

  test('rejects operations outside their duel lifecycle state', async () => {
    const duel = { ...databaseDuel(new Date(Date.now() + 60_000)), status: 'SETTLED' };
    const service = new ProviderSettlementService(database(duel), new FixtureRpc());

    await expect(
      service.prepare({
        assetStandard: 'legacy-spl-nft',
        callerWallet: CREATOR.toBase58(),
        duelId: duel.id,
        idempotencyKey: 'settled-deposit',
        operation: 'deposit_card',
        side: 'creator',
        sourceTokenAccount: CREATOR.toBase58(),
      }),
    ).rejects.toThrow('deposit_card cannot be prepared from settled');
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
  const sourceTimestamp = '2026-07-15T19:59:30.000Z';
  const openedAt = new Date('2026-07-15T20:00:00.000Z');
  const providerReference = `provider-${side.toLowerCase()}`;
  const normalized = normalizeProviderResult(
    side === DuelSide.CREATOR ? 'creator' : 'opponent',
    {
      assetReference,
      displayName: `${side.toLowerCase()} card`,
      insuredValue: { amount: value, currency: 'USDC', decimals: 6 },
      poolVersion: 'collector-crypt-pool-v1',
      sourceTimestamp,
      valuationPolicyHash: POLICY,
    },
    POLICY,
    providerReference,
    openedAt,
  );
  return {
    assetReference,
    displayName: normalized.displayName,
    insuredValueAmount: value,
    insuredValueCurrency: 'USDC',
    insuredValueDecimals: 6,
    isMock: false,
    openedAt,
    poolVersion: 'collector-crypt-pool-v1',
    providerReference,
    resultHash: normalized.resultHash,
    side,
    sourceTimestamp: new Date(sourceTimestamp),
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
  const nonce = nonceFromFixtureDuel();
  return {
    ...evidence(),
    creatorWallet: CREATOR.toBase58(),
    escrowAddress: deriveEscrowV2Addresses(CREATOR, nonce).duel.toBase58(),
    expiresAt,
    id,
    opponentWallet: OPPONENT.toBase58(),
    status: expiresAt.getTime() < Date.now() ? 'REFUNDING' : 'AWAITING_ASSETS',
  };
}

function nonceFromFixtureDuel(): bigint {
  return createHash('sha256').update('duel_provider_settlement_01').digest().readBigUInt64LE(0);
}

type MutableDuelFixture = Omit<ReturnType<typeof databaseDuel>, 'escrowAddress' | 'status'> & {
  escrowAddress: string | null;
  status: DuelStatus;
  version: number;
};

function recoveryDatabase(duel: MutableDuelFixture) {
  const expectedEscrow = deriveEscrowV2Addresses(CREATOR, nonceFromFixtureDuel()).duel.toBase58();
  const monitored = {
    duel,
    id: 'tx_lost_creator_funding',
    metadata: { escrowAddress: expectedEscrow, feeAmountLamports: '1000000' },
    recoveryAlertCode: null,
    recoveryCandidateAt: null,
    recoveryCandidateSignature: null,
    signature: null,
    status: DuelTransactionStatus.PREPARED,
  };
  const events: Array<Record<string, unknown>> = [];
  const transaction = {
    duel: {
      updateMany: ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.escrowAddress === 'string') duel.escrowAddress = data.escrowAddress;
        if (typeof data.status === 'string') duel.status = data.status as DuelStatus;
        duel.version += 1;
        return Promise.resolve({ count: 1 });
      },
    },
    duelEvent: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return Promise.resolve(data);
      },
    },
    duelTransaction: {
      findUnique: () => Promise.resolve(monitored),
      update: ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(monitored, data);
        return Promise.resolve(monitored);
      },
    },
  };
  return {
    client: {
      $transaction: (callback: (database: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as never,
    events,
  };
}

function fixturePublicKey(byte: number): PublicKey {
  const candidate = Uint8Array.from({ length: 32 }, () => byte);
  for (let suffix = 0; suffix <= 255; suffix += 1) {
    candidate[31] = suffix;
    if (PublicKey.isOnCurve(candidate)) return new PublicKey(candidate);
  }
  throw new Error(`Could not produce on-curve fixture ${byte}`);
}

function database(duel: ReturnType<typeof databaseDuel> | MutableDuelFixture): never {
  const transactions = new Map<string, Record<string, unknown>>();
  return {
    duel: { findUnique: () => Promise.resolve(duel) },
    duelTransaction: {
      upsert: ({ create }: { create: Record<string, unknown> }) => {
        const key = String(create.idempotencyKey);
        const existing = transactions.get(key);
        if (existing) return Promise.resolve(existing);
        transactions.set(key, create);
        return Promise.resolve(create);
      },
    },
  } as never;
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
  async getFinalizedSignaturesForAddress() {
    return [];
  }
  async getLegacyMint() {
    return { decimals: 0, supply: 1n };
  }
  async getLegacyTokenAccount(address: string) {
    const nonce = createHash('sha256')
      .update('duel_provider_settlement_01')
      .digest()
      .readBigUInt64LE(0);
    const duel = deriveEscrowV2Addresses(CREATOR, nonce).duel;
    const opponentVault = deriveEscrowV2CardVault(duel, 'opponent').toBase58();
    return {
      amount: this.vaultAmount,
      delegate: null,
      delegatedAmount: 0n,
      mint: address === opponentVault ? OPPONENT.toBase58() : CREATOR.toBase58(),
      owner: duel.toBase58(),
    };
  }
  async getSignatureStatuses() {
    return [];
  }
  async getTransaction() {
    return null;
  }
}
