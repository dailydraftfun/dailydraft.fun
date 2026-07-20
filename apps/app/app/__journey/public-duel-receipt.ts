import type { PublicDuelReceipt, PublicDuelStatus } from '../duel/public-proof-client';

export const publicSurfaceStatuses = [
  'waiting',
  'opening',
  'settled',
  'cancelled',
  'refunded',
  'expired',
] as const satisfies readonly PublicDuelStatus[];

export const privateFixtureWallet = 'wallet_private_fixture_must_not_enter_metadata';
export const privateFixtureSignature = 'signature_private_fixture_must_not_enter_metadata';

const statusPattern = new RegExp(`^duel_public_(${publicSurfaceStatuses.join('|')})$`);

export function createPublicSurfaceReceipt(duelId: string): PublicDuelReceipt | null {
  const statusMatch = duelId.match(statusPattern);
  const status = statusMatch?.[1] as (typeof publicSurfaceStatuses)[number] | undefined;
  if (!status && !duelId.startsWith('duel_fixture_')) return null;

  return receipt(duelId, status ?? 'settled');
}

function receipt(
  duelId: string,
  status: (typeof publicSurfaceStatuses)[number],
): PublicDuelReceipt {
  const settled = status === 'settled';
  const waiting = status === 'waiting';
  return {
    actions: {
      primary: { href: `/duel/${duelId}`, label: 'View duel' },
      rematch: settled ? { href: '/overview?rematch=fixture', label: 'Run a rematch' } : null,
      share: { href: `/duel/${duelId}`, label: 'Share duel' },
    },
    availability: { complete: settled, missing: settled ? [] : ['finalized result'] },
    cardActions: {
      availability: 'hidden',
      cards: [],
      reason: settled ? 'ownership-pending' : 'duel-not-settled',
      receiptHref: `/v1/duels/${duelId}/receipt`,
      schemaVersion: 'openpacksduel.card-actions.v1',
    },
    custody: {
      cardAssets: {
        detail: settled
          ? 'Fixture assets await ownership reconciliation.'
          : 'No fixture assets moved.',
        status: 'pending',
      },
      platformFee: {
        asset: 'WSOL',
        escrowAddress: settled ? 'fixture_public_escrow' : null,
        status: settled ? 'settled' : 'pending',
      },
    },
    duel: {
      createdAt: '2026-07-20T08:00:00.000Z',
      expiresAt: '2099-01-01T00:15:00.000Z',
      id: duelId,
      mode: 'direct',
      network: 'solana-devnet',
      observedAt: '2026-07-20T08:01:00.000Z',
      status,
    },
    fees: {
      asset: 'WSOL',
      finalizedSides: settled ? 2 : 0,
      perSideAmountLamports: settled ? '10000000' : null,
      requiredSides: 2,
      totalFinalizedAmountLamports: settled ? '20000000' : null,
    },
    pack: {
      id: 'pokemon_50',
      name: 'Pokémon $50 Pack',
      provider: 'journey-fixture',
      providerMode: 'openpacksduel-devnet',
      providerPackId: 'fixture-pack-public-surfaces',
      tier: { amount: '50000000', currency: 'USDC', decimals: 6 },
    },
    participants: {
      creator: {
        address: privateFixtureWallet,
        display: 'Creator',
        role: 'creator',
      },
      opponent: waiting
        ? null
        : {
            address: 'opponent_private_fixture_must_not_enter_metadata',
            display: 'Opponent',
            role: 'opponent',
          },
    },
    privacy: {
      indexable: false,
      reason: 'Fixture receipts expose pseudonyms and public proof only.',
    },
    references: {
      provider: settled
        ? [
            {
              assetReference: 'fixture-asset-creator',
              provider: 'journey-fixture',
              providerReference: 'fixture-provider-reference',
              side: 'creator',
            },
          ]
        : [],
      solana: settled
        ? [
            {
              action: 'settle',
              bindingSource: 'api-submission',
              explorerUrl: `https://explorer.solana.com/tx/${privateFixtureSignature}?cluster=devnet`,
              finalizedAt: '2026-07-20T08:01:00.000Z',
              recoveredAt: null,
              signature: privateFixtureSignature,
              status: 'finalized',
            },
          ]
        : [],
    },
    recovery: { alerts: [], status: 'none' },
    result: settled
      ? {
          comparisonMetric: 'insured-value',
          margin: { amount: '31500000', currency: 'USDC', decimals: 6 },
          outcomes: [
            {
              assetReference: 'fixture-asset-creator',
              displayName: 'Charizard fixture pull',
              imageUrl: null,
              insuredValue: { amount: '72500000', currency: 'USDC', decimals: 6 },
              isMock: false,
              openedAt: '2026-07-20T08:00:30.000Z',
              poolVersion: 'fixture-pool-v1',
              resultHash: 'fixture-creator-result-hash',
              side: 'creator',
              sourceTimestamp: '2026-07-20T08:00:00.000Z',
              valuationSourceReference: 'fixture-valuation-creator',
            },
            {
              assetReference: 'fixture-asset-opponent',
              displayName: 'Blastoise fixture pull',
              imageUrl: null,
              insuredValue: { amount: '41000000', currency: 'USDC', decimals: 6 },
              isMock: false,
              openedAt: '2026-07-20T08:00:30.000Z',
              poolVersion: 'fixture-pool-v1',
              resultHash: 'fixture-opponent-result-hash',
              side: 'opponent',
              sourceTimestamp: '2026-07-20T08:00:00.000Z',
              valuationSourceReference: 'fixture-valuation-opponent',
            },
          ],
          policy: {
            authoritativeField: 'marketValue',
            currency: 'USDC',
            decimals: 6,
            hash: 'fixture-policy-hash',
            hashAlgorithm: 'sha256',
            maxSourceAgeSeconds: 3600,
            maxValueMinorUnits: '1000000000',
            policyVersion: 'fixture-policy-v1',
            rounding: 'none',
            tieRule: 'return-original-assets-and-refund-platform-fees',
          },
          proof: {
            context: {
              creatorWallet: privateFixtureWallet,
              duelId,
              escrowAddress: 'fixture_public_escrow',
              network: 'solana-devnet',
              opponentWallet: 'opponent_private_fixture_must_not_enter_metadata',
              providerMode: 'openpacksduel-devnet',
            },
            creatorResultHash: 'fixture-creator-result-hash',
            opponentResultHash: 'fixture-opponent-result-hash',
            poolVersion: 'fixture-pool-v1',
            providerAttestation: {
              required: true,
              scope: 'escrow-mints-values-policy',
              status: 'on-chain-commitment-finalized',
            },
            schemaVersion: 'openpacksduel.result-proof.v1',
          },
          resultHash: 'fixture-combined-result-hash',
          settlementReady: true,
          totalValue: { amount: '113500000', currency: 'USDC', decimals: 6 },
          valuationPolicyHash: 'fixture-policy-hash',
          winner: {
            address: privateFixtureWallet,
            display: 'Creator',
            role: 'creator',
          },
          winnerSide: 'creator',
        }
      : null,
    schemaVersion: 'openpacksduel.receipt.v1',
  };
}
