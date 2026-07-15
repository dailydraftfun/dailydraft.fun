import { createHash } from 'node:crypto';
import { BadGatewayException } from '@nestjs/common';

import type { Money } from '../domain.js';
import type { DuelSide, ProviderCardResult } from './pack-provider.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

export interface NormalizedPackOutcome {
  assetReference: string;
  displayName: string;
  insuredValue: Money;
  resultHash: string;
  side: DuelSide;
  valuationPolicyHash: string;
}

export interface ComparedPackOutcomes {
  comparisonMetric: 'insured-value';
  resultHash: string;
  winnerSide: DuelSide | null;
}

export interface PackComparisonContext {
  creatorWallet: string;
  duelId: string;
  escrowAddress: string;
  network: 'solana-devnet' | 'solana-mainnet';
  opponentWallet: string;
  providerMode: 'collector-crypt-sandbox' | 'mock';
}

export function normalizeProviderResult(
  side: DuelSide,
  result: ProviderCardResult,
): NormalizedPackOutcome {
  const assetReference = normalizeText(result.assetReference, 'assetReference', 200);
  const displayName = normalizeText(result.displayName, 'displayName', 160);
  if (
    result.insuredValue.currency !== 'USDC' ||
    result.insuredValue.decimals !== 6 ||
    !UNSIGNED_INTEGER_PATTERN.test(result.insuredValue.amount)
  ) {
    throw new BadGatewayException('Provider returned an unsupported insured-value format');
  }
  if (!SHA256_PATTERN.test(result.valuationPolicyHash)) {
    throw new BadGatewayException('Provider returned an invalid valuation policy hash');
  }

  const insuredValue: Money = {
    amount: BigInt(result.insuredValue.amount).toString(),
    currency: 'USDC',
    decimals: 6,
  };
  const canonical = {
    assetReference,
    displayName,
    insuredValue,
    side,
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
  if (creator.side !== 'creator' || opponent.side !== 'opponent') {
    throw new Error('Pack outcomes must be compared in creator/opponent order');
  }
  if (creator.valuationPolicyHash !== opponent.valuationPolicyHash) {
    throw new BadGatewayException('Pack outcomes use different valuation policies');
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
    valuationPolicyHash: creator.valuationPolicyHash,
    winnerSide,
  };
  return {
    comparisonMetric: 'insured-value',
    resultHash: sha256(stableStringify(canonical)),
    winnerSide,
  };
}

function normalizeText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new BadGatewayException(`Provider returned an invalid ${field}`);
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}
