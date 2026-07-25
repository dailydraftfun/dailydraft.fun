import { afterEach, describe, expect, test } from 'bun:test';

import { isAllowedOrigin, McpCredentialStore, parseAllowedOrigins } from './http-auth.js';

const READ_TOKEN = 'read_token_123456789012345678901234567890';
const PREPARE_TOKEN = 'prepare_token_123456789012345678901234567890';

const originalKeys = process.env.DAILYDRAFT_MCP_KEYS;
const originalAllowedOrigins = process.env.DAILYDRAFT_MCP_ALLOWED_ORIGINS;

afterEach(() => {
  if (originalKeys === undefined) delete process.env.DAILYDRAFT_MCP_KEYS;
  else process.env.DAILYDRAFT_MCP_KEYS = originalKeys;
  if (originalAllowedOrigins === undefined) delete process.env.DAILYDRAFT_MCP_ALLOWED_ORIGINS;
  else process.env.DAILYDRAFT_MCP_ALLOWED_ORIGINS = originalAllowedOrigins;
});

describe('MCP HTTP authentication', () => {
  test('authenticates scoped bearer credentials without returning the token', () => {
    const store = new McpCredentialStore(
      JSON.stringify([
        { id: 'reader', scopes: ['read'], token: READ_TOKEN },
        { id: 'preparer', scopes: ['read', 'prepare'], token: PREPARE_TOKEN },
      ]),
    );

    const principal = store.authenticate(`Bearer ${PREPARE_TOKEN}`);

    expect(principal?.credentialId).toBe('preparer');
    expect(principal?.scopes.has('prepare')).toBe(true);
    expect(JSON.stringify(principal)).not.toContain(PREPARE_TOKEN);
    expect(store.authenticate(`Bearer ${READ_TOKEN}_wrong`)).toBeNull();
  });

  test('fails closed for missing or invalid credential configuration', () => {
    expect(new McpCredentialStore('').configured).toBe(false);
    expect(() => new McpCredentialStore('{bad-json')).toThrow('must be a JSON array');
    expect(
      () =>
        new McpCredentialStore(
          JSON.stringify([{ id: 'reader', scopes: ['prepare'], token: READ_TOKEN }]),
        ),
    ).toThrow('must include read scope');
  });

  test('accepts absent origins and exact allowlisted browser origins only', () => {
    const origins = parseAllowedOrigins('https://dailydraft.fun,http://localhost:3001');

    expect(isAllowedOrigin(undefined, origins)).toBe(true);
    expect(isAllowedOrigin('https://dailydraft.fun', origins)).toBe(true);
    expect(isAllowedOrigin('https://attacker.example', origins)).toBe(false);
    expect(() => parseAllowedOrigins('https://dailydraft.fun/path')).toThrow(
      'exact HTTP(S) origins',
    );
  });

  test('reads credentials from the environment when the caller passes nothing', () => {
    delete process.env.DAILYDRAFT_MCP_KEYS;

    expect(new McpCredentialStore().configured).toBe(false);

    process.env.DAILYDRAFT_MCP_KEYS = JSON.stringify([
      { id: 'reader', scopes: ['read'], token: READ_TOKEN },
    ]);
    const store = new McpCredentialStore();

    expect(store.configured).toBe(true);
    expect(store.authenticate(`Bearer ${READ_TOKEN}`)?.credentialId).toBe('reader');
  });

  test('rejects credential configuration that parses to something other than an array', () => {
    expect(() => new McpCredentialStore('{"id":"reader"}')).toThrow('must be a JSON array');
  });

  test('reads the browser origin allowlist from the environment by default', () => {
    delete process.env.DAILYDRAFT_MCP_ALLOWED_ORIGINS;

    expect(parseAllowedOrigins().size).toBe(0);

    process.env.DAILYDRAFT_MCP_ALLOWED_ORIGINS = 'https://dailydraft.fun';

    expect(isAllowedOrigin('https://dailydraft.fun', parseAllowedOrigins())).toBe(true);
  });
});
