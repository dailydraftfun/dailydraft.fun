import { describe, expect, test } from 'bun:test';

import type { Duel, DuelTransactionRecord } from '../domain.js';
import type { ProviderCardResult } from '../providers/pack-provider.js';
import { compareInsuredValues, normalizeProviderResult } from '../providers/provider-result.js';
import {
  CANONICAL_VALUATION_POLICY,
  CANONICAL_VALUATION_POLICY_HASH,
} from '../providers/valuation-policy.js';
import { buildPublicDuelReceipt, buildPublicWalletProfile } from './public-duel-proof.js';

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
const ESCROW = '7YttLkHDoNj9wyDur5rWnFwyCRLQ8vWUvqGL9cM23Zgy';

describe('public duel proof', () => {
  test('builds a strict receipt from public state without support metadata', () => {
    const receipt = buildPublicDuelReceipt(settledDuel(), fundingTransactions());

    expect(receipt.participants.creator.display).toBe('9xQe…9gJ1');
    expect(receipt.result?.winner?.address).toBe(CREATOR);
    expect(receipt.result?.totalValue.amount).toBe('115000000');
    expect(receipt.result?.margin.amount).toBe('85000000');
    expect(receipt.result?.policy).toEqual(
      expect.objectContaining({
        authoritativeField: 'collector-crypt.gacha.result.insuredValue',
        hash: CANONICAL_VALUATION_POLICY_HASH,
        tieRule: 'return-original-assets-and-refund-platform-fees',
      }),
    );
    expect(receipt.result?.proof).toEqual(
      expect.objectContaining({
        poolVersion: 'collector-crypt-pool-v1',
        schemaVersion: 'dailydraft.result-proof.v1',
      }),
    );
    expect(receipt.fees).toEqual({
      asset: 'WSOL',
      finalizedSides: 2,
      perSideAmountLamports: '1000000',
      requiredSides: 2,
      totalFinalizedAmountLamports: '2000000',
    });
    expect(receipt.references.solana[0]).toEqual(
      expect.objectContaining({
        bindingSource: 'rpc-recovery',
        recoveredAt: '2026-07-15T20:02:30.000Z',
      }),
    );
    expect(receipt.availability.missing).toContain('card_settlement_reference');
    expect(receipt.privacy.indexable).toBe(false);
    expect(JSON.stringify(receipt)).not.toContain('private support detail');
    expect(JSON.stringify(receipt)).not.toContain('RECONCILIATION_STUCK');
  });

  test('keeps timeout cancellation and absent custody understandable', () => {
    const receipt = buildPublicDuelReceipt(
      {
        ...settledDuel(),
        cancellationReason: 'timeout',
        escrowAddress: null,
        result: null,
        status: 'cancelled',
        winnerWallet: null,
      },
      [],
    );

    expect(receipt.duel.status).toBe('expired');
    expect(receipt.custody.platformFee.status).toBe('not-started');
    expect(receipt.custody.cardAssets.status).toBe('not-recorded');
    expect(receipt.actions.primary.label).toBe('Open a new duel');
  });

  test.each([
    ['waiting', '/overview?challenge=duel_receipt00001', 'Accept challenge'],
    ['matched', '/overview', 'Open a duel'],
    ['committing', '/overview', 'Open a duel'],
    ['funded', '/overview', 'Open a duel'],
    ['opening', '/overview', 'Open a duel'],
    ['awaiting_assets', '/overview', 'Open a duel'],
    ['settling', '/overview', 'Open a duel'],
    ['cancelling', '/overview', 'Open a duel'],
    ['refunding', '/overview', 'Open a duel'],
    ['settled', '/overview?rematch=duel_receipt00001', 'Run a rematch'],
    ['cancelled', '/overview', 'Open a new duel'],
    ['refunded', '/overview', 'Open a new duel'],
    ['failed', '/overview', 'Open a new duel'],
  ] as const)('owns the canonical %s primary action in the public receipt', (status, href, label) => {
    const receipt = buildPublicDuelReceipt(
      {
        ...settledDuel(),
        cancellationReason: null,
        status,
      },
      fundingTransactions(),
    );

    expect(receipt.actions.primary).toEqual({ href, label });
  });

  test('publishes a settlement-ready receipt for an equal-value tie', () => {
    const duel = settledDuel();
    const result = requireResult(duel);
    const creator = result.outcomes.find((outcome) => outcome.side === 'creator');
    if (!creator) throw new Error('Test fixture requires a creator outcome');
    const opponent = normalizeProviderResult(
      'opponent',
      providerResult(
        'mock:card:opponent',
        'Equal-value opponent',
        creator.insuredValue.amount,
        creator.sourceTimestamp,
      ),
      CANONICAL_VALUATION_POLICY_HASH,
      'mock:pack:opponent',
      new Date(creator.openedAt),
    );
    const comparison = compareInsuredValues(
      { ...creator, valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH },
      opponent,
      {
        creatorWallet: CREATOR,
        duelId: duel.id,
        escrowAddress: ESCROW,
        network: 'solana-devnet',
        opponentWallet: OPPONENT,
        providerMode: 'mock',
        valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
      },
    );
    const receipt = buildPublicDuelReceipt(
      {
        ...duel,
        result: {
          ...result,
          outcomes: [creator, toDuelOutcome(opponent)],
          resultHash: comparison.resultHash,
          winnerSide: null,
        },
        status: 'settling',
        winnerWallet: null,
      },
      fundingTransactions(),
    );

    expect(receipt.result).toEqual(
      expect.objectContaining({ settlementReady: true, winner: null, winnerSide: null }),
    );
  });

  test('publishes only exact verified unbound custody alerts', () => {
    const signature = '4'.repeat(88);
    const receipt = buildPublicDuelReceipt(settledDuel(), [
      {
        action: 'fund',
        createdAt: '2026-07-15T20:02:00.000Z',
        duelId: 'duel_receipt00001',
        id: 'tx_unbound_fund',
        network: 'solana-devnet',
        recoveryAlertCode: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH',
        recoveryCandidateAt: '2026-07-15T20:03:00.000Z',
        recoveryCandidateSignature: signature,
        status: 'prepared',
        updatedAt: '2026-07-15T20:03:00.000Z',
        wallet: CREATOR,
      },
    ]);

    expect(receipt.recovery.status).toBe('attention-required');
    expect(receipt.recovery.alerts).toEqual([
      expect.objectContaining({ signature, code: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH' }),
    ]);
    expect(receipt.references.solana).toEqual([]);
  });

  test('publishes provider recovery alerts with their actual action', () => {
    const signature = '6'.repeat(88);
    const receipt = buildPublicDuelReceipt(settledDuel(), [
      {
        action: 'commit_result',
        createdAt: '2026-07-15T20:02:00.000Z',
        duelId: 'duel_receipt00001',
        id: 'tx_unbound_commit_result',
        network: 'solana-devnet',
        recoveryAlertCode: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH',
        recoveryCandidateAt: '2026-07-15T20:03:00.000Z',
        recoveryCandidateSignature: signature,
        status: 'prepared',
        updatedAt: '2026-07-15T20:03:00.000Z',
        wallet: CREATOR,
      },
    ]);

    expect(receipt.recovery.alerts).toEqual([
      expect.objectContaining({ action: 'commit_result', signature }),
    ]);
  });

  test('does not treat an unfinalized settlement signature as custody proof', () => {
    const duel = settledDuel();
    const result = requireResult(duel);
    const outcomes = result.outcomes.map((outcome) => ({ ...outcome, isMock: false }));
    const creator = outcomes.find((outcome) => outcome.side === 'creator');
    const opponent = outcomes.find((outcome) => outcome.side === 'opponent');
    if (!creator || !opponent) throw new Error('Test fixture requires both outcomes');
    const comparison = compareInsuredValues(
      { ...creator, valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH },
      { ...opponent, valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH },
      {
        creatorWallet: CREATOR,
        duelId: duel.id,
        escrowAddress: ESCROW,
        network: 'solana-devnet',
        opponentWallet: OPPONENT,
        providerMode: 'collector-crypt-sandbox',
        valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
      },
    );
    const receipt = buildPublicDuelReceipt(
      {
        ...duel,
        providerMode: 'collector-crypt-sandbox',
        result: {
          ...result,
          outcomes,
          resultHash: comparison.resultHash,
        },
      },
      [
        ...fundingTransactions(),
        {
          action: 'settle',
          createdAt: '2026-07-15T20:04:00.000Z',
          duelId: 'duel_receipt00001',
          id: 'tx_settle_failed',
          network: 'solana-devnet',
          signature: '3'.repeat(88),
          status: 'failed',
          updatedAt: '2026-07-15T20:05:00.000Z',
          wallet: CREATOR,
        },
      ],
    );

    expect(receipt.references.solana).toContainEqual(
      expect.objectContaining({ action: 'settle', status: 'failed' }),
    );
    expect(receipt.custody.cardAssets.status).toBe('provider-results-recorded');
    expect(receipt.availability.missing).toContain('card_settlement_reference');
    expect(receipt.cardActions).toEqual(
      expect.objectContaining({ availability: 'hidden', cards: [], reason: 'ownership-pending' }),
    );
  });

  test('does not treat a finalized mock settlement as real card custody proof', () => {
    const receipt = buildPublicDuelReceipt(settledDuel(), [
      ...fundingTransactions(),
      {
        action: 'settle',
        createdAt: '2026-07-15T20:04:00.000Z',
        duelId: 'duel_receipt00001',
        finalizedAt: '2026-07-15T20:05:00.000Z',
        id: 'tx_settle_mock',
        network: 'solana-devnet',
        signature: '3'.repeat(88),
        status: 'finalized',
        updatedAt: '2026-07-15T20:05:00.000Z',
        wallet: CREATOR,
      },
    ]);

    expect(receipt.references.solana).toContainEqual(
      expect.objectContaining({ action: 'settle', status: 'finalized' }),
    );
    expect(receipt.custody.cardAssets.status).toBe('provider-results-recorded');
    expect(receipt.availability.missing).toContain('card_settlement_reference');
    expect(receipt.cardActions).toEqual(
      expect.objectContaining({ availability: 'hidden', cards: [], reason: 'mock-assets' }),
    );
  });

  test.each([
    ['creator', CREATOR, [CREATOR, CREATOR]],
    ['opponent', OPPONENT, [OPPONENT, OPPONENT]],
    [null, null, [CREATOR, OPPONENT]],
  ] as const)('projects independent per-card actions after a reconciled %s result', (winnerSide, winnerWallet, expectedOwners) => {
    const duel = realSettledDuel(winnerSide);
    expect(duel.winnerWallet ?? null).toBe(winnerWallet);
    const transactions = [...fundingTransactions(), settlementTransaction()];

    const first = buildPublicDuelReceipt(duel, transactions);
    const replay = buildPublicDuelReceipt(duel, transactions);

    expect(first.cardActions).toEqual(replay.cardActions);
    expect(first.cardActions).toEqual(
      expect.objectContaining({
        availability: 'available',
        reason: null,
        receiptHref: '/v1/duels/duel_receipt00001/receipt',
        schemaVersion: 'dailydraft.card-actions.v1',
      }),
    );
    expect(first.cardActions.cards).toHaveLength(2);
    expect(first.cardActions.cards.map((card) => card.owner.address)).toEqual([...expectedOwners]);
    expect(new Set(first.cardActions.cards.map((card) => card.actionStateId)).size).toBe(2);
    for (const card of first.cardActions.cards) {
      expect(card).toEqual(
        expect.objectContaining({
          duelId: duel.id,
          receiptHref: first.cardActions.receiptHref,
        }),
      );
      expect(card.ownership).toEqual({
        basis: 'finalized-settlement-reference',
        settlementSignature: '3'.repeat(88),
        status: 'reconciled',
      });
      expect(card.actions.map((action) => action.action)).toEqual([
        'keep',
        'list',
        'sell-back',
        'redeem',
      ]);
      expect(card.actions.find((action) => action.action === 'keep')).toEqual(
        expect.objectContaining({
          availability: 'available',
          capability: 'ownership-receipt',
          requiresSignature: false,
          transaction: null,
        }),
      );
      for (const action of card.actions.filter((candidate) => candidate.action !== 'keep')) {
        expect(action).toEqual(
          expect.objectContaining({
            alternative: { action: 'keep', label: 'Keep card' },
            availability: 'unavailable',
            reason: 'partner-onboarding-required',
            requiresSignature: false,
            transaction: null,
          }),
        );
      }
    }
  });

  test('hides actions while settlement ownership is pending or mismatched', () => {
    const pending = realSettledDuel('creator');
    const pendingReceipt = buildPublicDuelReceipt(pending, fundingTransactions());
    expect(pendingReceipt.cardActions).toEqual(
      expect.objectContaining({ availability: 'hidden', cards: [], reason: 'ownership-pending' }),
    );

    const mismatched = { ...realSettledDuel('creator'), winnerWallet: OPPONENT };
    const mismatchReceipt = buildPublicDuelReceipt(mismatched, [
      ...fundingTransactions(),
      settlementTransaction(),
    ]);
    expect(mismatchReceipt.cardActions).toEqual(
      expect.objectContaining({ availability: 'hidden', cards: [], reason: 'ownership-mismatch' }),
    );
  });

  test('calculates wallet record, biggest win, refunds, and pseudonymous opponents', () => {
    const settled = settledDuel();
    const loss = {
      ...settled,
      id: 'duel_loss00000001',
      winnerWallet: OPPONENT,
      result: { ...requireResult(settled), winnerSide: 'opponent' as const },
    };
    const refunded = {
      ...settledDuel(),
      id: 'duel_refund000001',
      result: null,
      status: 'refunded' as const,
      winnerWallet: null,
    };

    const profile = buildPublicWalletProfile(CREATOR, [settledDuel(), loss, refunded], false, 100);

    expect(profile.record).toEqual({
      active: 0,
      cancelledOrExpired: 0,
      completed: 2,
      losses: 1,
      refunded: 1,
      total: 3,
      wins: 1,
    });
    expect(profile.biggestWin?.duelId).toBe('duel_receipt00001');
    expect(profile.duels[0]?.opponentDisplay).toBe('DeWQ…12Eu');
    expect(profile.privacy.indexable).toBe(false);
  });

  test('fails closed when a recorded winner no longer reproduces from proof inputs', () => {
    const duel = settledDuel();
    const result = requireResult(duel);

    expect(() =>
      buildPublicDuelReceipt(
        { ...duel, result: { ...result, winnerSide: 'opponent' }, winnerWallet: OPPONENT },
        fundingTransactions(),
      ),
    ).toThrow('does not reproduce the recorded winner');
  });

  test('does not rewrite a committed result when a provider value is corrected later', () => {
    const duel = settledDuel();
    const result = requireResult(duel);
    const corrected = result.outcomes.map((outcome) =>
      outcome.side === 'creator'
        ? {
            ...outcome,
            insuredValue: { ...outcome.insuredValue, amount: '49000000' },
          }
        : outcome,
    );

    expect(() =>
      buildPublicDuelReceipt(
        { ...duel, result: { ...result, outcomes: corrected } },
        fundingTransactions(),
      ),
    ).toThrow('result hash does not match its proof inputs');
  });
});

function requireResult(duel: Duel): NonNullable<Duel['result']> {
  if (!duel.result) throw new Error('Test fixture requires a duel result');
  return duel.result;
}

function settledDuel(): Duel {
  const sourceTimestamp = '2026-07-15T20:03:30.000Z';
  const observedAt = new Date('2026-07-15T20:04:00.000Z');
  const creator = normalizeProviderResult(
    'creator',
    providerResult('mock:card:creator', 'Umbreon VMAX', '100000000', sourceTimestamp),
    CANONICAL_VALUATION_POLICY_HASH,
    'mock:pack:creator',
    observedAt,
  );
  const opponent = normalizeProviderResult(
    'opponent',
    providerResult('mock:card:opponent', 'Blastoise', '15000000', sourceTimestamp),
    CANONICAL_VALUATION_POLICY_HASH,
    'mock:pack:opponent',
    observedAt,
  );
  const comparison = compareInsuredValues(creator, opponent, {
    creatorWallet: CREATOR,
    duelId: 'duel_receipt00001',
    escrowAddress: ESCROW,
    network: 'solana-devnet',
    opponentWallet: OPPONENT,
    providerMode: 'mock',
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  });
  return {
    cancellationReason: null,
    createdAt: '2026-07-15T20:00:00.000Z',
    creatorWallet: CREATOR,
    environment: 'solana-devnet',
    escrowAddress: ESCROW,
    expiresAt: '2026-07-15T21:00:00.000Z',
    houseOpponent: false,
    id: 'duel_receipt00001',
    matchmakingMode: 'direct',
    opponentJoinedAt: '2026-07-15T20:01:00.000Z',
    opponentWallet: OPPONENT,
    pack: {
      active: true,
      id: 'pokemon_50',
      name: '$50 Pokémon Pack',
      price: { amount: '50000000', currency: 'USDC', decimals: 6 },
      provider: 'collector-crypt',
      providerPackId: 'pokemon_50',
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    },
    providerMode: 'mock',
    result: {
      comparisonMetric: 'insured-value',
      outcomes: [toDuelOutcome(creator), toDuelOutcome(opponent)],
      resultHash: comparison.resultHash,
      settlementReady: true,
      tieRule: CANONICAL_VALUATION_POLICY.tieRule,
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
      winnerSide: 'creator',
    },
    stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
    status: 'settled',
    updatedAt: '2026-07-15T20:10:00.000Z',
    version: 8,
    winnerWallet: CREATOR,
  };
}

function realSettledDuel(winnerSide: 'creator' | 'opponent' | null): Duel {
  const sourceTimestamp = '2026-07-15T20:03:30.000Z';
  const observedAt = new Date('2026-07-15T20:04:00.000Z');
  const values =
    winnerSide === 'creator'
      ? (['100000000', '15000000'] as const)
      : winnerSide === 'opponent'
        ? (['15000000', '100000000'] as const)
        : (['100000000', '100000000'] as const);
  const creator = normalizeProviderResult(
    'creator',
    providerResult('creator-card-mint', 'Umbreon VMAX', values[0], sourceTimestamp),
    CANONICAL_VALUATION_POLICY_HASH,
    'collector:pack:creator',
    observedAt,
  );
  const opponent = normalizeProviderResult(
    'opponent',
    providerResult('opponent-card-mint', 'Blastoise', values[1], sourceTimestamp),
    CANONICAL_VALUATION_POLICY_HASH,
    'collector:pack:opponent',
    observedAt,
  );
  const comparison = compareInsuredValues(creator, opponent, {
    creatorWallet: CREATOR,
    duelId: 'duel_receipt00001',
    escrowAddress: ESCROW,
    network: 'solana-devnet',
    opponentWallet: OPPONENT,
    providerMode: 'collector-crypt-sandbox',
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  });
  const base = settledDuel();
  return {
    ...base,
    providerMode: 'collector-crypt-sandbox',
    result: {
      ...requireResult(base),
      outcomes: [toDuelOutcome(creator, false), toDuelOutcome(opponent, false)],
      resultHash: comparison.resultHash,
      winnerSide,
    },
    winnerWallet: winnerSide === 'creator' ? CREATOR : winnerSide === 'opponent' ? OPPONENT : null,
  };
}

function providerResult(
  assetReference: string,
  displayName: string,
  amount: string,
  sourceTimestamp: string,
): ProviderCardResult {
  return {
    assetReference,
    displayName,
    insuredValue: { amount, currency: 'USDC', decimals: 6 },
    poolVersion: 'collector-crypt-pool-v1',
    sourceTimestamp,
    valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
  };
}

function toDuelOutcome(
  outcome: ReturnType<typeof normalizeProviderResult>,
  isMock = true,
): NonNullable<Duel['result']>['outcomes'][number] {
  return {
    assetReference: outcome.assetReference,
    displayName: outcome.displayName,
    insuredValue: outcome.insuredValue,
    isMock,
    openedAt: outcome.openedAt,
    poolVersion: outcome.poolVersion,
    provider: 'collector-crypt',
    providerReference: outcome.providerReference,
    resultHash: outcome.resultHash,
    side: outcome.side,
    sourceTimestamp: outcome.sourceTimestamp,
    ...(outcome.valuationSourceReference
      ? { valuationSourceReference: outcome.valuationSourceReference }
      : {}),
  };
}

function fundingTransactions(): DuelTransactionRecord[] {
  return [CREATOR, OPPONENT].map((wallet, index) => ({
    action: 'fund',
    createdAt: '2026-07-15T20:02:00.000Z',
    duelId: 'duel_receipt00001',
    errorCode: index === 0 ? 'RECONCILIATION_STUCK' : null,
    errorMessage: index === 0 ? 'private support detail' : null,
    feeAmountLamports: '1000000',
    finalizedAt: '2026-07-15T20:03:00.000Z',
    id: `tx_fund_${index}`,
    network: 'solana-devnet',
    recoveredAt: index === 0 ? '2026-07-15T20:02:30.000Z' : null,
    signature: `${index + 1}`.repeat(88),
    status: 'finalized',
    updatedAt: '2026-07-15T20:03:00.000Z',
    wallet,
  }));
}

function settlementTransaction(): DuelTransactionRecord {
  return {
    action: 'settle',
    createdAt: '2026-07-15T20:04:00.000Z',
    duelId: 'duel_receipt00001',
    finalizedAt: '2026-07-15T20:05:00.000Z',
    id: 'tx_settle_finalized',
    network: 'solana-devnet',
    signature: '3'.repeat(88),
    status: 'finalized',
    updatedAt: '2026-07-15T20:05:00.000Z',
    wallet: CREATOR,
  };
}
