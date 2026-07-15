import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';

export const CANONICAL_VALUATION_POLICY = Object.freeze({
  authoritativeField: 'collector-crypt.gacha.result.insuredValue',
  comparisonMetric: 'insured-value',
  currency: 'USDC',
  decimals: 6,
  maxFutureSkewSeconds: 30,
  maxSourceAgeSeconds: 300,
  numericRepresentation: 'unsigned-integer-minor-units',
  policyVersion: 'collector-crypt-insured-value-usdc-v1',
  providerCorrectionRule: 'immutable-after-result-commit-dispute-or-refund',
  rounding: 'none',
  schemaVersion: 'openpacksduel.valuation-policy.v1',
  tieRule: 'return-original-assets-and-refund-platform-fees',
} as const);

export type CanonicalValuationPolicy = typeof CANONICAL_VALUATION_POLICY;

export const CANONICAL_VALUATION_POLICY_HASH =
  '82b450721996820dd88f684e5e075d828070521219cd6e4146665e4cbe247fb4';

const calculatedPolicyHash = createHash('sha256')
  .update(stableStringify(CANONICAL_VALUATION_POLICY))
  .digest('hex');

if (calculatedPolicyHash !== CANONICAL_VALUATION_POLICY_HASH) {
  throw new Error('Canonical valuation policy changed without an explicit hash/version update');
}

export function requireCanonicalValuationPolicyHash(value: string | null | undefined): string {
  if (value !== CANONICAL_VALUATION_POLICY_HASH) {
    throw new ConflictException('Duel valuation policy is unsupported or does not match');
  }
  return value;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}
