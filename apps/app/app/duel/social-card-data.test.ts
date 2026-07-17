import { describe, expect, test } from 'bun:test';

import type { PublicDuelReceipt } from './public-proof-client';
import { getDuelSocialSnapshot, getPrimaryAction, getSocialDescription } from './social-card-data';

describe('duel social card data', () => {
  test('uses the receipt status instead of a forged URL status', () => {
    const snapshot = getDuelSocialSnapshot(receipt({ status: 'waiting' }), 'settled');

    expect(snapshot.status).toBe('waiting');
    expect(snapshot.requestedStatusMatches).toBe(false);
    expect(snapshot.pulls).toEqual([]);
  });

  test('renders only result values committed by the public receipt', () => {
    const snapshot = getDuelSocialSnapshot(
      receipt({ status: 'settled', withResult: true }),
      'settled',
    );

    expect(snapshot.headline).toBe('Creator won the vault.');
    expect(snapshot.pulls).toEqual([
      { displayName: 'Receipt pull A', side: 'creator', value: '$72.5', winner: true },
      { displayName: 'Receipt pull B', side: 'opponent', value: '$31', winner: false },
    ]);
    expect(snapshot.totalValue).toBe('$103.5');
  });

  test.each([
    ['waiting', '/overview?challenge=duel_truth', 'Accept challenge'],
    ['matched', '/duel/duel_truth', 'Watch live'],
    ['opening', '/duel/duel_truth', 'Watch live'],
    ['settled', '/overview?rematch=duel_truth', 'Run a rematch'],
    ['cancelled', '/overview', 'Open a new duel'],
    ['refunded', '/overview', 'Open a new duel'],
    ['expired', '/overview', 'Open a new duel'],
  ] as const)('uses a stable canonical action for %s', (status, href, label) => {
    const snapshot = getDuelSocialSnapshot(receipt({ status, withResult: status === 'settled' }));

    expect(getPrimaryAction(snapshot)).toEqual({ href, label });
  });

  test('keeps wallet addresses and transaction references out of social copy', () => {
    const publicReceipt = receipt({ status: 'opening' });
    publicReceipt.participants.creator.address = 'creator_sensitive_wallet_address';
    if (publicReceipt.participants.opponent) {
      publicReceipt.participants.opponent.address = 'opponent_sensitive_wallet_address';
    }
    publicReceipt.references.solana = [
      {
        action: 'fund',
        bindingSource: 'api-submission',
        explorerUrl: 'https://explorer.solana.com/tx/sensitive_signature',
        finalizedAt: null,
        recoveredAt: null,
        signature: 'sensitive_signature',
        status: 'finalized',
      },
    ];

    const snapshot = getDuelSocialSnapshot(publicReceipt);
    const sharedText = JSON.stringify({ snapshot, description: getSocialDescription(snapshot) });

    expect(sharedText).not.toContain('creator_sensitive_wallet_address');
    expect(sharedText).not.toContain('opponent_sensitive_wallet_address');
    expect(sharedText).not.toContain('sensitive_signature');
  });
});

function receipt({
  status,
  withResult = false,
}: {
  status: PublicDuelReceipt['duel']['status'];
  withResult?: boolean;
}): PublicDuelReceipt {
  return {
    actions: {
      primary: { href: '/duel/duel_truth', label: 'View' },
      rematch: null,
      share: { href: '/duel/duel_truth', label: 'Share' },
    },
    availability: { complete: withResult, missing: [] },
    cardActions: {
      availability: 'hidden',
      cards: [],
      reason: withResult ? 'mock-assets' : 'duel-not-settled',
      receiptHref: '/v1/duels/duel_truth/receipt',
      schemaVersion: 'openpacksduel.card-actions.v1',
    },
    custody: {
      cardAssets: { detail: 'Test', status: 'pending' },
      platformFee: { asset: 'WSOL', escrowAddress: null, status: 'pending' },
    },
    duel: {
      createdAt: '2026-07-16T00:00:00.000Z',
      expiresAt: '2026-07-16T00:15:00.000Z',
      id: 'duel_truth',
      mode: 'direct',
      network: 'solana-devnet',
      observedAt: '2026-07-16T00:01:00.000Z',
      status,
    },
    fees: {
      asset: 'WSOL',
      finalizedSides: 0,
      perSideAmountLamports: null,
      requiredSides: 2,
      totalFinalizedAmountLamports: null,
    },
    pack: {
      id: 'pokemon_50',
      name: 'Pokemon $50',
      provider: 'openpacksduel',
      providerMode: 'openpacksduel-devnet',
      providerPackId: null,
      tier: { amount: '50000000', currency: 'USDC', decimals: 6 },
    },
    participants: {
      creator: { address: 'creator', display: 'Creator', role: 'creator' },
      opponent: { address: 'opponent', display: 'Opponent', role: 'opponent' },
    },
    privacy: { indexable: false, reason: 'test' },
    references: { provider: [], solana: [] },
    recovery: { alerts: [], status: 'none' },
    result: withResult
      ? {
          comparisonMetric: 'insured-value',
          margin: { amount: '41500000', currency: 'USDC', decimals: 6 },
          outcomes: [
            outcome('creator', 'Receipt pull A', '72500000'),
            outcome('opponent', 'Receipt pull B', '31000000'),
          ],
          policy: {
            authoritativeField: 'insuredValue',
            currency: 'USDC',
            decimals: 6,
            hash: 'policy_hash',
            hashAlgorithm: 'sha256',
            maxSourceAgeSeconds: 60,
            maxValueMinorUnits: '1000000000',
            policyVersion: 'devnet-v1',
            rounding: 'none',
            tieRule: 'return-original-assets-and-refund-platform-fees',
          },
          proof: {
            context: {
              creatorWallet: 'creator',
              duelId: 'duel_truth',
              escrowAddress: 'escrow',
              network: 'solana-devnet',
              opponentWallet: 'opponent',
              providerMode: 'openpacksduel-devnet',
            },
            creatorResultHash: 'creator_hash',
            opponentResultHash: 'opponent_hash',
            poolVersion: 'pool-v1',
            providerAttestation: { required: true, scope: 'none', status: 'not-recorded' },
            schemaVersion: 'openpacksduel.result-proof.v1',
          },
          resultHash: 'result_hash',
          settlementReady: true,
          totalValue: { amount: '103500000', currency: 'USDC', decimals: 6 },
          valuationPolicyHash: 'policy_hash',
          winner: { address: 'creator', display: 'Creator', role: 'creator' },
          winnerSide: 'creator',
        }
      : null,
    schemaVersion: 'openpacksduel.receipt.v1',
  };
}

function outcome(side: 'creator' | 'opponent', displayName: string, amount: string) {
  return {
    assetReference: `${side}_asset`,
    displayName,
    imageUrl: null,
    insuredValue: { amount, currency: 'USDC' as const, decimals: 6 as const },
    isMock: false,
    openedAt: '2026-07-16T00:01:00.000Z',
    poolVersion: 'pool-v1',
    resultHash: `${side}_hash`,
    side,
    sourceTimestamp: '2026-07-16T00:01:00.000Z',
    valuationSourceReference: null,
  };
}
