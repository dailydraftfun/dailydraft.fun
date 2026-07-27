import { describe, expect, test } from 'bun:test';
import { getDuelPullPresentation, getDuelReceiptPresentation } from './duel-receipt-presentation';
import type { PublicDuelReceipt } from './public-proof-client';

describe('duel receipt presentation', () => {
  test('presents a settled winner and runner-up before proof details', () => {
    const presentation = getDuelReceiptPresentation(receipt({ status: 'settled' }));

    expect(presentation.headline).toBe('Creator won the vault.');
    expect(presentation.finality).toEqual(
      expect.objectContaining({
        label: 'Result verified · ownership finalized',
        tone: 'verified',
      }),
    );
    expect(presentation.outcomeStates).toEqual([
      { emphasized: true, label: 'Winner', side: 'creator' },
      { emphasized: false, label: 'Runner-up', side: 'opponent' },
    ]);
    expect(presentation.scoreboard).toEqual({
      comparisonLabel: 'Winner',
      comparisonValue: 'Creator',
      marginLabel: 'Winning margin',
    });
  });

  test('treats both pulls as tied when authoritative values are equal', () => {
    const presentation = getDuelReceiptPresentation(
      receipt({ status: 'settling', winnerSide: null }),
    );

    expect(presentation.headline).toBe('The committed pulls are tied.');
    expect(presentation.outcomeStates.map((outcome) => outcome.label)).toEqual(['Tie', 'Tie']);
    expect(presentation.outcomeStates.every((outcome) => outcome.emphasized)).toBe(true);
    expect(presentation.subline).toContain('return each original card');
  });

  test('separates a committed result from pending ownership finality', () => {
    const presentation = getDuelReceiptPresentation(receipt({ status: 'settling' }));

    expect(presentation.finality).toEqual(
      expect.objectContaining({
        label: 'Result committed · ownership pending',
        tone: 'pending',
      }),
    );
  });

  test('does not claim a winner for a refunded duel without a result', () => {
    const presentation = getDuelReceiptPresentation(
      receipt({ status: 'refunded', withResult: false }),
    );

    expect(presentation.headline).toBe('This duel was refunded.');
    expect(presentation.finality.label).toBe('Refund finalized · no winner');
    expect(presentation.outcomeStates).toEqual([]);
  });

  test('does not claim a winner for an incomplete settled receipt', () => {
    const presentation = getDuelReceiptPresentation(
      receipt({ status: 'settled', withResult: false }),
    );

    expect(presentation.headline).toBe('Settlement recorded without result proof.');
    expect(presentation.subline).toContain('cannot name a winner');
    expect(presentation.outcomeStates).toEqual([]);
  });

  test('makes a failed duel and ownership disagreement explicit', () => {
    const failed = getDuelReceiptPresentation(receipt({ status: 'failed', withResult: false }));
    const disputed = getDuelReceiptPresentation(
      receipt({ cardActionReason: 'ownership-mismatch', status: 'settled' }),
    );

    expect(failed.finality).toEqual(
      expect.objectContaining({ label: 'No final result · attention required' }),
    );
    expect(disputed.finality).toEqual(
      expect.objectContaining({
        label: 'Result committed · ownership disputed',
        tone: 'attention',
      }),
    );
  });

  test('never turns a mock result into a real win claim', () => {
    const base = receipt({ status: 'settled' });
    const presentation = getDuelReceiptPresentation({
      ...base,
      result: base.result
        ? {
            ...base.result,
            outcomes: base.result.outcomes.map((outcome, index) => ({
              ...outcome,
              isMock: index === 0,
            })),
          }
        : null,
    });

    expect(presentation).toEqual(
      expect.objectContaining({
        badge: 'Devnet preview',
        headline: 'Devnet result preview.',
        mockPreview: true,
      }),
    );
    expect(presentation.finality).toEqual(
      expect.objectContaining({
        label: 'Preview only · no ownership finality',
        tone: 'neutral',
      }),
    );
    expect(presentation.outcomeStates).toEqual([
      { emphasized: true, label: 'Higher mock value', side: 'creator' },
      { emphasized: false, label: 'Mock pull', side: 'opponent' },
    ]);
    expect(presentation.scoreboard).toEqual({
      comparisonLabel: 'Higher mock value',
      comparisonValue: 'Creator',
      marginLabel: 'Mock margin',
    });
    expect(JSON.stringify(presentation)).not.toContain('"Winner"');
  });

  test('labels equal mock values without winner semantics', () => {
    expect(
      getDuelPullPresentation({
        mockPreview: true,
        side: 'creator',
        winnerSide: null,
      }),
    ).toEqual({
      emphasized: true,
      label: 'Equal mock value',
    });
  });

  test('keeps refunded committed results as safe terminal evidence', () => {
    const presentation = getDuelReceiptPresentation(receipt({ status: 'refunded' }));

    expect(presentation.finality).toEqual(
      expect.objectContaining({
        label: 'Refund finalized · no ownership transfer',
        tone: 'verified',
      }),
    );
  });

  test('keeps a settled result separate from unproven ownership', () => {
    const base = receipt({ status: 'settled' });
    const presentation = getDuelReceiptPresentation({
      ...base,
      cardActions: {
        ...base.cardActions,
        availability: 'hidden',
        reason: 'ownership-pending',
      },
    });

    expect(presentation.finality).toEqual(
      expect.objectContaining({
        label: 'Result verified · ownership unproven',
        tone: 'pending',
      }),
    );
  });

  test('raises a committed result with chain recovery alerts for review', () => {
    const base = receipt({ status: 'settled' });
    const presentation = getDuelReceiptPresentation({
      ...base,
      recovery: {
        alerts: [
          {
            action: 'settle',
            code: 'UNBOUND_FINALIZED_ESCROW_STATE_MISMATCH',
            detectedAt: '2026-07-16T00:06:00.000Z',
            explorerUrl: 'https://explorer.solana.com/tx/recovery?cluster=devnet',
            signature: 'recovery_signature',
          },
        ],
        status: 'attention-required',
      },
    });

    expect(presentation.finality).toEqual(
      expect.objectContaining({
        label: 'Result committed · ownership disputed',
        tone: 'attention',
      }),
    );
  });
});

