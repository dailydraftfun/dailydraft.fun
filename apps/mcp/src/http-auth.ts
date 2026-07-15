import { createHash, timingSafeEqual } from 'node:crypto';

export type McpScope = 'prepare' | 'read';

export interface McpPrincipal {
  credentialId: string;
  fingerprint: string;
  scopes: ReadonlySet<McpScope>;
}

interface StoredCredential extends McpPrincipal {
  tokenDigest: Buffer;
}

interface CredentialConfig {
  id: string;
  scopes: McpScope[];
  token: string;
}

export class McpCredentialStore {
  readonly #credentials: StoredCredential[];

  constructor(serialized = process.env.OPENPACKSDUEL_MCP_KEYS ?? '') {
    this.#credentials = parseCredentialConfig(serialized);
  }

  get configured(): boolean {
    return this.#credentials.length > 0;
  }

  authenticate(authorization: string | undefined): McpPrincipal | null {
    const token = readBearerToken(authorization);
    if (!token) return null;
    const candidateDigest = digest(token);
    let credential: StoredCredential | undefined;
    for (const entry of this.#credentials) {
      if (timingSafeEqual(candidateDigest, entry.tokenDigest)) credential = entry;
    }
    if (!credential) return null;
    return {
      credentialId: credential.credentialId,
      fingerprint: credential.fingerprint,
      scopes: credential.scopes,
    };
  }
}

export function parseAllowedOrigins(
  serialized = process.env.OPENPACKSDUEL_MCP_ALLOWED_ORIGINS ?? '',
): ReadonlySet<string> {
  const origins = serialized
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (url.origin !== value || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
        throw new Error('MCP allowed origins must be exact HTTP(S) origins without paths');
      }
      return url.origin;
    });
  return new Set(origins);
}

export function isAllowedOrigin(
  requestOrigin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (!requestOrigin) return true;
  return allowedOrigins.has(requestOrigin);
}

function parseCredentialConfig(serialized: string): StoredCredential[] {
  if (!serialized.trim()) return [];

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('OPENPACKSDUEL_MCP_KEYS must be a JSON array');
  }
  if (!Array.isArray(value)) throw new Error('OPENPACKSDUEL_MCP_KEYS must be a JSON array');

  const credentials = value.map(parseCredential);
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  for (const credential of credentials) {
    if (ids.has(credential.credentialId)) throw new Error('MCP credential IDs must be unique');
    if (fingerprints.has(credential.fingerprint)) throw new Error('MCP credentials must be unique');
    ids.add(credential.credentialId);
    fingerprints.add(credential.fingerprint);
  }
  return credentials;
}

function parseCredential(value: unknown): StoredCredential {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Each MCP credential must be an object');
  }
  const record = value as Partial<CredentialConfig>;
  if (typeof record.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(record.id)) {
    throw new Error('Each MCP credential needs a stable lowercase ID');
  }
  if (typeof record.token !== 'string' || record.token.length < 32 || record.token.length > 256) {
    throw new Error('Each MCP credential token must contain 32 to 256 characters');
  }
  if (!Array.isArray(record.scopes) || !record.scopes.includes('read')) {
    throw new Error('Each MCP credential must include read scope');
  }
  if (!record.scopes.every((scope) => scope === 'read' || scope === 'prepare')) {
    throw new Error('MCP credential scopes are limited to read and prepare');
  }
  const tokenDigest = digest(record.token);
  return {
    credentialId: record.id,
    fingerprint: tokenDigest.toString('hex').slice(0, 16),
    scopes: new Set(record.scopes),
    tokenDigest,
  };
}

function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  return token.length >= 32 && token.length <= 256 ? token : null;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
