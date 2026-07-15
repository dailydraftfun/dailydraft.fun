import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';

import { dispatchAndWaitForResponse, normalizeRequestUrl } from '../api/[...path].js';

describe('Vercel API request adapter', () => {
  test('removes the internal api function prefix after a rewrite', () => {
    expect(normalizeRequestUrl('/api/v1/health')).toBe('/v1/health');
    expect(normalizeRequestUrl('/api/v1/duels?limit=20')).toBe('/v1/duels?limit=20');
  });

  test('preserves a public v1 URL when Vercel retains the original path', () => {
    expect(normalizeRequestUrl('/v1/health')).toBe('/v1/health');
  });

  test('keeps the invocation open until the Fastify response finishes', async () => {
    const response = createResponse();
    let completed = false;
    const invocation = dispatchAndWaitForResponse(
      response as unknown as ServerResponse,
      () => true,
    ).then(() => {
      completed = true;
    });

    await Promise.resolve();
    expect(completed).toBe(false);
    response.writableFinished = true;
    response.emit('finish');
    await invocation;
    expect(completed).toBe(true);
  });

  test('rejects when the client disconnects before response completion', async () => {
    const response = createResponse();
    const invocation = dispatchAndWaitForResponse(
      response as unknown as ServerResponse,
      () => true,
    );

    response.emit('close');

    await expect(invocation).rejects.toThrow('Client disconnected');
  });
});

function createResponse(): EventEmitter & { writableFinished: boolean } {
  const response = new EventEmitter() as EventEmitter & { writableFinished: boolean };
  response.writableFinished = false;
  return response;
}
