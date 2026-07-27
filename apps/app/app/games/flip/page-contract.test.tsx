import { describe, expect, test } from 'bun:test';
import { buildRedirectTarget } from '../../overview/redirect-target';
import LegacyFlipPage from './page';

describe('legacy flip route', () => {
  test('preserves query parameters when forwarding to canonical gacha', () => {
    expect(buildRedirectTarget('/games/gacha', { pack: '50', ref: ['one', 'two'] })).toBe(
      '/games/gacha?pack=50&ref=one&ref=two',
    );
  });

  test('executes the compatibility redirect boundary', async () => {
    await expect(
      LegacyFlipPage({ searchParams: Promise.resolve({ pack: '50' }) }),
    ).rejects.toThrow();
  });
});
