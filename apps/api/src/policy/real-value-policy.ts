import { createHash } from 'node:crypto';

export const REAL_VALUE_POLICY_SCHEMA_VERSION = 'dailydraft.real-value-policy.v1';
export const NON_PRODUCTION_POLICY_VERSION = 'dailydraft.non-production-policy.v1';

export const REAL_VALUE_CAPABILITIES = [
  'duel.create.direct',
  'duel.create.house',
  'duel.create.open',
  'duel.funding.prepare',
  'duel.join',
  'duel.pack.open',
  'matchmaking.house-fallback',
  'matchmaking.search',
  'provider.escrow.prepare',
] as const;

export type RealValueCapability = (typeof REAL_VALUE_CAPABILITIES)[number];
export type RealValueRuntimeMode = 'devnet' | 'fixture' | 'production' | 'unclassified';

export type RealValuePolicyDenialReason =
  | 'age_policy_missing'
  | 'capability_configuration_missing'
  | 'capability_disabled'
  | 'disclosure_policy_missing'
  | 'jurisdiction_policy_missing'
  | 'legal_approval_missing'
  | 'limits_policy_missing'
  | 'policy_malformed'
  | 'policy_missing'
  | 'policy_schema_unsupported'
  | 'policy_version_missing'
  | 'production_approval_missing'
  | 'runtime_unclassified'
  | 'sanctions_policy_missing';

export const REAL_VALUE_POLICY_DENIAL_MESSAGES: Record<RealValuePolicyDenialReason, string> = {
  age_policy_missing: 'Real-value admission is disabled: age policy evidence is missing',
  capability_configuration_missing:
    'Real-value admission is disabled: capability configuration is missing',
  capability_disabled: 'Real-value admission is disabled for this capability',
  disclosure_policy_missing:
    'Real-value admission is disabled: disclosure policy evidence is missing',
  jurisdiction_policy_missing:
    'Real-value admission is disabled: jurisdiction policy evidence is missing',
  legal_approval_missing: 'Real-value admission is disabled: legal approval is missing',
  limits_policy_missing: 'Real-value admission is disabled: limits policy evidence is missing',
  policy_malformed: 'Real-value admission is disabled: policy configuration is malformed',
  policy_missing: 'Real-value admission is disabled: policy configuration is missing',
  policy_schema_unsupported: 'Real-value admission is disabled: policy schema is unsupported',
  policy_version_missing: 'Real-value admission is disabled: policy version is missing',
  production_approval_missing: 'Real-value admission is disabled: production approval is missing',
  runtime_unclassified: 'Real-value admission is disabled: runtime is unclassified',
  sanctions_policy_missing:
    'Real-value admission is disabled: sanctions policy evidence is missing',
};

const APPROVAL_KEYS = [
  'age',
  'disclosure',
  'jurisdiction',
  'legal',
  'limits',
  'production',
  'sanctions',
] as const;

type RealValueApprovalKey = (typeof APPROVAL_KEYS)[number];
type RealValueApprovalEvidence = Record<RealValueApprovalKey, string>;

export interface RealValuePolicyDocument {
  approvals: RealValueApprovalEvidence;
  capabilities: RealValueCapability[];
  policyVersion: string;
  schemaVersion: typeof REAL_VALUE_POLICY_SCHEMA_VERSION;
}

export interface RealValuePolicyEvidence {
  approvalEvidence: RealValueApprovalEvidence | null;
  configuredCapabilities: RealValueCapability[];
  configurationPresent: boolean;
  configurationValid: boolean;
  network: string | null;
  productionEnabled: boolean;
  providerMode: string | null;
  runtimeMode: RealValueRuntimeMode;
  schemaVersion: typeof REAL_VALUE_POLICY_SCHEMA_VERSION;
}

export type RealValuePolicyDecision =
  | {
      allowed: true;
      capability: RealValueCapability;
      denialReason: null;
      evidence: RealValuePolicyEvidence;
      policyHash: string;
      policyVersion: string;
      runtimeMode: Exclude<RealValueRuntimeMode, 'unclassified'>;
    }
  | {
      allowed: false;
      capability: RealValueCapability;
      denialReason: RealValuePolicyDenialReason;
      evidence: RealValuePolicyEvidence;
      policyHash: string;
      policyVersion: string;
      runtimeMode: RealValueRuntimeMode;
    };

const NON_PRODUCTION_POLICY = Object.freeze({
  capabilities: REAL_VALUE_CAPABILITIES,
  policyVersion: NON_PRODUCTION_POLICY_VERSION,
  productionApproved: false,
  runtimeModes: ['fixture', 'devnet'],
  schemaVersion: REAL_VALUE_POLICY_SCHEMA_VERSION,
});

