import { describe, expect, test } from 'bun:test';

import type { Duel } from '../domain.js';
import { buildPublicDuelLeaderboard } from './public-duel-leaderboard.js';

const ALPHA = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const BRAVO = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
const CHARLIE = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const HOUSE = '7YWHMfk9JZe0LMdzHpYvCWHrGkpmQXJVhqBYoZ9UwNKq';

describe('public duel leaderboard', () => {
  test('ranks real settled players by wins, value, completed duels, and recency', () => {
    const leaderboard = buildPublicDuelLeaderboard(
      [
        duel({
          creator: ALPHA,
          opponent: BRAVO,
          totalValue: '100000000',
          updatedAt: '2026-07-20T02:00:00.000Z',
          winner: ALPHA,
        }),
        duel({
          creator: BRAVO,
          opponent: CHARLIE,
          totalValue: '250000000',
          updatedAt: '2026-07-20T03:00:00.000Z',
          winner: BRAVO,
        }),
        duel({
          creator: ALPHA,
          opponent: CHARLIE,
          totalValue: '50000000',
          updatedAt: '2026-07-20T04:00:00.000Z',
          winner: ALPHA,
        }),
      ],
      false,
      5_000,
      50,
      HOUSE,
    );

    expect(leaderboard.entries.map((entry) => entry.display)).toEqual([
      '9xQe…9gJ1',
      'DeWQ…12Eu',
      'Gk8Z…MQyW',
    ]);
    expect(leaderboard.entries[0]).toEqual(
      expect.objectContaining({
        profileHref: `/profile/${ALPHA}`,
        rank: 1,
        record: { completed: 2, losses: 0, ties: 0, wins: 2 },
        totalWonValue: { amount: '150000000', currency: 'USDC', decimals: 6 },
      }),
    );
    expect(leaderboard.methodology).toEqual(
      expect.objectContaining({
        excludesMockResults: true,
        hasMoreSettledDuels: false,
        sampledSettledDuels: 3,
      }),
    );
  });

  test('records ties and excludes house wallets from player ranking', () => {
    const leaderboard = buildPublicDuelLeaderboard(
      [
        duel({ creator: ALPHA, opponent: BRAVO, winner: null }),
        duel({ creator: CHARLIE, opponent: HOUSE, winner: HOUSE }),
      ],
      false,
      5_000,
      50,
      HOUSE,
    );

    expect(leaderboard.entries.map((entry) => entry.profileHref)).not.toContain(
      `/profile/${HOUSE}`,
    );
    expect(leaderboard.entries.find((entry) => entry.profileHref.endsWith(ALPHA))?.record).toEqual({
      completed: 1,
      losses: 0,
      ties: 1,
      wins: 0,
    });
    expect(
      leaderboard.entries.find((entry) => entry.profileHref.endsWith(CHARLIE))?.record,
    ).toEqual({
      completed: 1,
      losses: 1,
      ties: 0,
      wins: 0,
    });
  });

  test('never promotes mock or incomplete results into competitive standings', () => {
    const mock = duel({ creator: ALPHA, opponent: BRAVO, winner: ALPHA });
    if (!mock.result) throw new Error('Leaderboard fixture requires a result');
    const leaderboard = buildPublicDuelLeaderboard(
      [
        { ...mock, providerMode: 'mock' },
        { ...mock, id: 'duel_mock_outcome', result: { ...mock.result, outcomes: [] } },
        { ...mock, id: 'duel_incomplete', result: null },
      ],
      true,
      5_000,
      50,
      HOUSE,
    );

    expect(leaderboard.entries).toEqual([]);
    expect(leaderboard.methodology).toEqual(
      expect.objectContaining({
        hasMoreSettledDuels: true,
        sampledSettledDuels: 0,
      }),
    );
  });

  test('applies a deterministic public entry limit', () => {
    const leaderboard = buildPublicDuelLeaderboard(
      [
        duel({ creator: ALPHA, opponent: BRAVO, winner: ALPHA }),
        duel({ creator: CHARLIE, opponent: BRAVO, winner: CHARLIE }),
      ],
      false,
      5_000,
      1,
      HOUSE,
    );

    expect(leaderboard.entries).toHaveLength(1);
    expect(leaderboard.entries[0]?.rank).toBe(1);
  });

  test('applies every deterministic ranking tiebreak in order', () => {
    const valueOrder = rankedDisplays([
      duel({ creator: ALPHA, opponent: HOUSE, totalValue: '100000000', winner: ALPHA }),
      duel({ creator: BRAVO, opponent: HOUSE, totalValue: '200000000', winner: BRAVO }),
    ]);
    expect(valueOrder).toEqual(['DeWQ…12Eu', '9xQe…9gJ1']);

    const completedOrder = rankedDisplays([
      duel({ creator: ALPHA, opponent: HOUSE, winner: ALPHA }),
      duel({ creator: BRAVO, opponent: HOUSE, winner: BRAVO }),
      duel({
        creator: BRAVO,
        opponent: HOUSE,
        updatedAt: '2026-07-20T02:00:00.000Z',
        winner: HOUSE,
      }),
    ]);
    expect(completedOrder).toEqual(['DeWQ…12Eu', '9xQe…9gJ1']);

    const recencyOrder = rankedDisplays([
      duel({
        creator: ALPHA,
        opponent: HOUSE,
        updatedAt: '2026-07-20T01:00:00.000Z',
        winner: ALPHA,
      }),
      duel({
        creator: BRAVO,
        opponent: HOUSE,
        updatedAt: '2026-07-20T02:00:00.000Z',
        winner: BRAVO,
      }),
    ]);
    expect(recencyOrder).toEqual(['DeWQ…12Eu', '9xQe…9gJ1']);

    const walletOrder = rankedDisplays([
      duel({ creator: BRAVO, opponent: HOUSE, winner: BRAVO }),
      duel({ creator: ALPHA, opponent: HOUSE, winner: ALPHA }),
    ]);
    expect(walletOrder).toEqual(['9xQe…9gJ1', 'DeWQ…12Eu']);
  });
});

