import { describe, expect, test } from 'bun:test';
import { gameNavigationItems, isGameNavigationItemActive } from './game-navigation';

describe('games section navigation', () => {
  test('offers one canonical route for each live player surface', () => {
    expect(gameNavigationItems.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: '/games', label: 'Arena' },
      { href: '/games/duel', label: 'Duel' },
      { href: '/games/gacha', label: 'Pack Gacha' },
      { href: '/games/activity', label: 'Activity' },
    ]);
  });

  test('keeps the current game selected without claiming the arena root', () => {
    expect(isGameNavigationItemActive('/games', '/games')).toBe(true);
    expect(isGameNavigationItemActive('/games/duel/receipt', '/games/duel')).toBe(true);
    expect(isGameNavigationItemActive('/games/gacha', '/games/gacha')).toBe(true);
    expect(isGameNavigationItemActive('/games/flip', '/games/gacha')).toBe(true);
    expect(isGameNavigationItemActive('/games/crash', '/games')).toBe(false);
  });
});
