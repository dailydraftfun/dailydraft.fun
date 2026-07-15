import { describe, expect, test } from 'bun:test';

import { FixedWindowRateLimiter } from './rate-limit.js';

describe('FixedWindowRateLimiter', () => {
  test('limits each credential fingerprint and resets after the window', () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);

    expect(limiter.consume('credential-a', 1_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume('credential-a', 1_100)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume('credential-a', 1_200)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(limiter.consume('credential-b', 1_200).allowed).toBe(true);
    expect(limiter.consume('credential-a', 2_001)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });
});
