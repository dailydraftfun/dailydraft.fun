import { afterEach, describe, expect, test } from 'bun:test';
import type { IncomingMessage, ServerResponse } from 'node:http';

import healthHandler from './health.js';

interface ResponseStub {
  body: string | undefined;
  headers: Record<string, string>;
  statusCode: number;
  end(chunk?: string): void;
  setHeader(name: string, value: string): void;
}

const originalKeys = process.env.DAILYDRAFT_MCP_KEYS;
const originalApiUrl = process.env.DAILYDRAFT_API_URL;

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

function call(method = 'GET'): ResponseStub {
  const request = { headers: {}, method } as unknown as IncomingMessage;
  const response = createResponse();
  healthHandler(request, response as unknown as ServerResponse);
  return response;
}

function parseBody(response: ResponseStub): Record<string, unknown> {
  return JSON.parse(response.body ?? 'null') as Record<string, unknown>;
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('DAILYDRAFT_MCP_KEYS', originalKeys);
  restore('DAILYDRAFT_API_URL', originalApiUrl);
});

describe('MCP health endpoint', () => {
  test('reports ready once credentials and the upstream API are both configured', () => {
    process.env.DAILYDRAFT_MCP_KEYS = '[]';
    process.env.DAILYDRAFT_API_URL = 'https://api.dailydraft.fun/v1';

    const response = call();
    const body = parseBody(response);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      authenticationConfigured: true,
      service: 'dailydraft-mcp',
      status: 'ready',
      upstreamApiConfigured: true,
    });
  });

  test('fails closed while either half of the configuration is missing', () => {
    process.env.DAILYDRAFT_API_URL = 'https://api.dailydraft.fun/v1';
    delete process.env.DAILYDRAFT_MCP_KEYS;

    const missingKeys = call();

    expect(missingKeys.statusCode).toBe(503);
    expect(parseBody(missingKeys)).toMatchObject({
      authenticationConfigured: false,
      status: 'unavailable',
      upstreamApiConfigured: true,
    });

    process.env.DAILYDRAFT_MCP_KEYS = '[]';
    process.env.DAILYDRAFT_API_URL = '   ';

    const blankUrl = call();

    expect(blankUrl.statusCode).toBe(503);
    expect(parseBody(blankUrl)).toMatchObject({ upstreamApiConfigured: false });
  });

  test('answers anything but a read request with 405', () => {
    const response = call('POST');

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('GET, HEAD');
  });
});