// Repinned for the DailyDraft rename. Unlike the valuation policy hash, this
// one is an audit field on RealValuePolicyDecision that nothing compares
// against, and the schemaVersion it covers is pinned by a CHECK constraint that
// the 20260725120000_rebrand_dailydraft migration rewrites, so the constant has
// to move with the identifiers rather than hold them back.
export const NON_PRODUCTION_POLICY_HASH =
  '2a652daea4b85b74f975caf1e5e65257ec2306676922983d8d8f1f6401eb0402';

if (sha256(canonicalJson(NON_PRODUCTION_POLICY)) !== NON_PRODUCTION_POLICY_HASH) {
  throw new Error('Non-production policy changed without an explicit hash/version update');
}

export function evaluateRealValuePolicy(
  capability: RealValueCapability,
  environment: NodeJS.ProcessEnv = process.env,
): RealValuePolicyDecision {
  const runtimeMode = resolveRealValueRuntime(environment);
  const rawPolicy = environment.DAILYDRAFT_REAL_VALUE_POLICY_JSON?.trim();
  const parsedPolicy = rawPolicy ? parseRealValuePolicy(rawPolicy) : null;
  const baseEvidence = {
    configurationPresent: Boolean(rawPolicy),
    network: normalized(environment.DAILYDRAFT_NETWORK),
    productionEnabled: environment.DAILYDRAFT_REAL_VALUE_PRODUCTION_ENABLED === 'true',
    providerMode: normalized(environment.DAILYDRAFT_PROVIDER_MODE),
    runtimeMode,
    schemaVersion: REAL_VALUE_POLICY_SCHEMA_VERSION,
  } as const;

  if (parsedPolicy && !parsedPolicy.ok) {
    return deniedDecision({
      capability,
      denialReason: parsedPolicy.reason,
      evidence: {
        ...baseEvidence,
        approvalEvidence: null,
        configuredCapabilities: [],
        configurationValid: false,
      },
      policyHash: sha256(rawPolicy ?? 'missing'),
      runtimeMode,
    });
  }

  if (runtimeMode === 'unclassified') {
    return deniedDecision({
      capability,
      denialReason: 'runtime_unclassified',
      evidence: {
        ...baseEvidence,
        approvalEvidence: parsedPolicy?.document.approvals ?? null,
        configuredCapabilities: parsedPolicy?.document.capabilities ?? [],
        configurationValid: parsedPolicy?.ok ?? false,
      },
      policyHash: parsedPolicy?.policyHash ?? sha256(rawPolicy ?? 'missing'),
      ...(parsedPolicy ? { policyVersion: parsedPolicy.document.policyVersion } : {}),
      runtimeMode,
    });
  }

  if (runtimeMode !== 'production') {
    return {
      allowed: true,
      capability,
      denialReason: null,
      evidence: {
        ...baseEvidence,
        approvalEvidence: null,
        configuredCapabilities: [],
        configurationValid: parsedPolicy?.ok ?? !rawPolicy,
        productionEnabled: false,
      },
      policyHash: NON_PRODUCTION_POLICY_HASH,
      policyVersion: NON_PRODUCTION_POLICY_VERSION,
      runtimeMode,
    };
  }

  if (!rawPolicy || !parsedPolicy) {
    return deniedDecision({
      capability,
      denialReason: 'policy_missing',
      evidence: {
        ...baseEvidence,
        approvalEvidence: null,
        configuredCapabilities: [],
        configurationValid: false,
      },
      policyHash: sha256('missing'),
      runtimeMode,
    });
  }
  if (environment.DAILYDRAFT_REAL_VALUE_PRODUCTION_ENABLED !== 'true') {
    return deniedProductionDecision(
      capability,
      'production_approval_missing',
      parsedPolicy,
      baseEvidence,
    );
  }
  if (!parsedPolicy.document.capabilities.includes(capability)) {
    return deniedProductionDecision(capability, 'capability_disabled', parsedPolicy, baseEvidence);
  }

  return {
    allowed: true,
    capability,
    denialReason: null,
    evidence: {
      ...baseEvidence,
      approvalEvidence: parsedPolicy.document.approvals,
      configuredCapabilities: parsedPolicy.document.capabilities,
      configurationValid: true,
    },
    policyHash: parsedPolicy.policyHash,
    policyVersion: parsedPolicy.document.policyVersion,
    runtimeMode,
  };
}

