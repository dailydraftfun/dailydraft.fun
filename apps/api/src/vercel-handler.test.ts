import { describe, expect, test } from 'bun:test';

import { normalizeRequestUrl } from '../api/[...path].js';

describe('Vercel API request adapter', () => {
  test('removes the internal api function prefix after a rewrite', () => {
    expect(normalizeRequestUrl('/api/v1/health')).toBe('/v1/health');
    expect(normalizeRequestUrl('/api/v1/duels?limit=20')).toBe('/v1/duels?limit=20');
  });

  test('preserves a public v1 URL when Vercel retains the original path', () => {
    expect(normalizeRequestUrl('/v1/health')).toBe('/v1/health');
  });
});
