import { describe, expect, test } from 'bun:test';
import { buildRedirectTarget } from '../../overview/redirect-target';
import LegacyHousePage from './page';

describe('legacy house route', () => {
  test('preserves attribution while forwarding into the unified Duel Arena', () => {
    expect(buildRedirectTarget('/games/duel', { ref: 'house-card' })).toBe(
      '/games/duel?ref=house-card',
    );
  });

  test('executes the compatibility redirect boundary', async () => {
    await expect(
      LegacyHousePage({ searchParams: Promise.resolve({ ref: 'house-card' }) }),
    ).rejects.toThrow();
  });
});
