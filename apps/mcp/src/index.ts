#!/usr/bin/env bun

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { OpenPacksApiClient } from './api-client.js';
import { createOpenPacksDuelServer } from './server.js';

async function main(): Promise<void> {
  const client = new OpenPacksApiClient();
  const server = createOpenPacksDuelServer(client, {
    canPrepareTransactions:
      process.env.OPENPACKSDUEL_MCP_ENABLE_PREPARE === 'true' && client.hasIntegrationCredential,
  });
  await server.connect(new StdioServerTransport());
  console.error('OpenPacks Duel MCP server running over stdio');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`OpenPacks Duel MCP failed to start: ${message}`);
  process.exit(1);
});
