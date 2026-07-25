import { describe, expect, test } from 'bun:test';

import { buildDuelMetadata } from './duel-metadata';
import type { PublicDuelReceipt } from './public-proof-client';

describe('duel metadata', () => {
  test('discovers the canonical per-status social image for an open challenge', () => {
    const metadata = buildDuelMetadata(
      receipt({ status: 'waiting' }),
      'https://dailydraft.fun/ignored-path',
    );
    const imageUrl = new URL('https://dailydraft.fun/duel/duel_social/social/waiting');

    expect(metadata.alternates?.canonical).toEqual(
      new URL('https://dailydraft.fun/duel/duel_social'),
    );
    expect(metadata.openGraph?.url).toEqual(new URL('https://dailydraft.fun/duel/duel_social'));
    expect(metadata.openGraph?.images).toEqual([
      {
        alt: 'Challenge open for Creator vs open seat on Solana devnet',
        height: 630,
        url: imageUrl,
        width: 1200,
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      {
        alt: 'Challenge open for Creator vs open seat on Solana devnet',
        url: imageUrl,
      },
    ]);
  });

  test('keeps mock settlement metadata explicit about devnet', () => {
    const metadata = buildDuelMetadata(
      receipt({ mockResult: true, status: 'settled' }),
      'https://dailydraft.fun',
    );

    expect(metadata.title).toBe('Devnet mock result — DailyDraft');
    expect(metadata.description).toContain('Solana devnet');
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({
        url: new URL('https://dailydraft.fun/duel/duel_social/social/settled'),
      }),
    ]);
    expect(metadata.twitter).toEqual(expect.objectContaining({ card: 'summary_large_image' }));
  });

  test.each([
    ['waiting', 'Creator opened a $50 challenge.'],
    ['matched', 'Creator vs Waiting for opponent in a $50 Card Duel.'],
    ['opening', 'The outcomes stay hidden until both results are committed.'],
    ['settled', 'Mock pull A ($51) faced Mock pull B ($50)'],
    ['cancelled', 'No cards changed hands.'],
    ['refunded', 'This duel was refunded.'],
    ['expired', 'This seat timed out.'],
  ] as const)('uses the canonical %s social image and status-aware copy', (status, copy) => {
    const metadata = buildDuelMetadata(
      receipt({ mockResult: status === 'settled', status }),
      'https://dailydraft.fun',
    );

    expect(metadata.description).toContain(copy);
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({
        url: new URL(`https://dailydraft.fun/duel/duel_social/social/${status}`),
      }),
    ]);
  });

  test('does not leak wallet or transaction identifiers into share metadata', () => {
    const publicReceipt = receipt({ status: 'opening' });
    publicReceipt.participants.creator.address = 'creator_sensitive_wallet_address';
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

    const metadata = JSON.stringify(buildDuelMetadata(publicReceipt));

    expect(metadata).not.toContain('creator_sensitive_wallet_address');
    expect(metadata).not.toContain('sensitive_signature');
  });
});

function receipt({
  mockResult = false,
  status,
}: {
  mockResult?: boolean;
  status: PublicDuelReceipt['duel']['status'];
}): PublicDuelReceipt {
  return {
    actions: {
      primary: { href: '/duel/duel_social', label: 'View' },
      rematch: null,
      share: { href: '/duel/duel_social', label: 'Share' },
    },
    availability: { complete: mockResult, missing: [] },
    cardActions: {
      availability: 'hidden',
      cards: [],
      reason: mockResult ? 'mock-assets' : 'duel-not-settled',
      receiptHref: '/v1/duels/duel_social/receipt',
      schemaVersion: 'dailydraft.card-actions.v1',
    },
    custody: {
      cardAssets: { detail: 'Test', status: 'pending' },
      platformFee: { asset: 'WSOL', escrowAddress: null, status: 'pending' },
    },
    duel: {
      createdAt: '2026-07-16T00:00:00.000Z',
      expiresAt: '2026-07-16T00:15:00.000Z',
      id: 'duel_social',
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
      provider: 'dailydraft',
      providerMode: mockResult ? 'mock' : 'dailydraft-devnet',
      providerPackId: null,
      tier: { amount: '50000000', currency: 'USDC', decimals: 6 },
    },
    participants: {
      creator: { address: 'creator', display: 'Creator', role: 'creator' },
      opponent: null,
    },
    privacy: { indexable: false, reason: 'test' },
    references: { provider: [], solana: [] },
    recovery: { alerts: [], status: 'none' },
    result: mockResult
      ? {
          comparisonMetric: 'insured-value',
          margin: { amount: '1000000', currency: 'USDC', decimals: 6 },
          outcomes: [
            {
              assetReference: 'creator_asset',
              displayName: 'Mock pull A',
              imageUrl: null,
              insuredValue: { amount: '51000000', currency: 'USDC', decimals: 6 },
              isMock: true,
              openedAt: '2026-07-16T00:01:00.000Z',
              poolVersion: 'mock-v1',
              resultHash: 'creator_hash',
              side: 'creator',
              sourceTimestamp: '2026-07-16T00:01:00.000Z',
              valuationSourceReference: null,
            },
            {
              assetReference: 'opponent_asset',
              displayName: 'Mock pull B',
              imageUrl: null,
              insuredValue: { amount: '50000000', currency: 'USDC', decimals: 6 },
              isMock: true,
              openedAt: '2026-07-16T00:01:00.000Z',
              poolVersion: 'mock-v1',
              resultHash: 'opponent_hash',
              side: 'opponent',
              sourceTimestamp: '2026-07-16T00:01:00.000Z',
              valuationSourceReference: null,
            },
          ],
          policy: {
            authoritativeField: 'insuredValue',
            currency: 'USDC',
            decimals: 6,
            hash: 'policy_hash',
            hashAlgorithm: 'sha256',
            maxSourceAgeSeconds: 60,
            maxValueMinorUnits: '1000000000',
            policyVersion: 'mock-v1',
            rounding: 'none',
            tieRule: 'return-original-assets-and-refund-platform-fees',
          },
          proof: {
            context: {
              creatorWallet: 'creator',
              duelId: 'duel_social',
              escrowAddress: 'escrow',
              network: 'solana-devnet',
              opponentWallet: 'opponent',
              providerMode: 'mock',
            },
            creatorResultHash: 'creator_hash',
            opponentResultHash: 'opponent_hash',
            poolVersion: 'mock-v1',
            providerAttestation: {
              required: false,
              scope: 'none',
              status: 'mock-not-applicable',
            },
            schemaVersion: 'dailydraft.result-proof.v1',
          },
          resultHash: 'result_hash',
          settlementReady: false,
          totalValue: { amount: '101000000', currency: 'USDC', decimals: 6 },
          valuationPolicyHash: 'policy_hash',
          winner: { address: 'creator', display: 'Creator', role: 'creator' },
          winnerSide: 'creator',
        }
      : null,
    schemaVersion: 'dailydraft.receipt.v1',
  };
}
