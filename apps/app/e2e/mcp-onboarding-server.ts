import { resolve } from 'node:path';

const publicDirectory = resolve(import.meta.dir, '../../mcp/public');
const publicFiles = new Map<string, readonly [string, string]>([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/connect.js', ['connect.js', 'text/javascript; charset=utf-8']],
  ['/robots.txt', ['robots.txt', 'text/plain; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

export function mcpOnboardingFetch(request: Request): Response {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/health') {
    return Response.json({
      authenticationConfigured: true,
      status: 'ready',
      upstreamApiConfigured: true,
    });
  }

  const asset = publicFiles.get(pathname);
  if (!asset) return new Response('Not found', { status: 404 });
  return new Response(Bun.file(resolve(publicDirectory, asset[0])), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': asset[1],
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function startMcpOnboardingServer(port = 3004): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    fetch: mcpOnboardingFetch,
    hostname: '127.0.0.1',
    port,
  });
}

if (import.meta.main) startMcpOnboardingServer();
