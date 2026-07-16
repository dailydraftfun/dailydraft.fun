import { createHash } from 'node:crypto';
import { BadGatewayException } from '@nestjs/common';

import type { Money, PackProviderMode } from '../domain.js';
import type { DuelSide, ProviderCardResult } from './pack-provider.js';
import {
  CANONICAL_VALUATION_POLICY,
  DEVNET_DEMO_VALUATION_POLICY_HASH,
  requireCanonicalValuationPolicyHash,
  stableStringify,
  valuationPolicyForHash,
} from './valuation-policy.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const POOL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const MAX_CANONICAL_INSURED_VALUE = BigInt(CANONICAL_VALUATION_POLICY.maxValueMinorUnits);

export interface NormalizedPackOutcome {
  assetReference: string;
  displayName: string;
  imageUrl?: string;
  insuredValue: Money;
  openedAt: string;
  poolVersion: string;
  providerReference: string;
  resultHash: string;
  side: DuelSide;
  sourceTimestamp: string;
  valuationSourceReference?: string;
  valuationPolicyHash: string;
}

export interface ComparedPackOutcomes {
  comparisonMetric: 'insured-value';
  poolVersion: string;
  resultHash: string;
  tieRule: typeof CANONICAL_VALUATION_POLICY.tieRule;
  valuationPolicyHash: string;
  winnerSide: DuelSide | null;
}

export interface PackComparisonContext {
  creatorWallet: string;
  duelId: string;
  escrowAddress: string;
  network: 'solana-devnet' | 'solana-mainnet';
  opponentWallet: string;
  providerMode: PackProviderMode;
  valuationPolicyHash: string;
}

export function normalizeProviderResult(
  side: DuelSide,
  result: ProviderCardResult,
  expectedPolicyHash: string,
  providerReferenceInput: string,
  openedAt = new Date(),
): NormalizedPackOutcome {
  requireCanonicalValuationPolicyHash(expectedPolicyHash);
  const assetReference = normalizeText(result.assetReference, 'assetReference', 200);
  const displayName = normalizeText(result.displayName, 'displayName', 160);
  const imageUrl = normalizeOptionalHttpsUrl(result.imageUrl);
  const providerInsuredValue = result.insuredValue as Partial<Money> | undefined;
  if (
    !providerInsuredValue ||
    providerInsuredValue.currency !== 'USDC' ||
    providerInsuredValue.decimals !== 6 ||
    typeof providerInsuredValue.amount !== 'string' ||
    !UNSIGNED_INTEGER_PATTERN.test(providerInsuredValue.amount)
  ) {
    throw new BadGatewayException('Provider returned an unsupported insured-value format');
  }
  if (!SHA256_PATTERN.test(result.valuationPolicyHash)) {
    throw new BadGatewayException('Provider returned an invalid valuation policy hash');
  }
  if (result.valuationPolicyHash !== expectedPolicyHash) {
    throw new BadGatewayException('Provider result does not match the funded valuation policy');
  }
  const amount = BigInt(providerInsuredValue.amount);
  if (amount > MAX_CANONICAL_INSURED_VALUE) {
    throw new BadGatewayException('Provider insured value exceeds the escrow u64 limit');
  }
  const poolVersion = normalizeText(result.poolVersion, 'poolVersion', 128);
  if (!POOL_VERSION_PATTERN.test(poolVersion)) {
    throw new BadGatewayException('Provider returned an invalid poolVersion');
  }
  const canonicalOpenedAt = canonicalOpeningTimestamp(openedAt);
  const sourceTimestamp = normalizeSourceTimestamp(
    result.sourceTimestamp,
    openedAt,
    expectedPolicyHash,
  );
  const providerReference = normalizeText(providerReferenceInput, 'providerReference', 200);
  const valuationSourceReference = normalizeOptionalText(
    result.valuationSourceReference,
    'valuationSourceReference',
    200,
  );
  if (expectedPolicyHash === DEVNET_DEMO_VALUATION_POLICY_HASH && !valuationSourceReference) {
    throw new BadGatewayException('Demo provider result lacks its exact valuation source');
  }

  const insuredValue: Money = {
    amount: amount.toString(),
    currency: 'USDC',
    decimals: 6,
  };
  const canonical = {
    assetReference,
    displayName,
    ...(imageUrl ? { imageUrl } : {}),
    insuredValue,
    openedAt: canonicalOpenedAt,
    poolVersion,
    providerReference,
    side,
    sourceTimestamp,
    ...(valuationSourceReference ? { valuationSourceReference } : {}),
    valuationPolicyHash: result.valuationPolicyHash,
  };

  return {
    ...canonical,
    resultHash: sha256(stableStringify(canonical)),
  };
}

