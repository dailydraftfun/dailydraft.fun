import { describe, expect, test } from 'bun:test';
import type { IncomingMessage, ServerResponse } from 'node:http';

import configHandler from './config.js';

interface ResponseStub {
  body: string | undefined;
  headers: Record<string, string>;
  statusCode: number;
  end(chunk?: string): void;
  setHeader(name: string, value: string): void;
}

function createResponse(): ResponseStub {
  const headers: Record<string, string> = {};
  const stub: ResponseStub = {
    body: undefined,
    headers,
    statusCode: 0,
    end(chunk?: string) {
      stub.body = chunk;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  };
  return stub;
}

function call(overrides: { headers?: Record<string, string>; method?: string } = {}): ResponseStub {
  const request = {
    headers: overrides.headers ?? {},
    method: overrides.method ?? 'GET',
  } as unknown as IncomingMessage;
  const response = createResponse();
  configHandler(request, response as unknown as ServerResponse);
  return response;
}

function parseBody(response: ResponseStub): Record<string, unknown> {
  return JSON.parse(response.body ?? 'null') as Record<string, unknown>;
}

describe('MCP config endpoint', () => {
  test('publishes the rebranded client configuration', () => {
    const response = call({ headers: { host: 'mcp.dailydraft.fun' } });
    const body = parseBody(response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/json');
    expect(body.endpoint).toBe('https://mcp.dailydraft.fun/mcp');
    expect(body.name).toBe('dailydraft');
    expect(body.authentication).toMatchObject({
      tokenEnvironmentVariable: 'DAILYDRAFT_MCP_TOKEN',
      type: 'bearer',
    });
    expect(response.body).not.toContain('openpacksduel');
  });

  test('falls back to the canonical hosted origin when the request carries no host', () => {
    const body = parseBody(call());

    expect(body.endpoint).toBe('https://dailydraft-mcp.vercel.app/mcp');
  });

  test('prefers the forwarded host so proxied deployments advertise themselves', () => {
    const body = parseBody(
      call({ headers: { host: 'localhost:3002', 'x-forwarded-host': 'mcp.dailydraft.fun' } }),
    );

    expect(body.endpoint).toBe('https://mcp.dailydraft.fun/mcp');
  });

  test('answers anything but a read request with 405', () => {
    const response = call({ method: 'POST' });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('GET, HEAD');
  });
});
