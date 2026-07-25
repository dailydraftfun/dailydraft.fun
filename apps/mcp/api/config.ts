import type { IncomingMessage, ServerResponse } from 'node:http';

const tools = [
  'list_packs',
  'get_pack',
  'list_duels',
  'get_duel',
  'get_duel_proof',
  'get_duel_social_card',
  'prepare_create_duel',
  'prepare_fund_duel',
] as const;

export default function configHandler(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const endpoint = `${publicOrigin(request)}/mcp`;
  const body = {
    authentication: {
      header: 'Authorization: Bearer <token>',
      tokenEnvironmentVariable: 'DAILYDRAFT_MCP_TOKEN',
      type: 'bearer',
    },
    endpoint,
    name: 'dailydraft',
    network: 'solana-devnet',
    safety: {
      acceptsPrivateKeys: false,
      serverSignsTransactions: false,
      serverSubmitsTransactions: false,
      walletConfirmationRequired: true,
    },
    tools,
    transport: {
      mode: 'stateless',
      type: 'streamable-http',
    },
    version: '0.1.0',
  };

  response.statusCode = 200;
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body, null, 2));
}

function publicOrigin(request: IncomingMessage): string {
  const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
  const host = forwardedHost ?? firstHeader(request.headers.host);
  if (!host) return 'https://dailydraft-mcp.vercel.app';

  const forwardedProtocol = firstHeader(request.headers['x-forwarded-proto']);
  const protocol = forwardedProtocol ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
