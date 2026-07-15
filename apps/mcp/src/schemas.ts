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
  'funded',
  'opening',
  'awaiting_assets',
  'settled',
  'cancelled',
  'refunded',
  'failed',
]);

export const duelSchema = z.object({
  id: z.string(),
  status: duelStatusSchema,
  matchmakingMode: z.enum(['open', 'direct']),
  creatorWallet: z.string(),
  opponentWallet: z.string().nullable().optional(),
  pack: packSchema,
  stake: moneySchema,
  escrowAddress: z.string().nullable().optional(),
  transactionSignature: z.string().nullable().optional(),
  winnerWallet: z.string().nullable().optional(),
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

export type Duel = z.infer<typeof duelSchema>;
export type DuelList = z.infer<typeof duelListSchema>;
export type Pack = z.infer<typeof packSchema>;
export type PackList = z.infer<typeof packListSchema>;
export type SocialCard = z.infer<typeof socialCardSchema>;
