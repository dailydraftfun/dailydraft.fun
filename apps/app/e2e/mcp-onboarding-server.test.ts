import { describe, expect, test } from 'bun:test';

import { mcpOnboardingFetch, startMcpOnboardingServer } from './mcp-onboarding-server';

describe('MCP onboarding fixture server', () => {
  test('reports its deterministic readiness contract', async () => {
    const response = mcpOnboardingFetch(new Request('http://127.0.0.1:3004/health'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticationConfigured: true,
      status: 'ready',
      upstreamApiConfigured: true,
    });
  });

  test('serves public onboarding assets with defensive headers', async () => {
    const response = mcpOnboardingFetch(new Request('http://127.0.0.1:3004/robots.txt'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toContain('User-agent');
  });

  test('rejects paths outside the public asset allowlist', async () => {
    const response = mcpOnboardingFetch(new Request('http://127.0.0.1:3004/private'));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  });

  test('starts on an ephemeral port when embedded by the journey harness', () => {
    const server = startMcpOnboardingServer(0);

    expect(server.hostname).toBe('127.0.0.1');
    expect(server.port).toBeGreaterThan(0);
    server.stop(true);
  });
});
