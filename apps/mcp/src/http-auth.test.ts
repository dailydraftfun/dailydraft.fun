import { describe, expect, test } from 'bun:test';

import { isAllowedOrigin, McpCredentialStore, parseAllowedOrigins } from './http-auth.js';

const READ_TOKEN = 'read_token_123456789012345678901234567890';
const PREPARE_TOKEN = 'prepare_token_123456789012345678901234567890';

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
    const origins = parseAllowedOrigins('https://openpacksduel.vercel.app,http://localhost:3001');

    expect(isAllowedOrigin(undefined, origins)).toBe(true);
    expect(isAllowedOrigin('https://openpacksduel.vercel.app', origins)).toBe(true);
    expect(isAllowedOrigin('https://attacker.example', origins)).toBe(false);
    expect(() => parseAllowedOrigins('https://openpacksduel.vercel.app/path')).toThrow(
      'exact HTTP(S) origins',
    );
  });
});
