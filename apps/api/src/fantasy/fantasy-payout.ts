import { createHash } from 'node:crypto';

import type { Money } from '../domain.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  FANTASY_RULES_HASH_PATTERN,
  FANTASY_RULES_VERSION_PATTERN,
  FANTASY_SOLANA_ADDRESS_PATTERN,
  FANTASY_UNSIGNED_INTEGER_PATTERN,
  type FantasyPosition,
  type FantasySport,
  fantasyMoney,
  isFantasyPosition,
  isFantasySport,
} from './fantasy-domain.js';

export const FANTASY_PAYOUT_VERSION = 'openpacksduel.fantasy-payout.v1' as const;
export const FANTASY_PAYOUT_SCHEMA_VERSION = 'openpacksduel.fantasy-payout-rules.v1' as const;

export const FANTASY_PAYOUT_BASIS_POINTS_TOTAL = 10_000n;

const MAX_POSITIONS = 8;
const MAX_PLACES_PER_POSITION = 32;
const MAX_HOLDERS_PER_PLACE = 4_096;
const MAX_PLACE_BASIS_POINTS = 10_000n;
const MAX_MONEY_AMOUNT = 79_228_162_514_264_337_593_543_950_335n;

export type FantasyPayoutErrorCode =
  | 'BASIS_POINTS_TOTAL_MISMATCH'
  | 'DUPLICATE_PLACEMENT'
  | 'INVALID_INPUT'
  | 'INVALID_RULES'
  | 'PLACE_NOT_CONFIGURED'
  | 'POSITION_NOT_CONFIGURED'
  | 'RULES_HASH_MISMATCH'
  | 'UNSUPPORTED_RULES';

export class FantasyPayoutContractError extends Error {
  constructor(
    readonly code: FantasyPayoutErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FantasyPayoutContractError';
  }
}

export interface FantasyPositionPayoutRule {
  placeBasisPoints: readonly string[];
  position: FantasyPosition;
}

export interface UnsignedFantasyPayoutRuleSet {
  activation: 'fixture-only';
  basisPointsTotal: '10000';
  calculatorVersion: typeof FANTASY_PAYOUT_VERSION;
  currency: 'USDC';
  decimals: 6;
  positions: readonly FantasyPositionPayoutRule[];
  rounding: 'floor';
  rulesVersion: string;
  schemaVersion: typeof FANTASY_PAYOUT_SCHEMA_VERSION;
  sport: FantasySport;
}

export interface FantasyPayoutRuleSet extends UnsignedFantasyPayoutRuleSet {
  rulesHash: string;
}

export interface FantasyPayoutHolder {
  eligibleShares: string;
  walletAddress: string;
}

export interface FantasyPlacementInput {
  holders: readonly FantasyPayoutHolder[];
  place: number;
  playerId: string;
  position: FantasyPosition;
}

export interface FantasyPayoutInput {
  placements: readonly FantasyPlacementInput[];
  prizePool: Money;
}

export interface FantasyHolderReward {
  eligibleShares: string;
  reward: Money;
  walletAddress: string;
}

export interface FantasyPayoutAllocation {
  holderResidual: Money;
  holderRewards: readonly FantasyHolderReward[];
  place: number;
  placeAllocation: Money;
  placeBasisPoints: string;
  playerId: string;
  position: FantasyPosition;
}

export interface FantasyPayoutResult {
  allocations: readonly FantasyPayoutAllocation[];
  calculationHash: string;
  calculatorVersion: typeof FANTASY_PAYOUT_VERSION;
  currency: 'USDC';
  decimals: 6;
  distributed: Money;
  prizePool: Money;
  residual: Money;
  rounding: 'floor';
  rulesHash: string;
  rulesVersion: string;
  sport: FantasySport;
  undistributed: Money;
}

export function hashFantasyPayoutRuleSet(rules: UnsignedFantasyPayoutRuleSet): string {
  return sha256(stableStringify(rules));
}

