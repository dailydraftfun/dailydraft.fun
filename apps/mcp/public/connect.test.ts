import { describe, expect, test } from 'bun:test';

// connect.js is a browser bundle that does all of its work at module scope, so the
// browser surface it touches has to exist before the import and be torn down right
// after it — bun test runs without a DOM.
const originalFetch = globalThis.fetch;

Reflect.set(globalThis, 'window', { location: { origin: 'https://mcp.dailydraft.fun' } });
Reflect.set(globalThis, 'document', {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
});
Reflect.set(globalThis, 'fetch', async () => Response.json({ status: 'ready' }));

await import('./connect.js');

Reflect.set(globalThis, 'fetch', originalFetch);
Reflect.deleteProperty(globalThis, 'document');
Reflect.deleteProperty(globalThis, 'window');

const source = await Bun.file(new URL('./connect.js', import.meta.url)).text();

describe('hosted MCP connect script', () => {
  test('rewrites the canonical endpoint to whichever host is serving the page', () => {
    expect(source).toContain("const canonicalEndpoint = 'https://dailydraft-mcp.vercel.app/mcp';");
    expect(source).toContain('`${window.location.origin}/mcp`');
  });

  test('carries no trace of the retired brand', () => {
    expect(source).not.toContain('openpacksduel');
    expect(source).not.toContain('opd_');
  });
});
