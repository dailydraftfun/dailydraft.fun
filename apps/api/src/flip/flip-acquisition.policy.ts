import { createHash } from 'node:crypto';

export const FLIP_ACQUISITION_POLICY_SCHEMA_VERSION =
  'dailydraft.flip-acquisition-policy.v1' as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const EXACT_BRANCHES = new Set(['refund', 'reselection', 'substitute']);

export type FlipAcquisitionRecoveryBranch = 'refund' | 'reselection' | 'substitute';

export interface FlipAcquisitionFailureBranch {
  branch: FlipAcquisitionRecoveryBranch;
  failureCode: string;
}

export interface UnsignedFlipAcquisitionPolicy {
  activation: 'fixture-only';
  failureBranches: readonly FlipAcquisitionFailureBranch[];
  houseInventoryCustodyReference: string;
  network: 'solana-devnet';
  policyVersion: string;
  provider: 'fixture-marketplace';
  providerSourceCustodyReference: string;
  reviewReference: string;
  reviewedAt: string;
  rulesHash: string;
  rulesVersion: number;
  schemaVersion: typeof FLIP_ACQUISITION_POLICY_SCHEMA_VERSION;
}

export interface FlipAcquisitionPolicy extends UnsignedFlipAcquisitionPolicy {
  policyHash: string;
}

export function validateFlipAcquisitionPolicy(value: unknown): FlipAcquisitionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Reviewed Flip acquisition policy is required');
  }
  const policy = value as Partial<FlipAcquisitionPolicy>;
  if (
    policy.schemaVersion !== FLIP_ACQUISITION_POLICY_SCHEMA_VERSION ||
    policy.activation !== 'fixture-only' ||
    policy.network !== 'solana-devnet' ||
    policy.provider !== 'fixture-marketplace' ||
    !validIdentifier(policy.policyVersion) ||
    !validIdentifier(policy.providerSourceCustodyReference) ||
    !validIdentifier(policy.houseInventoryCustodyReference) ||
    !validIdentifier(policy.reviewReference) ||
    !Number.isInteger(policy.rulesVersion) ||
    Number(policy.rulesVersion) < 1 ||
    typeof policy.rulesHash !== 'string' ||
    !HASH_PATTERN.test(policy.rulesHash) ||
    typeof policy.policyHash !== 'string' ||
    !HASH_PATTERN.test(policy.policyHash)
  ) {
    throw new Error('Flip acquisition policy binding is invalid');
  }
  const reviewedAt = new Date(String(policy.reviewedAt));
  if (!Number.isFinite(reviewedAt.getTime()) || reviewedAt.toISOString() !== policy.reviewedAt) {
    throw new Error('Flip acquisition policy review timestamp is invalid');
  }
  if (!Array.isArray(policy.failureBranches) || policy.failureBranches.length !== 3) {
    throw new Error('Flip acquisition policy must review exactly three recovery branches');
  }
  const codes = new Set<string>();
  const branches = new Set<string>();
  const failureBranches = policy.failureBranches.map((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      !FAILURE_CODE_PATTERN.test(candidate.failureCode) ||
      !EXACT_BRANCHES.has(candidate.branch) ||
      codes.has(candidate.failureCode) ||
      branches.has(candidate.branch)
    ) {
      throw new Error('Flip acquisition recovery branch is invalid or duplicated');
    }
    codes.add(candidate.failureCode);
    branches.add(candidate.branch);
    return Object.freeze({ branch: candidate.branch, failureCode: candidate.failureCode });
  });
  const unsigned = Object.freeze({
    activation: 'fixture-only' as const,
    failureBranches: Object.freeze(failureBranches),
    houseInventoryCustodyReference: String(policy.houseInventoryCustodyReference),
    network: 'solana-devnet' as const,
    policyVersion: String(policy.policyVersion),
    provider: 'fixture-marketplace' as const,
    providerSourceCustodyReference: String(policy.providerSourceCustodyReference),
    reviewReference: String(policy.reviewReference),
    reviewedAt: reviewedAt.toISOString(),
    rulesHash: policy.rulesHash,
    rulesVersion: Number(policy.rulesVersion),
    schemaVersion: FLIP_ACQUISITION_POLICY_SCHEMA_VERSION,
  });
  if (hashFlipAcquisitionPolicy(unsigned) !== policy.policyHash) {
    throw new Error('Flip acquisition policy hash does not match its canonical fields');
  }
  return Object.freeze({ ...unsigned, policyHash: policy.policyHash });
}

export function hashFlipAcquisitionPolicy(policy: UnsignedFlipAcquisitionPolicy): string {
  return sha256(canonicalFlipAcquisitionStringify(policy));
}

/**
 * Acquisition evidence is verified independently by Postgres. ASCII key
 * ordering deliberately matches the database canonical JSON function instead
 * of locale-sensitive application sorting.
 */
export function canonicalFlipAcquisitionStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalFlipAcquisitionStringify).join(',')}]`;
  }
  const entries = Object.entries(value).sort();
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalFlipAcquisitionStringify(item)}`)
    .join(',')}}`;
}

export function createFixtureFlipAcquisitionPolicy(input: {
  rulesHash: string;
  rulesVersion: number;
}): FlipAcquisitionPolicy {
  const unsigned = Object.freeze({
    activation: 'fixture-only',
    failureBranches: Object.freeze([
      Object.freeze({ branch: 'refund', failureCode: 'PROVIDER_REJECTED' }),
      Object.freeze({ branch: 'reselection', failureCode: 'SELECTED_ASSET_UNAVAILABLE' }),
      Object.freeze({ branch: 'substitute', failureCode: 'APPROVED_SUBSTITUTE_REQUIRED' }),
    ]),
    houseInventoryCustodyReference: 'fixture-wallet:flip-house-inventory',
    network: 'solana-devnet',
    policyVersion: 'flip-acquisition-fixture-v1',
    provider: 'fixture-marketplace',
    providerSourceCustodyReference: 'fixture-wallet:flip-provider-custody',
    reviewReference: 'fixture-review/flip-acquisition-v1',
    reviewedAt: '2026-08-03T12:01:30.000Z',
    rulesHash: input.rulesHash,
    rulesVersion: input.rulesVersion,
    schemaVersion: FLIP_ACQUISITION_POLICY_SCHEMA_VERSION,
  } as const satisfies UnsignedFlipAcquisitionPolicy);
  return Object.freeze({ ...unsigned, policyHash: hashFlipAcquisitionPolicy(unsigned) });
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
