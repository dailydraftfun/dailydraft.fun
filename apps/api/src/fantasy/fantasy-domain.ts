import type { Money } from '../domain.js';

// Local string-literal mirrors of the Prisma `FantasySport` / `FantasyPosition`
// enums. Kept independent of the generated client so the pure scoring and payout
// calculators (and their unit tests) never depend on a built database package.
export const FANTASY_SPORTS = ['SOCCER', 'FOOTBALL', 'BASEBALL', 'BASKETBALL'] as const;
export type FantasySport = (typeof FANTASY_SPORTS)[number];

export const FANTASY_POSITIONS = ['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD'] as const;
export type FantasyPosition = (typeof FANTASY_POSITIONS)[number];

// Shared canonical contract patterns. These mirror the CHECK constraints on the
// fantasy tables so the application layer fails closed on the same invariants the
// database enforces.
export const FANTASY_RULES_HASH_PATTERN = /^[a-f0-9]{64}$/;
export const FANTASY_RULES_VERSION_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
export const FANTASY_UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
export const FANTASY_SIGNED_INTEGER_PATTERN = /^(0|-?[1-9]\d*)$/;
export const FANTASY_STAT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const FANTASY_SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isFantasySport(value: unknown): value is FantasySport {
  return typeof value === 'string' && (FANTASY_SPORTS as readonly string[]).includes(value);
}

export function isFantasyPosition(value: unknown): value is FantasyPosition {
  return typeof value === 'string' && (FANTASY_POSITIONS as readonly string[]).includes(value);
}

export function fantasyMoney(amount: bigint): Money {
  return Object.freeze({
    amount: amount.toString(),
    currency: 'USDC',
    decimals: 6,
  });
}
