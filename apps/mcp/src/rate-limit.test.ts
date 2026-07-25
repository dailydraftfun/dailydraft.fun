import { afterEach, describe, expect, test } from 'bun:test';

import { FixedWindowRateLimiter } from './rate-limit.js';

const originalRateLimit = process.env.DAILYDRAFT_MCP_RATE_LIMIT;

afterEach(() => {
  if (originalRateLimit === undefined) delete process.env.DAILYDRAFT_MCP_RATE_LIMIT;
  else process.env.DAILYDRAFT_MCP_RATE_LIMIT = originalRateLimit;
});

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

  test('takes its default budget from the environment', () => {
    process.env.DAILYDRAFT_MCP_RATE_LIMIT = '120';

    expect(new FixedWindowRateLimiter().consume('credential-a', 0).limit).toBe(120);
  });

  test('refuses to start with a budget outside the supported range', () => {
    process.env.DAILYDRAFT_MCP_RATE_LIMIT = '0';

    expect(() => new FixedWindowRateLimiter()).toThrow(
      'DAILYDRAFT_MCP_RATE_LIMIT must be an integer between 1 and 10000',
    );
  });
});
