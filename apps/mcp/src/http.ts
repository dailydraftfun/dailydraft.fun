import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { OpenPacksApiClient } from './api-client.js';
import {
  isAllowedOrigin,
  McpCredentialStore,
  type McpPrincipal,
  parseAllowedOrigins,
} from './http-auth.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { createOpenPacksDuelServer } from './server.js';

interface HttpHandlerOptions {
  allowedOrigins?: ReadonlySet<string>;
  apiClientFactory?: () => OpenPacksApiClient;
  credentialStore?: McpCredentialStore;
  rateLimiter?: FixedWindowRateLimiter;
}

export function createMcpHttpHandler(options: HttpHandlerOptions = {}) {
  const allowedOrigins = options.allowedOrigins ?? parseAllowedOrigins();
  const apiClientFactory = options.apiClientFactory ?? (() => new OpenPacksApiClient());
  const credentialStore = options.credentialStore ?? new McpCredentialStore();
  const rateLimiter = options.rateLimiter ?? new FixedWindowRateLimiter();

  return async function mcpHttpHandler(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = singleHeader(request.headers.origin);
    response.setHeader('Vary', 'Origin');
    if (!isAllowedOrigin(origin, allowedOrigins)) {
      sendJsonRpcError(response, 403, -32000, 'Forbidden origin');
      return;
    }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader(
      'Access-Control-Expose-Headers',
      'MCP-Protocol-Version, X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After',
    );

    if (request.method === 'OPTIONS') {
      response.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
      );
      response.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      response.setHeader('Access-Control-Max-Age', '600');
      response.statusCode = 204;
      response.end();
      return;
    }

    if (!credentialStore.configured) {
      sendJsonRpcError(response, 503, -32000, 'MCP authentication is not configured');
      return;
    }
    const principal = credentialStore.authenticate(singleHeader(request.headers.authorization));
    if (!principal) {
      response.setHeader('WWW-Authenticate', 'Bearer realm="openpacksduel-mcp"');
      sendJsonRpcError(response, 401, -32001, 'Missing or invalid MCP credential');
      return;
    }

    const rate = rateLimiter.consume(principal.fingerprint);
    response.setHeader('X-RateLimit-Limit', String(rate.limit));
    response.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    if (!rate.allowed) {
      response.setHeader('Retry-After', String(rate.retryAfterSeconds));
      sendJsonRpcError(response, 429, -32002, 'MCP rate limit exceeded');
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS');
      sendJsonRpcError(response, 405, -32000, 'Method not allowed in stateless mode');
      return;
    }

    await handleAuthenticatedRequest(request, response, principal, apiClientFactory());
  };
}

async function handleAuthenticatedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  principal: McpPrincipal,
  client: OpenPacksApiClient,
): Promise<void> {
  const server = createOpenPacksDuelServer(client, {
    canPrepareTransactions: principal.scopes.has('prepare') && client.hasIntegrationCredential,
  });
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  try {
    // @ts-expect-error SDK 1.29's HTTP transport accessor types conflict with exactOptionalPropertyTypes.
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch {
    if (!response.headersSent) {
      sendJsonRpcError(response, 500, -32603, 'OpenPacks Duel MCP request failed');
    }
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

function sendJsonRpcError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ error: { code, message }, id: null, jsonrpc: '2.0' }));
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
