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
export const privateFixtureOpponentWallet = 'opponent_private_fixture_must_not_enter_metadata';
export const privateFixtureEscrowAddress = 'fixture_public_escrow';

const statusPattern = new RegExp(`^duel_public_(${publicSurfaceStatuses.join('|')})$`);

export function createPublicSurfaceReceipt(duelId: string): PublicDuelReceipt | null {
  const statusMatch = duelId.match(statusPattern);
  const status = statusMatch?.[1] as (typeof publicSurfaceStatuses)[number] | undefined;
  if (!status && !duelId.startsWith('duel_fixture_')) return null;

  const fixture = receipt(duelId, status ?? 'settled');
  if (duelId === 'duel_fixture_card_actions') {
    fixture.cardActions = availableCardActions(duelId, fixture);
  }
  if (duelId === 'duel_fixture_ownership_mismatch') {
    fixture.cardActions = {
      availability: 'hidden',
      cards: [],
      reason: 'ownership-mismatch',
      receiptHref: `/v1/duels/${duelId}/receipt`,
      schemaVersion: 'dailydraft.card-actions.v1',
    };
  }
  return fixture;
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
      rematch: settled ? { href: '/games/duel?rematch=fixture', label: 'Run a rematch' } : null,
      share: { href: `/duel/${duelId}`, label: 'Share duel' },
    },
    availability: { complete: settled, missing: settled ? [] : ['finalized result'] },
    cardActions: {
      availability: 'hidden',
      cards: [],
      reason: settled ? 'ownership-pending' : 'duel-not-settled',
      receiptHref: `/v1/duels/${duelId}/receipt`,
      schemaVersion: 'dailydraft.card-actions.v1',
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
        escrowAddress: settled ? privateFixtureEscrowAddress : null,
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
      providerMode: 'dailydraft-devnet',
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
            address: privateFixtureOpponentWallet,
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
              escrowAddress: privateFixtureEscrowAddress,
              network: 'solana-devnet',
              opponentWallet: privateFixtureOpponentWallet,
              providerMode: 'dailydraft-devnet',
            },
            creatorResultHash: 'fixture-creator-result-hash',
            opponentResultHash: 'fixture-opponent-result-hash',
            poolVersion: 'fixture-pool-v1',
            providerAttestation: {
              required: true,
              scope: 'escrow-mints-values-policy',
              status: 'on-chain-commitment-finalized',
            },
            schemaVersion: 'dailydraft.result-proof.v1',
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
    schemaVersion: 'dailydraft.receipt.v1',
  };
}

function availableCardActions(
  duelId: string,
  fixture: PublicDuelReceipt,
): PublicDuelReceipt['cardActions'] {
  const owner = fixture.participants.creator;
  const receiptHref = `/v1/duels/${duelId}/receipt`;
  const baseState = {
    duelId,
    imageUrl: null,
    owner,
    ownership: {
      basis: 'finalized-settlement-reference',
      settlementSignature: privateFixtureSignature,
      status: 'reconciled',
    },
    receiptHref,
    side: 'creator',
  } as const;

  return {
    availability: 'available',
    cards: [
      {
        ...baseState,
        actionStateId: `card-action:${duelId}:charizard`,
        actions: [
          cardAction('keep', 'available'),
          cardAction('list', 'available', {
            href: `/cards/${duelId}/charizard/list`,
            value: money('68000000'),
          }),
          cardAction('sell-back', 'expired', {
            expiresAt: '2026-07-23T10:00:00.000Z',
            reason: 'buyback-expired',
            value: money('61000000'),
          }),
          cardAction('redeem', 'unavailable', { reason: 'unsupported' }),
        ],
        assetReference: 'fixture-asset-creator',
        displayName: 'Charizard action card',
        insuredValue: money('72500000'),
        providerReference: 'fixture-provider-reference-charizard',
      },
      {
        ...baseState,
        actionStateId: `card-action:${duelId}:pikachu`,
        actions: [
          cardAction('keep', 'available'),
          cardAction('list', 'pending', { reason: 'ownership-pending' }),
          cardAction('sell-back', 'available', {
            href: `/cards/${duelId}/pikachu/sell-back`,
            value: money('25000000'),
          }),
          cardAction('redeem', 'unavailable', {
            reason: 'partner-onboarding-required',
          }),
        ],
        assetReference: 'fixture-asset-creator-bonus',
        displayName: 'Pikachu action card',
        insuredValue: money('28000000'),
        providerReference: 'fixture-provider-reference-pikachu',
      },
    ],
    reason: null,
    receiptHref,
    schemaVersion: 'dailydraft.card-actions.v1',
  };
}

function cardAction(
  action: PublicDuelReceipt['cardActions']['cards'][number]['actions'][number]['action'],
  availability: PublicDuelReceipt['cardActions']['cards'][number]['actions'][number]['availability'],
  overrides: Partial<PublicDuelReceipt['cardActions']['cards'][number]['actions'][number]> = {},
): PublicDuelReceipt['cardActions']['cards'][number]['actions'][number] {
  const capability = {
    keep: 'ownership-receipt',
    list: 'collector-crypt-marketplace-listing',
    redeem: 'collector-crypt-shipping',
    'sell-back': 'collector-crypt-buyback',
  } as const;
  const label = {
    keep: 'Keep card',
    list: 'List card',
    redeem: 'Redeem physical card',
    'sell-back': 'Sell back',
  } as const;

  return {
    action,
    alternative: action === 'keep' ? null : { action: 'keep', label: 'Keep card' },
    availability,
    capability: capability[action],
    detail: `${label[action]} capability evidence for this deterministic devnet receipt.`,
    label: label[action],
    reason: availability === 'available' ? null : 'partner-onboarding-required',
    requiresSignature: false,
    transaction: null,
    ...overrides,
  };
}

function money(amount: string) {
  return { amount, currency: 'USDC' as const, decimals: 6 as const };
}
