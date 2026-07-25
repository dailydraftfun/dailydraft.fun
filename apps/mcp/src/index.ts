#!/usr/bin/env bun

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { DailyDraftApiClient } from './api-client.js';
import { createDailyDraftServer } from './server.js';

async function main(): Promise<void> {
  const client = new DailyDraftApiClient();
  const server = createDailyDraftServer(client, {
    canPrepareTransactions:
      process.env.DAILYDRAFT_MCP_ENABLE_PREPARE === 'true' && client.hasIntegrationCredential,
  });
  await server.connect(new StdioServerTransport());
  console.error('DailyDraft MCP server running over stdio');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`DailyDraft MCP failed to start: ${message}`);
  process.exit(1);
});
