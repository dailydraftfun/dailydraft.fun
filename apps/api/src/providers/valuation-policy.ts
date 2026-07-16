import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';

export const CANONICAL_VALUATION_POLICY = Object.freeze({
  authoritativeField: 'collector-crypt.gacha.result.insuredValue',
  comparisonMetric: 'insured-value',
  currency: 'USDC',
  decimals: 6,
  maxFutureSkewSeconds: 30,
  maxSourceAgeSeconds: 300,
  maxValueMinorUnits: '18446744073709551615',
  numericRepresentation: 'unsigned-integer-minor-units',
  policyVersion: 'collector-crypt-insured-value-usdc-v1',
  providerCorrectionRule: 'immutable-after-result-commit-dispute-or-refund',
  rounding: 'none',
  schemaVersion: 'openpacksduel.valuation-policy.v1',
  tieRule: 'return-original-assets-and-refund-platform-fees',
} as const);

export type CanonicalValuationPolicy = typeof CANONICAL_VALUATION_POLICY;

export const CANONICAL_VALUATION_POLICY_HASH =
  '406b8f93087ba9910d74006cef30fb7872dcabd763e99215488f06f119b8d66b';

const calculatedPolicyHash = createHash('sha256')
  .update(stableStringify(CANONICAL_VALUATION_POLICY))
  .digest('hex');

if (calculatedPolicyHash !== CANONICAL_VALUATION_POLICY_HASH) {
  throw new Error('Canonical valuation policy changed without an explicit hash/version update');
}

export const DEVNET_DEMO_VALUATION_POLICY = Object.freeze({
  ...CANONICAL_VALUATION_POLICY,
  authoritativeField: 'pokemon-tcg.tcgplayer.prices.<first-supported-variant>.market',
  maxFutureSkewSeconds: 0,
  maxSourceAgeSeconds: 604800,
  policyVersion: 'openpacksduel-pokemon-tcg-market-usdc-v1',
  sourceSelection: {
    fallbackRule: 'reject-if-no-listed-variant-has-positive-market',
    priceField: 'market',
    updatedAtInterpretation: 'utc-start-of-day',
    usdToMicroUsdc: 'require-two-decimal-usd-then-multiply-by-1000000',
    variantOrder: ['holofoil', 'reverseHolofoil', 'normal', '1stEditionHolofoil'],
  },
} as const);

export const DEVNET_DEMO_VALUATION_POLICY_HASH =
  '39186a3c3b133d001d3c17dd3832b45c2286e3df81ba13494e3cef638a48baf8';

const calculatedDemoPolicyHash = createHash('sha256')
  .update(stableStringify(DEVNET_DEMO_VALUATION_POLICY))
  .digest('hex');

if (calculatedDemoPolicyHash !== DEVNET_DEMO_VALUATION_POLICY_HASH) {
  throw new Error('Devnet demo valuation policy changed without an explicit hash/version update');
}

export type SupportedValuationPolicy =
  | typeof CANONICAL_VALUATION_POLICY
  | typeof DEVNET_DEMO_VALUATION_POLICY;

export function requireCanonicalValuationPolicyHash(value: string | null | undefined): string {
  if (value !== CANONICAL_VALUATION_POLICY_HASH && value !== DEVNET_DEMO_VALUATION_POLICY_HASH) {
    throw new ConflictException('Duel valuation policy is unsupported or does not match');
  }
  return value;
}

export function valuationPolicyForHash(value: string): SupportedValuationPolicy {
  requireCanonicalValuationPolicyHash(value);
  return value === DEVNET_DEMO_VALUATION_POLICY_HASH
    ? DEVNET_DEMO_VALUATION_POLICY
    : CANONICAL_VALUATION_POLICY;
}

export function currentValuationPolicy(): {
  policy: SupportedValuationPolicy;
  policyHash: string;
} {
  return process.env.OPENPACKSDUEL_PROVIDER_MODE === 'openpacksduel-devnet'
    ? {
        policy: DEVNET_DEMO_VALUATION_POLICY,
        policyHash: DEVNET_DEMO_VALUATION_POLICY_HASH,
      }
    : { policy: CANONICAL_VALUATION_POLICY, policyHash: CANONICAL_VALUATION_POLICY_HASH };
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