export function validateFantasyPayoutRuleSet(value: unknown): FantasyPayoutRuleSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError('UNSUPPORTED_RULES', 'Fantasy payout rules are required');
  }

  const rules = value as Partial<FantasyPayoutRuleSet>;
  if (
    rules.schemaVersion !== FANTASY_PAYOUT_SCHEMA_VERSION ||
    rules.calculatorVersion !== FANTASY_PAYOUT_VERSION ||
    rules.activation !== 'fixture-only'
  ) {
    throw contractError(
      'UNSUPPORTED_RULES',
      'Fantasy payout rules use an unsupported schema, calculator, or activation mode',
    );
  }
  if (
    rules.rounding !== 'floor' ||
    rules.currency !== 'USDC' ||
    rules.decimals !== 6 ||
    rules.basisPointsTotal !== '10000' ||
    !isFantasySport(rules.sport)
  ) {
    throw contractError('INVALID_RULES', 'Fantasy payout rules have invalid settlement semantics');
  }
  if (
    typeof rules.rulesVersion !== 'string' ||
    !FANTASY_RULES_VERSION_PATTERN.test(rules.rulesVersion)
  ) {
    throw contractError('INVALID_RULES', 'Fantasy payout rulesVersion is invalid');
  }
  if (typeof rules.rulesHash !== 'string' || !FANTASY_RULES_HASH_PATTERN.test(rules.rulesHash)) {
    throw contractError('RULES_HASH_MISMATCH', 'Fantasy payout rulesHash is invalid');
  }
  if (
    !Array.isArray(rules.positions) ||
    rules.positions.length === 0 ||
    rules.positions.length > MAX_POSITIONS
  ) {
    throw contractError('INVALID_RULES', 'Fantasy payout rules require a bounded position table');
  }

  const positions: FantasyPositionPayoutRule[] = [];
  const seenPositions = new Set<FantasyPosition>();
  let basisPointsTotal = 0n;

  for (const candidate of rules.positions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw contractError('INVALID_RULES', 'Fantasy payout position rule is invalid');
    }
    const positionRule = candidate as Partial<FantasyPositionPayoutRule>;
    if (!isFantasyPosition(positionRule.position) || seenPositions.has(positionRule.position)) {
      throw contractError('INVALID_RULES', 'Fantasy payout positions must be known and unique');
    }
    seenPositions.add(positionRule.position);

    if (
      !Array.isArray(positionRule.placeBasisPoints) ||
      positionRule.placeBasisPoints.length === 0 ||
      positionRule.placeBasisPoints.length > MAX_PLACES_PER_POSITION
    ) {
      throw contractError('INVALID_RULES', 'Fantasy payout places must be a bounded list');
    }

    const placeBasisPoints: string[] = [];
    for (const rawBps of positionRule.placeBasisPoints) {
      const bps = parseBasisPoints(rawBps);
      basisPointsTotal += bps;
      placeBasisPoints.push(bps.toString());
    }

    positions.push(
      Object.freeze({
        placeBasisPoints: Object.freeze(placeBasisPoints),
        position: positionRule.position,
      }),
    );
  }

  if (basisPointsTotal !== FANTASY_PAYOUT_BASIS_POINTS_TOTAL) {
    throw contractError(
      'BASIS_POINTS_TOTAL_MISMATCH',
      'Fantasy payout basis points must sum to exactly 10000',
    );
  }

  const unsignedRules: UnsignedFantasyPayoutRuleSet = {
    activation: 'fixture-only',
    basisPointsTotal: '10000',
    calculatorVersion: FANTASY_PAYOUT_VERSION,
    currency: 'USDC',
    decimals: 6,
    positions: Object.freeze(positions),
    rounding: 'floor',
    rulesVersion: rules.rulesVersion,
    schemaVersion: FANTASY_PAYOUT_SCHEMA_VERSION,
    sport: rules.sport,
  };
  const calculatedHash = hashFantasyPayoutRuleSet(unsignedRules);
  if (calculatedHash !== rules.rulesHash) {
    throw contractError(
      'RULES_HASH_MISMATCH',
      'Fantasy payout rules do not match their committed hash',
    );
  }

  return Object.freeze({ ...unsignedRules, rulesHash: calculatedHash });
}