function receipt({
  cardActionReason = null,
  status,
  winnerSide = 'creator',
  withResult = true,
}: {
  cardActionReason?: PublicDuelReceipt['cardActions']['reason'];
  status: PublicDuelReceipt['duel']['status'];
  winnerSide?: 'creator' | 'opponent' | null;
  withResult?: boolean;
}): PublicDuelReceipt {
  const ownershipFinal =
    status === 'settled' && withResult && cardActionReason !== 'ownership-mismatch';
  return {
    actions: {
      primary: { href: '/games/duel', label: 'Run a rematch' },
      rematch: null,
      share: { href: '/duel/duel_receipt', label: 'Share' },
    },
    availability: { complete: ownershipFinal, missing: [] },
    cardActions: {
      availability: ownershipFinal ? 'available' : 'hidden',
      cards: [],
      reason: ownershipFinal ? null : (cardActionReason ?? 'ownership-pending'),
      receiptHref: '/v1/duels/duel_receipt/receipt',
      schemaVersion: 'dailydraft.card-actions.v1',
    },
    custody: {
      cardAssets: {
        detail: ownershipFinal ? 'Finalized settlement reference recorded.' : 'Pending.',
        status: ownershipFinal ? 'settlement-reference-recorded' : 'provider-results-recorded',
      },
      platformFee: { asset: 'WSOL', escrowAddress: 'escrow', status: 'finalized' },
    },
    duel: {
      createdAt: '2026-07-16T00:00:00.000Z',
      expiresAt: '2026-07-16T00:15:00.000Z',
      id: 'duel_receipt',
      mode: 'direct',
      network: 'solana-devnet',
      observedAt: '2026-07-16T00:05:00.000Z',
      status,
    },
    fees: {
      asset: 'WSOL',
      finalizedSides: 2,
      perSideAmountLamports: '1000000',
      requiredSides: 2,
      totalFinalizedAmountLamports: '2000000',
    },
    pack: {
      id: 'pokemon_50',
      name: 'Pokemon $50',
      provider: 'collector-crypt',
      providerMode: 'collector-crypt-sandbox',
      providerPackId: 'pokemon_50',
      tier: money('50000000'),
    },
    participants: {
      creator: { address: 'creator', display: 'Creator', role: 'creator' },
      opponent: { address: 'opponent', display: 'Opponent', role: 'opponent' },
    },
    privacy: { indexable: false, reason: 'Test receipt.' },
    references: { provider: [], solana: [] },
    recovery: { alerts: [], status: 'none' },
    result: withResult
      ? {
          comparisonMetric: 'insured-value',
          margin: money(winnerSide === null ? '0' : '40000000'),
          outcomes: [
            outcome('creator', winnerSide === null ? '50000000' : '70000000'),
            outcome('opponent', winnerSide === null ? '50000000' : '30000000'),
          ],
          policy: {
            authoritativeField: 'insuredValue',
            currency: 'USDC',
            decimals: 6,
            hash: 'policy_hash',
            hashAlgorithm: 'sha256',
            maxSourceAgeSeconds: 60,
            maxValueMinorUnits: '1000000000',
            policyVersion: 'sandbox-v1',
            rounding: 'none',
            tieRule: 'return-original-assets-and-refund-platform-fees',
          },
          proof: {
            context: {
              creatorWallet: 'creator',
              duelId: 'duel_receipt',
              escrowAddress: 'escrow',
              network: 'solana-devnet',
              opponentWallet: 'opponent',
              providerMode: 'collector-crypt-sandbox',
            },
            creatorResultHash: 'creator_hash',
            opponentResultHash: 'opponent_hash',
            poolVersion: 'pool-v1',
            providerAttestation: {
              required: true,
              scope: 'escrow-mints-values-policy',
              status: 'on-chain-commitment-finalized',
            },
            schemaVersion: 'dailydraft.result-proof.v1',
          },
          resultHash: 'result_hash',
          settlementReady: true,
          totalValue: money('100000000'),
          valuationPolicyHash: 'policy_hash',
          winner:
            winnerSide === null
              ? null
              : winnerSide === 'creator'
                ? { address: 'creator', display: 'Creator', role: 'creator' }
                : { address: 'opponent', display: 'Opponent', role: 'opponent' },
          winnerSide,
        }
      : null,
    schemaVersion: 'dailydraft.receipt.v1',
  };
}

function money(amount: string) {
  return { amount, currency: 'USDC' as const, decimals: 6 as const };
}

function outcome(side: 'creator' | 'opponent', amount: string) {
  return {
    assetReference: `${side}_asset`,
    displayName: `${side} pull`,
    imageUrl: null,
    insuredValue: money(amount),
    isMock: false,
    openedAt: '2026-07-16T00:03:00.000Z',
    poolVersion: 'pool-v1',
    resultHash: `${side}_hash`,
    side,
    sourceTimestamp: '2026-07-16T00:03:00.000Z',
    valuationSourceReference: `${side}_value`,
  };
}
