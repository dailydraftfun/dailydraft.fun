import { describe, expect, test } from 'bun:test';

import {
  isPublicGameTaxonomyId,
  PUBLIC_GAME_READINESS_STATES,
  PUBLIC_GAME_TAXONOMY,
  PUBLIC_GAME_TAXONOMY_BY_ID,
} from './public-game-taxonomy';

describe('public game taxonomy', () => {
  test('publishes one stable public lineup and readiness vocabulary', () => {
    expect(PUBLIC_GAME_TAXONOMY.map((mode) => mode.id)).toEqual(['duel', 'gacha', 'flip', 'crash']);
    expect(PUBLIC_GAME_TAXONOMY.map((mode) => mode.name)).toEqual([
      'Card Duel',
      'Sports Pack Gacha',
      'Marketplace Flip',
      'Card Streak',
    ]);
    expect(PUBLIC_GAME_READINESS_STATES).toEqual([
      'playable',
      'preview',
      'degraded',
      'unavailable',
    ]);
  });

  test('keeps canonical routes, rules anchors, and runtime ownership explicit', () => {
    expect(PUBLIC_GAME_TAXONOMY_BY_ID.duel).toMatchObject({
      canonicalHref: '/games/duel',
      rulesHref: '/games/duel#rules',
      runtime: true,
    });
    expect(PUBLIC_GAME_TAXONOMY_BY_ID.gacha).toMatchObject({
      canonicalHref: '/games/gacha',
      rulesHref: '/games/gacha',
      runtime: true,
    });
    expect(PUBLIC_GAME_TAXONOMY_BY_ID.flip).toMatchObject({
      canonicalHref: '/games/marketplace-flip',
      rulesHref: '/games/marketplace-flip#rules',
      runtime: false,
      statusLabel: 'Playable demo · no value',
    });
    expect(PUBLIC_GAME_TAXONOMY_BY_ID.crash).toMatchObject({
      canonicalHref: '/games/crash',
      rulesHref: '/games/crash#rules',
      runtime: false,
      statusLabel: 'Playable demo · no value',
    });
  });

  test('accepts only public hub identifiers', () => {
    expect(isPublicGameTaxonomyId('duel')).toBe(true);
    expect(isPublicGameTaxonomyId('flip')).toBe(true);
    expect(isPublicGameTaxonomyId('crash')).toBe(true);
    expect(isPublicGameTaxonomyId('gacha')).toBe(true);
    expect(isPublicGameTaxonomyId('house')).toBe(false);
  });
});
