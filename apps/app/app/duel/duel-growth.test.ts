import { describe, expect, test } from 'bun:test';

import { rematchLabel, resolveRematchOpponent, resultShareText, viewerResult } from './duel-growth';

const participants = {
  creator: { address: 'creator_wallet', label: 'Creator' },
  opponent: { address: 'opponent_wallet', label: 'Opponent' },
};

describe('duel growth actions', () => {
  test('targets the other original participant from either side of a rematch link', () => {
    expect(resolveRematchOpponent(participants, 'creator_wallet')).toEqual(participants.opponent);
    expect(resolveRematchOpponent(participants, 'opponent_wallet')).toEqual(participants.creator);
  });

  test('rejects rematch links for disconnected wallets and spectators', () => {
    expect(resolveRematchOpponent(participants, null)).toBeNull();
    expect(resolveRematchOpponent(participants, 'spectator_wallet')).toBeNull();
  });

  test('frames a loss as a revenge loop without pretending the viewer won', () => {
    const result = viewerResult('opponent');

    expect(rematchLabel(result)).toBe('Revenge rematch');
    expect(
      resultShareText({
        result,
        tier: '$50',
        winningPull: { name: 'Rival pull', value: '$72.50' },
      }),
    ).toBe('I lost a $50 Pack Duel to Rival pull at $72.50. Revenge is one click away.');
  });

  test('keeps winner and tie sharing truthful', () => {
    expect(
      resultShareText({
        result: viewerResult('you'),
        tier: '$50',
        winningPull: { name: 'Winner pull', value: '$80' },
      }),
    ).toBe('I won a $50 Pack Duel with Winner pull at $80.');
    expect(resultShareText({ result: viewerResult('tie'), tier: '$50', winningPull: null })).toBe(
      'My $50 Pack Duel ended in a tie. Run it back with me.',
    );
  });
});
