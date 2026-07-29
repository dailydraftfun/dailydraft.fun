import { describe, expect, test } from 'bun:test';
import { createPracticeDuel } from './practice-duel';

describe('practice duel', () => {
  test('cycles through a player win, bot win, and tie without transaction claims', () => {
    const outcomes = [1, 2, 3].map((round) =>
      createPracticeDuel({
        now: new Date('2026-07-29T09:00:00.000Z'),
        round,
        tier: 50,
      }),
    );

    expect(outcomes.map((duel) => duel.result?.winnerSide)).toEqual(['creator', 'opponent', null]);
    for (const duel of outcomes) {
      expect(duel.providerMode).toBe('mock');
      expect(duel.houseOpponent).toBe(true);
      expect(duel.status).toBe('settled');
      expect(duel.transactionSignature).toBeNull();
      expect(duel.escrowAddress).toBeNull();
      expect(duel.result?.settlementReady).toBe(false);
      expect(duel.result?.outcomes.every((outcome) => outcome.isMock)).toBe(true);
    }
  });

  test('normalizes invalid rounds and preserves the selected practice tier', () => {
    const duel = createPracticeDuel({ round: -10, tier: 25 });

    expect(duel.id).toBe('practice_1');
    expect(duel.pack.price.amount).toBe('25000000');
    expect(duel.stake.amount).toBe('25000000');
  });
});
