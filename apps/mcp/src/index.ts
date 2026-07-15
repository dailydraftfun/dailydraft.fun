#!/usr/bin/env bun

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createOpenPacksDuelServer } from './server.js';

async function main(): Promise<void> {
  const server = createOpenPacksDuelServer();
  await server.connect(new StdioServerTransport());
  console.error('OpenPacks Duel MCP server running over stdio');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`OpenPacks Duel MCP failed to start: ${message}`);
  process.exit(1);
});
