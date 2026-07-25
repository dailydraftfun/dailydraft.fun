import type { IncomingMessage, ServerResponse } from 'node:http';

interface HealthBody {
  authenticationConfigured: boolean;
  endpoint: string;
  network: 'solana-devnet';
  service: 'dailydraft-mcp';
  status: 'ready' | 'unavailable';
  transport: 'streamable-http';
  upstreamApiConfigured: boolean;
}

export default function healthHandler(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const authenticationConfigured = Boolean(process.env.DAILYDRAFT_MCP_KEYS?.trim());
  const upstreamApiConfigured = Boolean(process.env.DAILYDRAFT_API_URL?.trim());
  const ready = authenticationConfigured && upstreamApiConfigured;
  const body: HealthBody = {
    authenticationConfigured,
    endpoint: '/mcp',
    network: 'solana-devnet',
    service: 'dailydraft-mcp',
    status: ready ? 'ready' : 'unavailable',
    transport: 'streamable-http',
    upstreamApiConfigured,
  };

  response.statusCode = ready ? 200 : 503;
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
}