function rankedDisplays(duels: Duel[]): string[] {
  return buildPublicDuelLeaderboard(duels, false, 5_000, 50, HOUSE).entries.map(
    (entry) => entry.display,
  );
}

function duel({
  creator,
  houseOpponent = false,
  opponent,
  totalValue = '100000000',
  updatedAt = '2026-07-20T01:00:00.000Z',
  winner,
}: {
  creator: string;
  houseOpponent?: boolean;
  opponent: string;
  totalValue?: string;
  updatedAt?: string;
  winner: string | null;
}): Duel {
  const firstValue = (BigInt(totalValue) / 2n).toString();
  const secondValue = (BigInt(totalValue) - BigInt(firstValue)).toString();
  return {
    createdAt: updatedAt,
    creatorWallet: creator,
    environment: 'solana-devnet',
    expiresAt: updatedAt,
    houseOpponent,
    id: `duel_${creator.slice(0, 6)}_${opponent.slice(0, 6)}_${updatedAt.slice(11, 13)}`,
    matchmakingMode: houseOpponent ? 'house' : 'direct',
    opponentWallet: opponent,
    pack: {
      active: true,
      id: 'pokemon_50',
      name: 'Pokémon $50 Pack',
      price: { amount: '50000000', currency: 'USDC', decimals: 6 },
      provider: 'openpacksduel',
      providerPackId: 'pokemon_50',
      valuationPolicyHash: 'policy_hash',
    },
    providerMode: 'openpacksduel-devnet',
    result: {
      comparisonMetric: 'insured-value',
      outcomes: [outcome('creator', firstValue), outcome('opponent', secondValue)],
      resultHash: 'result_hash',
      settlementReady: true,
      tieRule: 'return-original-assets-and-refund-platform-fees',
      valuationPolicyHash: 'policy_hash',
      winnerSide: winner === null ? null : winner === creator ? 'creator' : 'opponent',
    },
    settledAt: updatedAt,
    stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
    status: 'settled',
    updatedAt,
    version: 1,
    winnerWallet: winner,
  };
}

function outcome(side: 'creator' | 'opponent', amount: string) {
  return {
    assetReference: `${side}_asset`,
    displayName: `${side} pull`,
    insuredValue: { amount, currency: 'USDC' as const, decimals: 6 as const },
    isMock: false,
    openedAt: '2026-07-20T00:00:00.000Z',
    provider: 'openpacksduel',
    providerReference: `${side}_provider`,
    poolVersion: 'pool-v1',
    resultHash: `${side}_hash`,
    side,
    sourceTimestamp: '2026-07-20T00:00:00.000Z',
    valuationSourceReference: `${side}_source`,
  };
}