export function compareInsuredValues(
  creator: NormalizedPackOutcome,
  opponent: NormalizedPackOutcome,
  context: PackComparisonContext,
): ComparedPackOutcomes {
  assertNormalizedOutcome(creator);
  assertNormalizedOutcome(opponent);
  if (creator.side !== 'creator' || opponent.side !== 'opponent') {
    throw new Error('Pack outcomes must be compared in creator/opponent order');
  }
  if (creator.valuationPolicyHash !== opponent.valuationPolicyHash) {
    throw new BadGatewayException('Pack outcomes use different valuation policies');
  }
  if (
    creator.valuationPolicyHash !== context.valuationPolicyHash ||
    opponent.valuationPolicyHash !== context.valuationPolicyHash
  ) {
    throw new BadGatewayException('Pack outcomes do not match the funded valuation policy');
  }
  requireCanonicalValuationPolicyHash(context.valuationPolicyHash);
  if (creator.poolVersion !== opponent.poolVersion) {
    throw new BadGatewayException('Pack outcomes use different provider pool versions');
  }

  const creatorValue = BigInt(creator.insuredValue.amount);
  const opponentValue = BigInt(opponent.insuredValue.amount);
  const winnerSide =
    creatorValue === opponentValue ? null : creatorValue > opponentValue ? 'creator' : 'opponent';
  const canonical = {
    comparisonMetric: 'insured-value' as const,
    context,
    creatorResultHash: creator.resultHash,
    opponentResultHash: opponent.resultHash,
    poolVersion: creator.poolVersion,
    tieRule: CANONICAL_VALUATION_POLICY.tieRule,
    valuationPolicyHash: creator.valuationPolicyHash,
    winnerSide,
  };
  return {
    comparisonMetric: 'insured-value',
    poolVersion: creator.poolVersion,
    resultHash: sha256(stableStringify(canonical)),
    tieRule: CANONICAL_VALUATION_POLICY.tieRule,
    valuationPolicyHash: creator.valuationPolicyHash,
    winnerSide,
  };
}

function normalizeSourceTimestamp(
  value: unknown,
  observedAt: Date,
  valuationPolicyHash: string,
): string {
  const sourceAt = canonicalTimestamp(value);
  const valuationPolicy = valuationPolicyForHash(valuationPolicyHash);
  const ageMs = observedAt.getTime() - sourceAt.getTime();
  if (ageMs > valuationPolicy.maxSourceAgeSeconds * 1_000) {
    throw new BadGatewayException('Provider insured value is stale');
  }
  if (ageMs < -valuationPolicy.maxFutureSkewSeconds * 1_000) {
    throw new BadGatewayException('Provider insured value timestamp is in the future');
  }
  return value as string;
}

export function assertNormalizedOutcome(outcome: NormalizedPackOutcome): void {
  if (
    normalizeText(outcome.assetReference, 'assetReference', 200) !== outcome.assetReference ||
    normalizeText(outcome.displayName, 'displayName', 160) !== outcome.displayName ||
    normalizeOptionalHttpsUrl(outcome.imageUrl) !== outcome.imageUrl ||
    normalizeOptionalText(outcome.valuationSourceReference, 'valuationSourceReference', 200) !==
      outcome.valuationSourceReference ||
    normalizeText(outcome.providerReference, 'providerReference', 200) !==
      outcome.providerReference ||
    !POOL_VERSION_PATTERN.test(outcome.poolVersion) ||
    outcome.insuredValue.currency !== CANONICAL_VALUATION_POLICY.currency ||
    outcome.insuredValue.decimals !== CANONICAL_VALUATION_POLICY.decimals ||
    !UNSIGNED_INTEGER_PATTERN.test(outcome.insuredValue.amount) ||
    BigInt(outcome.insuredValue.amount) > MAX_CANONICAL_INSURED_VALUE
  ) {
    throw new BadGatewayException('Pack outcome is not canonical');
  }
  if (
    outcome.valuationPolicyHash === DEVNET_DEMO_VALUATION_POLICY_HASH &&
    !outcome.valuationSourceReference
  ) {
    throw new BadGatewayException('Demo pack outcome lacks its exact valuation source');
  }
  canonicalTimestamp(outcome.sourceTimestamp);
  canonicalTimestamp(outcome.openedAt, 'openedAt');
  const canonical = {
    assetReference: outcome.assetReference,
    displayName: outcome.displayName,
    ...(outcome.imageUrl ? { imageUrl: outcome.imageUrl } : {}),
    insuredValue: outcome.insuredValue,
    openedAt: outcome.openedAt,
    poolVersion: outcome.poolVersion,
    providerReference: outcome.providerReference,
    side: outcome.side,
    sourceTimestamp: outcome.sourceTimestamp,
    ...(outcome.valuationSourceReference
      ? { valuationSourceReference: outcome.valuationSourceReference }
      : {}),
    valuationPolicyHash: outcome.valuationPolicyHash,
  };
  if (sha256(stableStringify(canonical)) !== outcome.resultHash) {
    throw new BadGatewayException('Pack outcome result hash does not match its proof inputs');
  }
}

function canonicalTimestamp(value: unknown, field = 'sourceTimestamp'): Date {
  if (typeof value !== 'string') {
    throw new BadGatewayException(`Provider returned an invalid ${field}`);
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new BadGatewayException(`Provider returned an invalid ${field}`);
  }
  return timestamp;
}

function canonicalOpeningTimestamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new BadGatewayException('Provider opening time is invalid');
  }
  return value.toISOString();
}

function normalizeOptionalHttpsUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 500) {
    throw new BadGatewayException('Provider returned an invalid imageUrl');
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('image URL must use HTTPS');
    return url.toString();
  } catch {
    throw new BadGatewayException('Provider returned an invalid imageUrl');
  }
}

function normalizeOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return normalizeText(value, field, maxLength);
}

function normalizeText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new BadGatewayException(`Provider returned an invalid ${field}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw new BadGatewayException(`Provider returned an invalid ${field}`);
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
