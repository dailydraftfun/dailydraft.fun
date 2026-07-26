import { describe, expect, test } from 'bun:test';
import type { PullRarity } from '@dailydraft/contracts';

import type { DurableDuel } from '../solana/duel-client';
import { prohibitedPrimaryUiTerms } from './duel-player-copy';
import { toLiveDuelState } from './live-duel-state';

describe('live duel state', () => {
  test('does not invent a reveal before the API commits both outcomes', () => {
    const state = toLiveDuelState(duel({ status: 'opening', result: null }), 'creator');

    expect(state.phase).toBe('opening');
    expect(state.left).toBeNull();
    expect(state.right).toBeNull();
    expect(state.totalValue).toBeNull();
    expect(state.winner).toBeNull();
  });

  test('orients the real outcomes and winner to the connected wallet', () => {
    const state = toLiveDuelState(duel({ status: 'settled' }), 'opponent');

    expect(state.phase).toBe('result');
    expect(state.left?.name).toBe('Opponent receipt pull');
    expect(state.right?.name).toBe('Creator receipt pull');
    expect(state.winner).toBe('you');
    expect(state.margin).toBe('$25');
    expect(state.totalValue).toBe('$115');
  });

  test('carries the committed card art into the reveal instead of dropping it', () => {
    const state = toLiveDuelState(duel({ status: 'settled' }), 'creator');

    expect(state.left?.image).toBe('https://images.pokemontcg.io/creator_asset_reference.png');
    expect(state.right?.image).toBe('https://images.pokemontcg.io/opponent_asset_reference.png');
  });

  test('leaves image unset for an outcome the provider has no art for', () => {
    const withoutArt = duel({ status: 'settled' });
    const result = withoutArt.result;
    if (!result) throw new Error('expected a committed result');
    const state = toLiveDuelState(
      {
        ...withoutArt,
        result: {
          ...result,
          outcomes: result.outcomes.map((entry) => ({ ...entry, imageUrl: null })),
        },
      },
      'creator',
    );

    expect(state.left?.image).toBeUndefined();
    expect(state.left?.name).toBe('Creator receipt pull');
  });

  test('presents the rarity the API committed rather than re-deriving it from value', () => {
    const settled = duel({ status: 'settled' });
    const result = settled.result;
    if (!result) throw new Error('expected a committed result');
    // Deliberately contradicts what the value alone implies ($45 and $70 would
    // derive to uncommon and rare): only a wire read can produce these.
    const state = toLiveDuelState(
      {
        ...settled,
        result: {
          ...result,
          outcomes: [
            { ...result.outcomes[0], rarity: 'chase' },
            { ...result.outcomes[1], rarity: 'common' },
          ] as typeof result.outcomes,
        },
      },
      'creator',
    );

    expect(state.left?.rarity).toBe('chase');
    expect(state.right?.rarity).toBe('common');
  });

  test('keeps a settled duel without proof data out of the result UI', () => {
    const state = toLiveDuelState(duel({ status: 'settled', result: null }), 'creator');

    expect(state.phase).toBe('lobby');
    expect(state.headline).toBe('Duel complete');
  });

  test('keeps raw lifecycle labels and prohibited jargon out of the arena', () => {
    const statuses: DurableDuel['status'][] = [
      'waiting',
      'matched',
      'committing',
      'funded',
      'opening',
      'awaiting_assets',
      'settling',
      'settled',
      'cancelling',
      'cancelled',
      'refunding',
      'refunded',
      'failed',
    ];
    const renderedCopy = statuses
      .flatMap((status) => {
        const state = toLiveDuelState(duel({ status, result: null }), 'creator');
        return [state.headline, state.indicator];
      })
      .join(' ')
      .toLowerCase();

    expect(renderedCopy).not.toContain('_');
    for (const term of prohibitedPrimaryUiTerms) {
      expect(renderedCopy).not.toContain(term);
    }
  });
});

function duel({
  result,
  status,
}: {
  result?: DurableDuel['result'];
  status: DurableDuel['status'];
}): DurableDuel {
  return {
    createdAt: '2026-07-16T00:00:00.000Z',
    creatorWallet: 'creator',
    environment: 'solana-devnet',
    escrowAddress: 'escrow_reference',
    expiresAt: '2026-07-16T00:15:00.000Z',
    houseOpponent: false,
    id: 'duel_truth',
    matchmakingMode: 'direct',
    opponentWallet: 'opponent',
    pack: {
      id: 'pokemon_50',
      name: 'Pokemon $50',
      price: { amount: '50000000', currency: 'USDC', decimals: 6 },
      provider: 'dailydraft',
    },
    providerMode: 'dailydraft-devnet',
    result:
      result === null
        ? null
        : {
            comparisonMetric: 'insured-value',
            outcomes: [
              outcome('creator', 'Creator receipt pull', '45000000', 'uncommon'),
              outcome('opponent', 'Opponent receipt pull', '70000000', 'rare'),
            ],
            resultHash: 'result_hash',
            settlementReady: true,
            valuationPolicyHash: 'policy_hash',
            winnerSide: 'opponent',
          },
    stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
    status,
    transactionSignature: null,
    version: 1,
    winnerWallet: status === 'settled' ? 'opponent' : null,
  };
}

function outcome(
  side: 'creator' | 'opponent',
  displayName: string,
  amount: string,
  rarity: PullRarity,
): NonNullable<DurableDuel['result']>['outcomes'][number] {
  return {
    assetReference: `${side}_asset_reference`,
    displayName,
    imageUrl: `https://images.pokemontcg.io/${side}_asset_reference.png`,
    insuredValue: { amount, currency: 'USDC', decimals: 6 },
    isMock: false,
    provider: 'dailydraft',
    providerReference: `${side}_provider_reference`,
    rarity,
    side,
  };
}
