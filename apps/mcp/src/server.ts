import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';

import { DailyDraftApiClient, DailyDraftApiError } from './api-client.js';
import {
  createDuelIntentSchema,
  duelListSchema,
  duelProofSchema,
  duelSchema,
  duelStatusSchema,
  packListSchema,
  packSchema,
  preparedWalletTransactionSchema,
  socialCardSchema,
} from './schemas.js';

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: true,
} as const;

const prepareOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: false,
} as const;

const solanaAddressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);

export interface McpAccess {
  canPrepareTransactions: boolean;
}

const defaultAccess: McpAccess = { canPrepareTransactions: false };

export const integrationSafetyGuidance = [
  '# DailyDraft integration safety',
  '',
  '- Never request or transmit a wallet private key or seed phrase.',
  '- Treat API duel status as an index; verify value-bearing state on Solana.',
  '- Do not sign or submit transactions without explicit wallet confirmation.',
  '- Prepare tools return unsigned intents only; they never sign, submit, or hold keys.',
  '- Verify the program ID, accounts, amounts, mints, and expiry in the wallet.',
  '',
  '## Canonical player rules',
  '',
  '- Card Duel: https://app.dailydraft.fun/games/duel#rules',
  '- Marketplace Flip: https://app.dailydraft.fun/games/marketplace-flip#rules (fixture only)',
  '- Card Streak: https://app.dailydraft.fun/games/crash#rules (fixture only)',
  '- Never present a fixture-only mode or unresolved tier as playable.',
].join('\n');

