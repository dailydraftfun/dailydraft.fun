import { describe, expect, test } from 'bun:test';
import Fastify from 'fastify';

import {
  type RequestBoundaryLog,
  registerRequestBoundary,
  resolveRequestBoundaryConfig,
  resolveRequestId,
} from './request-boundary';

describe('request boundary', () => {
  test('preserves one valid request id and replaces malformed input', () => {
    const valid = 'request-fixture-0001';
    expect(resolveRequestId(valid, () => 'generated')).toBe(valid);
    for (const malformed of ['', 'short', 'contains secret\nvalue', ['one', 'two']]) {
      expect(resolveRequestId(malformed as string | string[], () => 'generated')).toBe('generated');
    }
  });

  test('admits only explicit origins without reflecting a denied origin', async () => {
    const app = fixtureApp();
    try {
      const allowed = await app.inject({
        headers: { origin: 'https://app.example' },
        method: 'GET',
        url: '/fixture',
      });
      const denied = await app.inject({
        headers: { origin: 'https://attacker.example' },
        method: 'GET',
        url: '/fixture',
      });

      expect(allowed.statusCode).toBe(200);
      expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');
      expect(denied.statusCode).toBe(403);
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      expect(denied.json()).toMatchObject({
        detail: 'Origin is not allowed',
        status: 403,
      });
    } finally {
      await app.close();
    }
  });

  test('emits stable rate-limit response and redacted structured log evidence', async () => {
    const logs: RequestBoundaryLog[] = [];
    const app = fixtureApp({ log: (entry) => logs.push(entry), rateLimit: 2 });
    try {
      const first = await app.inject({
        headers: { authorization: 'Bearer top-secret', 'x-request-id': 'rate-fixture-0001' },
        url: '/fixture',
      });
      const second = await app.inject({ url: '/fixture' });
      const limited = await app.inject({ url: '/fixture' });

      expect(first.headers['x-request-id']).toBe('rate-fixture-0001');
      expect(first.headers['x-ratelimit-remaining']).toBe('1');
      expect(second.headers['x-ratelimit-remaining']).toBe('0');
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBe('60');
      expect(limited.json()).toMatchObject({
        detail: 'Request rate limit exceeded',
        status: 429,
      });
      expect(logs).toHaveLength(3);
      expect(logs[2]).toMatchObject({
        event: 'http_request_completed',
        rateLimit: { limit: 2, remaining: 0, resetSeconds: 60 },
        status: 429,
      });
      expect(JSON.stringify(logs)).not.toContain('top-secret');
      expect(JSON.stringify(logs)).not.toContain('authorization');
    } finally {
      await app.close();
    }
  });

  test('ignores forwarding from untrusted peers and rejects malformed trusted forwarding', async () => {
    const untrusted = fixtureApp({ trustedProxies: [] });
    const trusted = fixtureApp({ trustedProxies: ['127.0.0.1'] });
    try {
      const ignored = await untrusted.inject({
        headers: { 'x-forwarded-for': 'not-an-ip' },
        url: '/fixture',
      });
      const rejected = await trusted.inject({
        headers: { 'x-forwarded-for': 'not-an-ip' },
        url: '/fixture',
      });
      const accepted = await trusted.inject({
        headers: {
          'x-forwarded-for': '203.0.113.8',
          'x-forwarded-host': 'api.example',
          'x-forwarded-proto': 'https',
        },
        url: '/fixture',
      });

      expect(ignored.statusCode).toBe(200);
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toMatchObject({
        detail: 'Trusted proxy supplied malformed x-forwarded-for',
      });
      expect(accepted.statusCode).toBe(200);
    } finally {
      await Promise.all([untrusted.close(), trusted.close()]);
    }
  });

  test('keys production rate limits by the forwarded client behind one trusted proxy', async () => {
    const app = fixtureApp({ rateLimit: 1, trustedProxies: ['127.0.0.1'] });
    try {
      const firstClient = await app.inject({
        headers: { 'x-forwarded-for': '203.0.113.8' },
        url: '/fixture',
      });
      const secondClient = await app.inject({
        headers: { 'x-forwarded-for': '203.0.113.9' },
        url: '/fixture',
      });
      const repeatedClient = await app.inject({
        headers: { 'x-forwarded-for': '203.0.113.8' },
        url: '/fixture',
      });

      expect(firstClient.statusCode).toBe(200);
      expect(secondClient.statusCode).toBe(200);
      expect(repeatedClient.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  test('redacts query secrets from unmatched-route logs', async () => {
    const logs: RequestBoundaryLog[] = [];
    const app = fixtureApp({ log: (entry) => logs.push(entry) });
    try {
      const response = await app.inject({
        url: '/missing?token=top-secret#ignored',
      });

      expect(response.statusCode).toBe(404);
      expect(logs).toHaveLength(1);
      expect(logs[0]?.route).toBe('/missing');
      expect(JSON.stringify(logs)).not.toContain('top-secret');
      expect(JSON.stringify(logs)).not.toContain('token=');
    } finally {
      await app.close();
    }
  });

  test('validates bounded environment configuration', () => {
    expect(
      resolveRequestBoundaryConfig({
        CORS_ORIGINS: 'https://app.example,https://admin.example',
        DAILYDRAFT_RATE_LIMIT: '25',
        DAILYDRAFT_RATE_WINDOW_MS: '30000',
        DAILYDRAFT_TRUSTED_PROXIES: '127.0.0.1,::1',
      }),
    ).toEqual({
      allowedOrigins: ['https://admin.example', 'https://app.example'],
      rateLimit: 25,
      rateWindowMs: 30_000,
      trustedProxies: ['127.0.0.1', '::1'],
    });
    expect(() =>
      resolveRequestBoundaryConfig({ DAILYDRAFT_TRUSTED_PROXIES: '10.0.0.0/8' }),
    ).toThrow('literal IP addresses');
    expect(() => resolveRequestBoundaryConfig({ DAILYDRAFT_RATE_LIMIT: '0' })).toThrow(
      'between 1 and 10000',
    );
  });
});

function fixtureApp(
  overrides: {
    log?: (entry: RequestBoundaryLog) => void;
    rateLimit?: number;
    trustedProxies?: string[];
  } = {},
) {
  const config = resolveRequestBoundaryConfig({
    CORS_ORIGINS: 'https://app.example',
    DAILYDRAFT_RATE_LIMIT: String(overrides.rateLimit ?? 120),
    DAILYDRAFT_TRUSTED_PROXIES: overrides.trustedProxies?.join(','),
  });
  const app = Fastify({
    genReqId: (request) => resolveRequestId(request.headers['x-request-id']),
    trustProxy: config.trustedProxies.length > 0 ? [...config.trustedProxies] : false,
  });
  registerRequestBoundary(app, config, {
    ...(overrides.log ? { log: overrides.log } : {}),
    now: () => 1_000,
  });
  app.get('/fixture', () => ({ ok: true }));
  return app;
}
