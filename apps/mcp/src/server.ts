import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';

import { OpenPacksApiClient, OpenPacksApiError } from './api-client.js';
import {
  duelListSchema,
  duelSchema,
  duelStatusSchema,
  packListSchema,
  packSchema,
  socialCardSchema,
} from './schemas.js';

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: true,
} as const;

export function createOpenPacksDuelServer(client = new OpenPacksApiClient()): McpServer {
  const server = new McpServer({
    name: 'openpacksduel',
    version: '0.1.0',
  });

  server.registerTool(
    'list_packs',
    {
      title: 'List OpenPacks Duel packs',
      description: 'List pack definitions currently eligible for OpenPacks Duel matchmaking.',
      inputSchema: {
        active: z.boolean().optional().default(true),
        cursor: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
      outputSchema: packListSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (input) => asToolResult(() => client.listPacks(input)),
  );

  server.registerTool(
    'get_pack',
    {
      title: 'Get an OpenPacks Duel pack',
      description: 'Get one pack definition by its stable integration identifier.',
      inputSchema: {
        packId: z.string().min(3).max(64),
      },
      outputSchema: packSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async ({ packId }) => asToolResult(() => client.getPack(packId)),
  );

  server.registerTool(
    'list_duels',
    {
      title: 'List OpenPacks Duels',
      description: 'Discover public duels, optionally filtered by status or participant wallet.',
      inputSchema: {
        cursor: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(100).optional().default(20),
        status: duelStatusSchema.optional(),
        wallet: z.string().min(32).max(44).optional(),
      },
      outputSchema: duelListSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (input) => asToolResult(() => client.listDuels(input)),
  );

  server.registerTool(
    'get_duel',
    {
      title: 'Get an OpenPacks Duel',
      description:
        'Read canonical duel status, participants, escrow address, and chain references.',
      inputSchema: {
        duelId: z.string().min(8).max(80),
      },
      outputSchema: duelSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async ({ duelId }) => asToolResult(() => client.getDuel(duelId)),
  );

  server.registerTool(
    'get_duel_social_card',
    {
      title: 'Get an OpenPacks Duel social card',
      description: 'Get canonical share-page and generated social-card URLs for a duel.',
      inputSchema: {
        duelId: z.string().min(8).max(80),
      },
      outputSchema: socialCardSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async ({ duelId }) => asToolResult(() => client.getDuelSocialCard(duelId)),
  );

  server.registerResource(
    'integration-safety',
    'openpacksduel://integration/safety',
    {
      description: 'Non-custodial safety rules for OpenPacks Duel agent integrations.',
      mimeType: 'text/markdown',
      title: 'OpenPacks Duel integration safety',
    },
    async () => ({
      contents: [
        {
          mimeType: 'text/markdown',
          text: [
            '# OpenPacks Duel integration safety',
            '',
            '- Never request or transmit a wallet private key or seed phrase.',
            '- Treat API duel status as an index; verify value-bearing state on Solana.',
            '- Do not sign or submit transactions without explicit wallet confirmation.',
            '- MCP tools in this release are read-only.',
          ].join('\n'),
          uri: 'openpacksduel://integration/safety',
        },
      ],
    }),
  );

  return server;
}

async function asToolResult<T extends Record<string, unknown>>(
  operation: () => Promise<T>,
): Promise<CallToolResult> {
  try {
    const structuredContent = await operation();
    return {
      content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: formatError(error) }],
      isError: true,
    };
  }
}

function formatError(error: unknown): string {
  if (error instanceof OpenPacksApiError) {
    const requestId = error.requestId ? ` Request ID: ${error.requestId}.` : '';
    return `OpenPacks Duel API error (${error.status}): ${error.message}.${requestId}`;
  }
  return 'OpenPacks Duel MCP could not complete the request.';
}
