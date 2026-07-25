import { afterAll, describe, expect, mock, test } from 'bun:test';

const originalApiUrl = process.env.DAILYDRAFT_API_URL;
const originalEnablePrepare = process.env.DAILYDRAFT_MCP_ENABLE_PREPARE;
const originalConsoleError = console.error;
const originalExit = process.exit;

// The entrypoint reads both of these while wiring the server together, so they are
// set before the import rather than inside a test.
process.env.DAILYDRAFT_API_URL = 'https://api.example.test/v1';
process.env.DAILYDRAFT_MCP_ENABLE_PREPARE = 'true';

let reportStartup: (message: string) => void = () => undefined;
const startupLog = new Promise<string>((resolve) => {
  reportStartup = resolve;
});

// Only this entrypoint imports the stdio transport, so stubbing it keeps the CLI off
// the real process streams without disturbing the HTTP transport that src/http.test.ts
// exercises for real — bun's module mocks are process-wide.
mock.module('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    onclose: (() => void) | undefined;
    onerror: ((error: Error) => void) | undefined;
    onmessage: ((message: unknown) => void) | undefined;
    async close(): Promise<void> {}
    async send(): Promise<void> {}
    setProtocolVersion(_version: string): void {}
    async start(): Promise<void> {}
  },
}));

console.error = (message: unknown) => reportStartup(String(message));
process.exit = ((code?: number) => {
  throw new Error(`MCP entrypoint exited with ${String(code)}`);
}) as typeof process.exit;

await import('./index.js');
const startupMessage = await startupLog;

console.error = originalConsoleError;
process.exit = originalExit;

afterAll(() => {
  if (originalApiUrl === undefined) delete process.env.DAILYDRAFT_API_URL;
  else process.env.DAILYDRAFT_API_URL = originalApiUrl;
  if (originalEnablePrepare === undefined) delete process.env.DAILYDRAFT_MCP_ENABLE_PREPARE;
  else process.env.DAILYDRAFT_MCP_ENABLE_PREPARE = originalEnablePrepare;
});

describe('DailyDraft MCP stdio entrypoint', () => {
  test('boots the server over stdio and announces itself on stderr', () => {
    expect(startupMessage).toBe('DailyDraft MCP server running over stdio');
  });

  test('reports readiness rather than a startup failure', () => {
    expect(startupMessage).not.toContain('failed to start');
  });
});
