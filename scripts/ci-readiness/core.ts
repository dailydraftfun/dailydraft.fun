export const CI_READINESS_SCHEMA_VERSION = 'dailydraft.branch-protection-readiness.v1';

const REQUIRED_GATE_IDS = [
  'affected',
  'migration',
  'contract',
  'coverage',
  'journey',
  'soak',
] as const;

export interface ReadinessGate {
  applicability: string;
  checkName: string;
  id: (typeof REQUIRED_GATE_IDS)[number];
  job: string;
  requiredEvidence: string[];
  workflow: string;
  workflowName: string;
}

export interface BranchProtectionReadinessManifest {
  defaultBranch: 'main';
  emergencyBypass: {
    allowed: true;
    auditRequired: true;
    requirements: string[];
  };
  enforcement: {
    mode: 'advisory';
    reason: string;
  };
  gates: ReadinessGate[];
  pullRequestsMustBeUpToDate: true;
  schemaVersion: typeof CI_READINESS_SCHEMA_VERSION;
}

export interface ReadinessValidation {
  errors: string[];
  passed: boolean;
}

export function parseReadinessManifest(value: unknown): BranchProtectionReadinessManifest {
  if (!isObject(value)) throw new Error('readiness manifest must be an object');
  if (value.schemaVersion !== CI_READINESS_SCHEMA_VERSION) {
    throw new Error('readiness manifest schema version is unsupported');
  }
  if (
    value.defaultBranch !== 'main' ||
    value.pullRequestsMustBeUpToDate !== true ||
    !isObject(value.enforcement) ||
    value.enforcement.mode !== 'advisory' ||
    !canonicalText(value.enforcement.reason) ||
    !isObject(value.emergencyBypass) ||
    value.emergencyBypass.allowed !== true ||
    value.emergencyBypass.auditRequired !== true ||
    !canonicalTextArray(value.emergencyBypass.requirements) ||
    !Array.isArray(value.gates)
  ) {
    throw new Error('readiness manifest policy contract is invalid');
  }

  const gates = value.gates.map(parseGate);
  const ids = gates.map(({ id }) => id);
  if (
    ids.length !== REQUIRED_GATE_IDS.length ||
    new Set(ids).size !== ids.length ||
    REQUIRED_GATE_IDS.some((id) => !ids.includes(id))
  ) {
    throw new Error('readiness manifest must enumerate each required gate exactly once');
  }

  return { ...value, gates } as BranchProtectionReadinessManifest;
}

export function validateReadinessManifest(
  manifest: BranchProtectionReadinessManifest,
  workflows: ReadonlyMap<string, string>,
): ReadinessValidation {
  const errors: string[] = [];
  for (const gate of manifest.gates) {
    const source = workflows.get(gate.workflow);
    if (source === undefined) {
      errors.push(`${gate.id}: workflow ${gate.workflow} is missing`);
      continue;
    }
    const workflowName = workflowScalar(source, 'name');
    if (workflowName !== gate.workflowName) {
      errors.push(
        `${gate.id}: workflow name drifted from ${gate.workflowName} to ${workflowName ?? 'missing'}`,
      );
    }
    if (!hasJob(source, gate.job)) {
      errors.push(`${gate.id}: job ${gate.job} is missing`);
    }
    const emittedCheckName = `${workflowName ?? gate.workflowName} / ${gate.job}`;
    if (emittedCheckName !== gate.checkName) {
      errors.push(`${gate.id}: emitted check ${emittedCheckName} does not match ${gate.checkName}`);
    }
    for (const evidence of gate.requiredEvidence) {
      if (!source.includes(evidence)) {
        errors.push(`${gate.id}: required evidence command is missing: ${evidence}`);
      }
    }
  }
  return { errors, passed: errors.length === 0 };
}

function parseGate(value: unknown): ReadinessGate {
  if (!isObject(value)) throw new Error('readiness gate must be an object');
  const id = value.id;
  if (!REQUIRED_GATE_IDS.includes(id as ReadinessGate['id'])) {
    throw new Error('readiness gate id is invalid');
  }
  if (
    !canonicalText(value.applicability) ||
    !canonicalText(value.checkName) ||
    !canonicalText(value.job) ||
    !canonicalText(value.workflowName) ||
    typeof value.workflow !== 'string' ||
    !/^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(value.workflow) ||
    !canonicalTextArray(value.requiredEvidence)
  ) {
    throw new Error(`readiness gate ${String(id)} is invalid`);
  }
  return value as unknown as ReadinessGate;
}

function workflowScalar(source: string, key: string): string | null {
  const match = source.match(new RegExp(`^${key}:\\s*([^#\\n]+?)\\s*$`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function hasJob(source: string, job: string): boolean {
  const jobsIndex = source.search(/^jobs:\s*$/m);
  if (jobsIndex < 0) return false;
  return new RegExp(`^  ${escapeRegExp(job)}:\\s*$`, 'm').test(source.slice(jobsIndex));
}

function canonicalText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function canonicalTextArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(canonicalText);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
