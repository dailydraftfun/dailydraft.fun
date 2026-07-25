import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';

import type { FantasyPosition } from './fantasy-domain.js';
import type { MatchDataRequest } from './match-data-oracle.js';
import { MockMatchDataOracle } from './mock-match-data-oracle.js';

const ORIGINAL_NETWORK = process.env.DAILYDRAFT_NETWORK;

afterEach(() => {
  if (ORIGINAL_NETWORK === undefined) delete process.env.DAILYDRAFT_NETWORK;
  else process.env.DAILYDRAFT_NETWORK = ORIGINAL_NETWORK;
  setSystemTime();
});

describe('MockMatchDataOracle', () => {
  test('returns a deterministic finalized lineup for every supported position', async () => {
    delete process.env.DAILYDRAFT_NETWORK;
    setSystemTime(new Date('2026-07-24T12:30:00.000Z'));
    const oracle = new MockMatchDataOracle();
    const request = { matchReference: 'fixture-match-001', sport: 'SOCCER' } as const;

    const first = await oracle.getMatchResult(request);
    const second = await oracle.getMatchResult(request);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      matchReference: request.matchReference,
      observedAt: '2026-07-24T12:30:00.000Z',
      sport: 'SOCCER',
      status: 'final',
    });
    expect(first.providerReference).toMatch(/^dailydraft\.mock-match-data\.v1:[a-f0-9]{32}:11$/);
    expect(first.players).toHaveLength(11);

    const expectedKeys: Record<FantasyPosition, string[]> = {
      DEFENDER: ['cleanSheet', 'goals', 'interceptions', 'minutesPlayed', 'tackles'],
      FORWARD: ['assists', 'goals', 'minutesPlayed', 'shotsOnTarget'],
      GOALKEEPER: ['cleanSheet', 'goalsConceded', 'minutesPlayed', 'saves'],
      MIDFIELDER: ['assists', 'goals', 'keyPasses', 'minutesPlayed', 'tackles'],
    };
    const expectedCounts: Record<FantasyPosition, number> = {
      DEFENDER: 4,
      FORWARD: 3,
      GOALKEEPER: 1,
      MIDFIELDER: 3,
    };

    for (const [position, expectedCount] of Object.entries(expectedCounts)) {
      const players = first.players.filter((player) => player.position === position);
      expect(players).toHaveLength(expectedCount);
      const representative = players[0];
      if (!representative) throw new Error(`Expected a ${position} fixture player`);
      expect(Object.keys(representative.statLine).sort()).toEqual(
        expectedKeys[position as FantasyPosition],
      );
      expect(representative.playerReference).toMatch(/^mock_player_[a-f0-9]{40}$/);
    }
  });

  test('allows explicit devnet and rejects non-devnet execution', async () => {
    const oracle = new MockMatchDataOracle();
    process.env.DAILYDRAFT_NETWORK = 'solana-devnet';
    await expect(
      oracle.getMatchResult({ matchReference: 'fixture-match-002', sport: 'FOOTBALL' }),
    ).resolves.toMatchObject({ sport: 'FOOTBALL' });

    process.env.DAILYDRAFT_NETWORK = 'solana-mainnet';
    await expect(
      oracle.getMatchResult({ matchReference: 'fixture-match-002', sport: 'FOOTBALL' }),
    ).rejects.toThrow('devnet-only');
  });

  test('rejects unknown sports and missing match references', async () => {
    process.env.DAILYDRAFT_NETWORK = 'solana-devnet';
    const oracle = new MockMatchDataOracle();

    await expect(
      oracle.getMatchResult({
        matchReference: 'fixture-match-003',
        sport: 'HOCKEY',
      } as unknown as MatchDataRequest),
    ).rejects.toThrow('known fantasy sport');
    await expect(oracle.getMatchResult({ matchReference: '', sport: 'SOCCER' })).rejects.toThrow(
      'requires a match reference',
    );
    await expect(
      oracle.getMatchResult({
        matchReference: 42,
        sport: 'SOCCER',
      } as unknown as MatchDataRequest),
    ).rejects.toThrow('requires a match reference');
  });
});