export function calculateFantasyPayouts(
  rulesInput: unknown,
  input: FantasyPayoutInput,
): FantasyPayoutResult {
  const rules = validateFantasyPayoutRuleSet(rulesInput);
  const prizePool = parseMoney(input.prizePool, 'prize pool');
  const prizePoolAmount = BigInt(prizePool.amount);

  if (!Array.isArray(input.placements)) {
    throw contractError('INVALID_INPUT', 'Fantasy payout placements must be an array');
  }

  const seenPlacements = new Set<string>();
  const allocations: FantasyPayoutAllocation[] = [];
  let distributed = 0n;
  let residual = 0n;
  let filledPlaceAllocations = 0n;

  for (const placement of input.placements) {
    if (!placement || typeof placement !== 'object' || Array.isArray(placement)) {
      throw contractError('INVALID_INPUT', 'Fantasy payout placement is invalid');
    }
    if (!isFantasyPosition(placement.position)) {
      throw contractError(
        'POSITION_NOT_CONFIGURED',
        'Fantasy payout placement position is invalid',
      );
    }
    const positionRule = rules.positions.find((rule) => rule.position === placement.position);
    if (!positionRule) {
      throw contractError('POSITION_NOT_CONFIGURED', 'Fantasy payout position is not configured');
    }
    if (
      typeof placement.place !== 'number' ||
      !Number.isInteger(placement.place) ||
      placement.place < 1 ||
      placement.place > positionRule.placeBasisPoints.length
    ) {
      throw contractError('PLACE_NOT_CONFIGURED', 'Fantasy payout place is not configured');
    }
    if (typeof placement.playerId !== 'string' || placement.playerId.length === 0) {
      throw contractError('INVALID_INPUT', 'Fantasy payout placement requires a player id');
    }

    const placementKey = `${placement.position}#${placement.place}`;
    if (seenPlacements.has(placementKey)) {
      throw contractError(
        'DUPLICATE_PLACEMENT',
        'Fantasy payout placements must be unique per place',
      );
    }
    seenPlacements.add(placementKey);

    const placeBasisPoints = BigInt(positionRule.placeBasisPoints[placement.place - 1]);
    const placeAllocationAmount =
      (prizePoolAmount * placeBasisPoints) / FANTASY_PAYOUT_BASIS_POINTS_TOTAL;

    const { holderRewards, totalShares, holderDistributed } = distributeToHolders(
      placement.holders,
      placeAllocationAmount,
    );

    // A place with no positive eligible shares cannot pay a holder; its entire
    // allocation falls through to `undistributed` (never counted as residual).
    if (totalShares > 0n) {
      filledPlaceAllocations += placeAllocationAmount;
      distributed += holderDistributed;
      residual += placeAllocationAmount - holderDistributed;
    }

    allocations.push(
      Object.freeze({
        holderResidual: fantasyMoney(
          totalShares > 0n ? placeAllocationAmount - holderDistributed : 0n,
        ),
        holderRewards: Object.freeze(holderRewards),
        place: placement.place,
        placeAllocation: fantasyMoney(totalShares > 0n ? placeAllocationAmount : 0n),
        placeBasisPoints: placeBasisPoints.toString(),
        playerId: placement.playerId,
        position: placement.position,
      }),
    );
  }

  const undistributed = prizePoolAmount - filledPlaceAllocations;

  // Conservation invariant: every minor unit of the prize pool is accounted for as
  // either distributed to a holder, held back as holder-level floor dust (residual),
  // or left undistributed (place-level floor remainder + unfilled/ineligible places).
  if (distributed + residual + undistributed !== prizePoolAmount) {
    throw contractError('INVALID_INPUT', 'Fantasy payout failed its conservation invariant');
  }

  const canonical = {
    allocations: Object.freeze(allocations),
    calculatorVersion: FANTASY_PAYOUT_VERSION,
    currency: 'USDC' as const,
    decimals: 6 as const,
    distributed: fantasyMoney(distributed),
    prizePool,
    residual: fantasyMoney(residual),
    rounding: 'floor' as const,
    rulesHash: rules.rulesHash,
    rulesVersion: rules.rulesVersion,
    sport: rules.sport,
    undistributed: fantasyMoney(undistributed),
  };

  return Object.freeze({
    ...canonical,
    calculationHash: sha256(stableStringify(canonical)),
  });
}