export function createDailyDraftServer(
  client = new DailyDraftApiClient(),
  access: McpAccess = defaultAccess,
): McpServer {
  const server = new McpServer({
    name: 'dailydraft',
    version: '0.1.0',
  });

  server.registerTool(
    'list_packs',
    {
      title: 'List DailyDraft packs',
      description: 'List pack definitions currently eligible for DailyDraft matchmaking.',
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
      title: 'Get an DailyDraft pack',
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
      title: 'List DailyDrafts',
      description: 'Discover public duels, optionally filtered by status or participant wallet.',
      inputSchema: {
        cursor: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(100).optional().default(20),
        matchmakingMode: z.enum(['open', 'direct', 'house']).optional(),
        packId: z.string().min(3).max(64).optional(),
        status: duelStatusSchema.optional(),
        wallet: solanaAddressSchema.optional(),
      },
      outputSchema: duelListSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (input) => asToolResult(() => client.listDuels(input)),
  );

  server.registerTool(
    'get_duel_proof',
    {
      title: 'Get DailyDraft proof references',
      description:
        'Read the public result commitment and Solana references. API state is explicitly not treated as on-chain proof.',
      inputSchema: {
        duelId: z.string().min(8).max(80),
      },
      outputSchema: duelProofSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async ({ duelId }) => asToolResult(() => client.getDuelProof(duelId)),
  );

  server.registerTool(
    'prepare_create_duel',
    {
      title: 'Prepare an DailyDraft creation intent',
      description:
        'Validate and return an off-chain devnet duel intent for human review. This tool does not create a duel, sign, or submit anything.',
      inputSchema: {
        creatorWallet: solanaAddressSchema,
        expiresAt: z.iso.datetime(),
        matchmakingMode: z.enum(['open', 'direct', 'house']),
        opponentWallet: solanaAddressSchema.optional(),
        packId: z.string().min(3).max(64),
      },
      outputSchema: createDuelIntentSchema.shape,
      annotations: prepareOnlyAnnotations,
    },
    async (input) => {
      if (!access.canPrepareTransactions) return scopeDeniedResult();
      return asToolResult(async () => {
        validateCreateIntent(input);
        const pack = await client.getPack(input.packId);
        return {
          intent: {
            creatorWallet: input.creatorWallet,
            expiresAt: input.expiresAt,
            matchmakingMode: input.matchmakingMode,
            opponentWallet: input.opponentWallet ?? null,
            packId: input.packId,
          },
          kind: 'off-chain-duel-intent' as const,
          pack,
          walletConfirmation: confirmationFor('create'),
        };
      });
    },
  );

  registerTransactionPreparationTool(server, client, access, 'fund');

  server.registerTool(
    'get_duel',
    {
      title: 'Get an DailyDraft',
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
      title: 'Get an DailyDraft social card',
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
    'dailydraft://integration/safety',
    {
      description: 'Non-custodial safety rules for DailyDraft agent integrations.',
      mimeType: 'text/markdown',
      title: 'DailyDraft integration safety',
    },
    async () => ({
      contents: [
        {
          mimeType: 'text/markdown',
          text: integrationSafetyGuidance,
          uri: 'dailydraft://integration/safety',
        },
      ],
    }),
  );

  return server;
}

function registerTransactionPreparationTool(
  server: McpServer,
  client: DailyDraftApiClient,
  access: McpAccess,
  action: 'fund',
): void {
  server.registerTool(
    `prepare_${action}_duel`,
    {
      title: `Prepare an DailyDraft ${action} transaction`,
      description: `Request an unsigned Solana devnet ${action} transaction. A participant wallet must inspect, confirm, sign, and submit it separately.`,
      inputSchema: {
        duelId: z.string().min(8).max(80),
        idempotencyKey: idempotencyKeySchema,
        wallet: solanaAddressSchema,
      },
      outputSchema: preparedWalletTransactionSchema.shape,
      annotations: prepareOnlyAnnotations,
    },
    async ({ duelId, idempotencyKey, wallet }) => {
      if (!access.canPrepareTransactions) return scopeDeniedResult();
      return asToolResult(async () => ({
        duelId,
        kind: 'unsigned-solana-transaction' as const,
        preparedTransaction: await client.prepareTransaction({
          action,
          duelId,
          idempotencyKey,
          wallet,
        }),
        walletConfirmation: confirmationFor(action),
      }));
    },
  );
}

function confirmationFor(action: 'cancel' | 'create' | 'fund' | 'refund') {
  const checks =
    action === 'create'
      ? [
          'Confirm the pack, opponent mode, wallet, and expiry before creating the duel.',
          'Creation is off-chain and does not prove that either side funded escrow.',
        ]
      : [
          'Decode the base64 transaction and verify every Solana instruction.',
          'Verify the devnet program ID, accounts, mint, amount, fees, and expiry.',
          'Sign and submit only from the displayed participant wallet.',
        ];
  return {
    action,
    checks,
    message: 'Explicit participant-wallet confirmation is required outside this MCP server.',
    network: 'solana-devnet' as const,
    privateKeyAccepted: false as const,
    required: true as const,
    serverSigned: false as const,
    serverSubmitted: false as const,
  };
}

function validateCreateIntent(input: {
  creatorWallet: string;
  expiresAt: string;
  matchmakingMode: 'direct' | 'house' | 'open';
  opponentWallet?: string | undefined;
}): void {
  if (new Date(input.expiresAt).getTime() <= Date.now()) {
    throw new Error('expiresAt must be in the future');
  }
  if (input.matchmakingMode === 'direct' && !input.opponentWallet) {
    throw new Error('opponentWallet is required for direct matchmaking');
  }
  if (input.matchmakingMode !== 'direct' && input.opponentWallet) {
    throw new Error('opponentWallet is only accepted for direct matchmaking');
  }
  if (input.creatorWallet === input.opponentWallet) {
    throw new Error('A wallet cannot duel itself');
  }
}

function scopeDeniedResult(): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: 'Transaction preparation is not authorized or its upstream integration credential is not configured.',
      },
    ],
    isError: true,
  };
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
  if (error instanceof DailyDraftApiError) {
    const requestId = error.requestId ? ` Request ID: ${error.requestId}.` : '';
    return `DailyDraft API error (${error.status}): ${error.message}.${requestId}`;
  }
  return 'DailyDraft MCP could not complete the request.';
}
