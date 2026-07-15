import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { OpenPacksApiClient } from './api-client.js';
import { createMcpHttpHandler } from './http.js';
import { McpCredentialStore } from './http-auth.js';
import { FixedWindowRateLimiter } from './rate-limit.js';

const TOKEN = 'http_test_123456789012345678901234567890';
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe('MCP Streamable HTTP transport', () => {
  test('requires bearer authentication before protocol handling', async () => {
    const url = await listen();
    const response = await fetch(url, {
      body: JSON.stringify(initializeRequest()),
      headers: protocolHeaders(),
      method: 'POST',
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  });

  test('rejects an untrusted browser origin', async () => {
    const url = await listen();
    const response = await fetch(url, {
      body: JSON.stringify(initializeRequest()),
      headers: {
        ...protocolHeaders(),
        authorization: `Bearer ${TOKEN}`,
        origin: 'https://evil.test',
      },
      method: 'POST',
    });

    expect(response.status).toBe(403);
  });

  test('initializes an authenticated stateless Streamable HTTP connection', async () => {
    const url = await listen();
    const response = await fetch(url, {
      body: JSON.stringify(initializeRequest()),
      headers: { ...protocolHeaders(), authorization: `Bearer ${TOKEN}` },
      method: 'POST',
    });
    const body = (await response.json()) as {
      jsonrpc: string;
      result?: { serverInfo?: { name?: string } };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('mcp-session-id')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(body.jsonrpc).toBe('2.0');
    expect(body.result?.serverInfo?.name).toBe('openpacksduel');
  });

  test('accepts a platform-preparsed JSON body', async () => {
    const url = await listen({ preparseBody: true });
    const response = await fetch(url, {
      body: JSON.stringify(initializeRequest()),
      headers: { ...protocolHeaders(), authorization: `Bearer ${TOKEN}` },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { serverInfo: { name: 'openpacksduel' } },
    });
  });

  test('rejects GET and DELETE explicitly in stateless mode', async () => {
    const url = await listen();
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${TOKEN}` },
        method,
      });

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST, OPTIONS');
    }
  });

  test('delegates content type, body, and protocol validation to the MCP transport', async () => {
    const url = await listen();
    const commonHeaders = { authorization: `Bearer ${TOKEN}`, ...protocolHeaders() };

    const wrongContentType = await fetch(url, {
      body: JSON.stringify(initializeRequest()),
      headers: { ...commonHeaders, 'content-type': 'text/plain' },
      method: 'POST',
    });
    expect(wrongContentType.status).toBe(415);

    const malformedBody = await fetch(url, {
      body: '{not-json',
      headers: commonHeaders,
      method: 'POST',
    });
    expect(malformedBody.status).toBe(400);
    expect(await malformedBody.json()).toMatchObject({ error: { code: -32700 } });

    const unsupportedProtocol = await fetch(url, {
      body: JSON.stringify({ id: 2, jsonrpc: '2.0', method: 'tools/list', params: {} }),
      headers: { ...commonHeaders, 'mcp-protocol-version': '2099-01-01' },
      method: 'POST',
    });
    expect(unsupportedProtocol.status).toBe(400);
    expect(await unsupportedProtocol.json()).toMatchObject({
      error: { message: expect.stringContaining('Unsupported protocol version') },
    });
  });
});

async function listen(options: { preparseBody?: boolean } = {}): Promise<string> {
  const handler = createMcpHttpHandler({
    allowedOrigins: new Set(['https://openpacksduel.vercel.app']),
    apiClientFactory: () =>
      new OpenPacksApiClient({
        baseUrl: 'https://api.example.test/v1',
        fetch: async () =>
          Response.json({ detail: 'Unexpected upstream request' }, { status: 500 }),
      }),
    credentialStore: new McpCredentialStore(
      JSON.stringify([{ id: 'test', scopes: ['read', 'prepare'], token: TOKEN }]),
    ),
    rateLimiter: new FixedWindowRateLimiter(10),
  });
  const server = createServer(async (request, response) => {
    if (options.preparseBody) {
      Reflect.set(request, 'body', JSON.parse(await readRequestBody(request)));
    }
    await handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port');
  return `http://127.0.0.1:${address.port}/mcp`;
}

async function readRequestBody(request: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function initializeRequest() {
  return {
    id: 1,
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {},
      clientInfo: { name: 'openpacksduel-test', version: '1.0.0' },
      protocolVersion: '2025-06-18',
    },
  };
}

function protocolHeaders(): Record<string, string> {
  return {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': '2025-06-18',
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
