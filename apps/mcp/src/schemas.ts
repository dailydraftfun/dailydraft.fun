import * as z from 'zod/v4';

export const moneySchema = z.object({
  amount: z.string().regex(/^\d+$/),
  currency: z.literal('USDC'),
  decimals: z.literal(6),
});

export const packSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  providerPackId: z.string().optional(),
  price: moneySchema,
  imageUrl: z.url().optional(),
  active: z.boolean(),
  valuationPolicyHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export const duelStatusSchema = z.enum([
  'waiting',
  'matched',
  'committing',
  'funded',
  'opening',
  'awaiting_assets',
  'settling',
  'settled',
  'cancelling',
  'cancelled',
  'refunding',
  'refunded',
  'failed',
]);

export const duelPackOutcomeSchema = z.object({
  assetReference: z.string(),
  displayName: z.string().max(160),
  insuredValue: moneySchema,
  isMock: z.boolean(),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/),
  side: z.enum(['creator', 'opponent']),
});

export const duelResultSchema = z.object({
  comparisonMetric: z.literal('insured-value'),
  outcomes: z.array(duelPackOutcomeSchema).length(2),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/),
  settlementReady: z.boolean(),
  valuationPolicyHash: z.string().regex(/^[a-f0-9]{64}$/),
  winnerSide: z.enum(['creator', 'opponent']).nullable(),
});

export const duelSchema = z.object({
  id: z.string(),
  status: duelStatusSchema,
  matchmakingMode: z.enum(['open', 'direct', 'house']),
  creatorWallet: z.string(),
  environment: z.literal('solana-devnet'),
  providerMode: z.enum(['mock', 'collector-crypt-sandbox']),
  houseOpponent: z.boolean(),
  opponentWallet: z.string().nullable().optional(),
  pack: packSchema,
  stake: moneySchema,
  escrowAddress: z.string().nullable().optional(),
  transactionSignature: z.string().nullable().optional(),
  winnerWallet: z.string().nullable().optional(),
  result: duelResultSchema.nullable().optional(),
  opponentJoinedAt: z.iso.datetime().nullable().optional(),
  cancellationReason: z.string().nullable().optional(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional(),
});

export const packListSchema = z.object({
  data: z.array(packSchema),
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean(),
});

export const duelListSchema = z.object({
  data: z.array(duelSchema),
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean(),
});

export const socialCardSchema = z.object({
  duelId: z.string(),
  status: duelStatusSchema,
  pageUrl: z.url(),
  imageUrl: z.url(),
  shareText: z.string().max(280).optional(),
});

export const duelProofSchema = z.object({
  duelId: z.string(),
  environment: z.literal('solana-devnet'),
  escrowAddress: z.string().nullable(),
  providerMode: z.enum(['mock', 'collector-crypt-sandbox']),
  resultHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  settlementReady: z.boolean(),
  status: duelStatusSchema,
  transactionSignature: z.string().nullable(),
  valuationPolicyHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  verification: z.object({
    apiStateIsOnChainProof: z.literal(false),
    mockAssetsHaveValue: z.literal(false),
    verifyOnSolana: z.boolean(),
  }),
  winnerWallet: z.string().nullable(),
});

export const preparedTransactionSchema = z.object({
  action: z.enum(['fund', 'cancel', 'refund']),
  encoding: z.literal('base64'),
  expiresAt: z.iso.datetime(),
  summary: z.string(),
  transaction: z.string().min(1),
});

export const walletConfirmationSchema = z.object({
  action: z.enum(['create', 'fund', 'cancel', 'refund']),
  checks: z.array(z.string()).min(1),
  message: z.string(),
  network: z.literal('solana-devnet'),
  privateKeyAccepted: z.literal(false),
  required: z.literal(true),
  serverSigned: z.literal(false),
  serverSubmitted: z.literal(false),
});

export const createDuelIntentSchema = z.object({
  intent: z.object({
    creatorWallet: z.string(),
    expiresAt: z.iso.datetime(),
    matchmakingMode: z.enum(['open', 'direct', 'house']),
    opponentWallet: z.string().nullable(),
    packId: z.string(),
  }),
  kind: z.literal('off-chain-duel-intent'),
  pack: packSchema,
  walletConfirmation: walletConfirmationSchema,
});

export const preparedWalletTransactionSchema = z.object({
  duelId: z.string(),
  kind: z.literal('unsigned-solana-transaction'),
  preparedTransaction: preparedTransactionSchema,
  walletConfirmation: walletConfirmationSchema,
});

export type Duel = z.infer<typeof duelSchema>;
export type DuelList = z.infer<typeof duelListSchema>;
export type DuelProof = z.infer<typeof duelProofSchema>;
export type Pack = z.infer<typeof packSchema>;
export type PackList = z.infer<typeof packListSchema>;
export type PreparedTransaction = z.infer<typeof preparedTransactionSchema>;
export type SocialCard = z.infer<typeof socialCardSchema>;
