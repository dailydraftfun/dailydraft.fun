import { describe, expect, test } from 'bun:test';
import { buildRedirectTarget } from '../../overview/redirect-target';

describe('legacy flip route', () => {
  test('preserves query parameters when forwarding to canonical gacha', () => {
    expect(buildRedirectTarget('/games/gacha', { pack: '50', ref: ['one', 'two'] })).toBe(
      '/games/gacha?pack=50&ref=one&ref=two',
    );
  });
});
