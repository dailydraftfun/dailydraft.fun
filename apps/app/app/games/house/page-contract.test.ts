import { describe, expect, test } from 'bun:test';
import { buildRedirectTarget } from '../../overview/redirect-target';

describe('legacy house route', () => {
  test('preserves attribution while forwarding into the unified Duel Arena', () => {
    expect(buildRedirectTarget('/games/duel', { ref: 'house-card' })).toBe(
      '/games/duel?ref=house-card',
    );
  });
});