export function resolveRealValueRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): RealValueRuntimeMode {
  const explicit = environment.DAILYDRAFT_REAL_VALUE_MODE?.trim();
  if (explicit && explicit !== 'true' && explicit !== 'false') return 'unclassified';
  if (
    explicit === 'true' ||
    environment.DAILYDRAFT_NETWORK === 'solana-mainnet' ||
    environment.DAILYDRAFT_PROVIDER_MODE === 'collector-crypt-production'
  ) {
    return 'production';
  }
  if (
    environment.NODE_ENV === 'test' ||
    environment.NODE_ENV === 'development' ||
    environment.DAILYDRAFT_PROVIDER_MODE === 'mock'
  ) {
    return 'fixture';
  }
  if (
    environment.DAILYDRAFT_NETWORK === 'solana-devnet' ||
    environment.DAILYDRAFT_PROVIDER_MODE === 'dailydraft-devnet' ||
    environment.DAILYDRAFT_PROVIDER_MODE === 'collector-crypt-sandbox'
  ) {
    return 'devnet';
  }
  return 'unclassified';
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Policy contains a non-JSON value');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

type ParsedPolicy =
  | { document: RealValuePolicyDocument; ok: true; policyHash: string }
  | { ok: false; reason: RealValuePolicyDenialReason };

function parseRealValuePolicy(rawPolicy: string): ParsedPolicy {
  let value: unknown;
  try {
    value = JSON.parse(rawPolicy);
  } catch {
    return { ok: false, reason: 'policy_malformed' };
  }
  if (!isRecord(value)) return { ok: false, reason: 'policy_malformed' };
  if (value.schemaVersion !== REAL_VALUE_POLICY_SCHEMA_VERSION) {
    return { ok: false, reason: 'policy_schema_unsupported' };
  }
  if (!isReference(value.policyVersion)) {
    return { ok: false, reason: 'policy_version_missing' };
  }
  const approvals = value.approvals;
  if (!isRecord(approvals)) {
    return { ok: false, reason: 'legal_approval_missing' };
  }
  for (const key of APPROVAL_KEYS) {
    if (!isReference(approvals[key])) {
      return { ok: false, reason: approvalDenialReason(key) };
    }
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    return { ok: false, reason: 'capability_configuration_missing' };
  }
  if (
    value.capabilities.some(
      (capability) =>
        typeof capability !== 'string' ||
        !REAL_VALUE_CAPABILITIES.includes(capability as RealValueCapability),
    )
  ) {
    return { ok: false, reason: 'policy_malformed' };
  }
  const capabilities = [...new Set(value.capabilities as RealValueCapability[])].sort();
  const document: RealValuePolicyDocument = {
    approvals: Object.fromEntries(
      APPROVAL_KEYS.map((key) => [key, approvals[key] as string]),
    ) as RealValueApprovalEvidence,
    capabilities,
    policyVersion: value.policyVersion,
    schemaVersion: REAL_VALUE_POLICY_SCHEMA_VERSION,
  };
  return { document, ok: true, policyHash: sha256(canonicalJson(document)) };
}

function deniedProductionDecision(
  capability: RealValueCapability,
  denialReason: RealValuePolicyDenialReason,
  parsedPolicy: Extract<ParsedPolicy, { ok: true }>,
  baseEvidence: Omit<
    RealValuePolicyEvidence,
    'approvalEvidence' | 'configuredCapabilities' | 'configurationValid'
  >,
): RealValuePolicyDecision {
  return deniedDecision({
    capability,
    denialReason,
    evidence: {
      ...baseEvidence,
      approvalEvidence: parsedPolicy.document.approvals,
      configuredCapabilities: parsedPolicy.document.capabilities,
      configurationValid: true,
    },
    policyHash: parsedPolicy.policyHash,
    policyVersion: parsedPolicy.document.policyVersion,
    runtimeMode: 'production',
  });
}

function deniedDecision(input: {
  capability: RealValueCapability;
  denialReason: RealValuePolicyDenialReason;
  evidence: RealValuePolicyEvidence;
  policyHash: string;
  policyVersion?: string;
  runtimeMode: RealValueRuntimeMode;
}): RealValuePolicyDecision {
  return {
    allowed: false,
    capability: input.capability,
    denialReason: input.denialReason,
    evidence: input.evidence,
    policyHash: input.policyHash,
    policyVersion: input.policyVersion ?? 'unresolved',
    runtimeMode: input.runtimeMode,
  };
}

function approvalDenialReason(key: RealValueApprovalKey): RealValuePolicyDenialReason {
  const reasons: Record<RealValueApprovalKey, RealValuePolicyDenialReason> = {
    age: 'age_policy_missing',
    disclosure: 'disclosure_policy_missing',
    jurisdiction: 'jurisdiction_policy_missing',
    legal: 'legal_approval_missing',
    limits: 'limits_policy_missing',
    production: 'production_approval_missing',
    sanctions: 'sanctions_policy_missing',
  };
  return reasons[key];
}

function isReference(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalized(value: string | undefined): string | null {
  return value?.trim() || null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