function distributeToHolders(
  holders: readonly FantasyPayoutHolder[] | undefined,
  placeAllocationAmount: bigint,
): { holderDistributed: bigint; holderRewards: FantasyHolderReward[]; totalShares: bigint } {
  if (!Array.isArray(holders)) {
    throw contractError('INVALID_INPUT', 'Fantasy payout placement holders must be an array');
  }
  if (holders.length > MAX_HOLDERS_PER_PLACE) {
    throw contractError('INVALID_INPUT', 'Fantasy payout placement exceeds the holder bound');
  }

  const parsed: { eligibleShares: bigint; walletAddress: string }[] = [];
  const seenWallets = new Set<string>();
  let totalShares = 0n;

  for (const holder of holders) {
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) {
      throw contractError('INVALID_INPUT', 'Fantasy payout holder is invalid');
    }
    if (
      typeof holder.walletAddress !== 'string' ||
      !FANTASY_SOLANA_ADDRESS_PATTERN.test(holder.walletAddress)
    ) {
      throw contractError('INVALID_INPUT', 'Fantasy payout holder wallet address is invalid');
    }
    if (seenWallets.has(holder.walletAddress)) {
      throw contractError(
        'INVALID_INPUT',
        'Fantasy payout holder wallets must be unique per place',
      );
    }
    seenWallets.add(holder.walletAddress);
    const eligibleShares = parseUnsignedAmount(holder.eligibleShares, 'holder eligible shares');
    totalShares += eligibleShares;
    parsed.push({ eligibleShares, walletAddress: holder.walletAddress });
  }

  const holderRewards: FantasyHolderReward[] = [];
  let holderDistributed = 0n;

  for (const holder of parsed) {
    const reward =
      totalShares > 0n ? (placeAllocationAmount * holder.eligibleShares) / totalShares : 0n;
    holderDistributed += reward;
    holderRewards.push(
      Object.freeze({
        eligibleShares: holder.eligibleShares.toString(),
        reward: fantasyMoney(reward),
        walletAddress: holder.walletAddress,
      }),
    );
  }

  return { holderDistributed, holderRewards, totalShares };
}

function parseBasisPoints(value: unknown): bigint {
  if (typeof value !== 'string' || !FANTASY_UNSIGNED_INTEGER_PATTERN.test(value)) {
    throw contractError(
      'INVALID_RULES',
      'Fantasy payout place basis points must be an unsigned integer',
    );
  }
  const bps = BigInt(value);
  if (bps > MAX_PLACE_BASIS_POINTS) {
    throw contractError('INVALID_RULES', 'Fantasy payout place basis points exceed 10000');
  }
  return bps;
}

function parseUnsignedAmount(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !FANTASY_UNSIGNED_INTEGER_PATTERN.test(value)) {
    throw contractError(
      'INVALID_INPUT',
      `Fantasy payout ${field} must be an unsigned integer string`,
    );
  }
  const amount = BigInt(value);
  if (amount > MAX_MONEY_AMOUNT) {
    throw contractError('INVALID_INPUT', `Fantasy payout ${field} exceeds the configured bound`);
  }
  return amount;
}

function parseMoney(value: unknown, field: string): Money {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError('INVALID_INPUT', `Fantasy payout ${field} must be a Money object`);
  }
  const money = value as Partial<Money>;
  if (money.currency !== 'USDC' || money.decimals !== 6) {
    throw contractError('INVALID_INPUT', `Fantasy payout ${field} must be USDC with 6 decimals`);
  }
  const amount = parseUnsignedAmount(money.amount, `${field} amount`);
  return fantasyMoney(amount);
}

function contractError(code: FantasyPayoutErrorCode, message: string): FantasyPayoutContractError {
  return new FantasyPayoutContractError(code, message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
