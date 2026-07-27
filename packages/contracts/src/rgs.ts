import { createHash } from 'node:crypto';

export const RGS_CONTRACT_SCHEMA_VERSION = 'dailydraft.rgs-contract.v1' as const;
export const RGS_MODE_CONFIG_SCHEMA_VERSION = 'dailydraft.rgs-mode-config.v1' as const;
export const RGS_PROOF_SCHEMA_VERSION = 'dailydraft.rgs-proof.v1' as const;

export type RgsJsonPrimitive = boolean | null | number | string;
export type RgsJsonValue =
  | RgsJsonPrimitive
  | readonly RgsJsonValue[]
  | { readonly [key: string]: RgsJsonValue };

export type RgsMode = 'crash' | 'duel' | 'flip' | 'gacha';
export type RgsModeActivation = 'devnet' | 'disabled' | 'fixture-only';
export type RgsProofKind = 'external-provider' | 'seeded-sha256';
export type RgsRoundPhase = 'session' | 'committed' | 'played' | 'revealed' | 'settled' | 'failed';

export type RgsModeConfig = {
  activation: RgsModeActivation;
  calculatorVersion: string;
  configHash: string;
  contractVersion: typeof RGS_CONTRACT_SCHEMA_VERSION;
  mode: RgsMode;
  proofKind: RgsProofKind;
  realValueGate: 'hitl-required';
  rulesHash: string;
  schemaVersion: typeof RGS_MODE_CONFIG_SCHEMA_VERSION;
};

export type RgsSeedCommitment = {
  commitmentId: string;
  commitmentHash: string;
  configHash: string;
  contractVersion: typeof RGS_CONTRACT_SCHEMA_VERSION;
  mode: RgsMode;
  proofKind: 'seeded-sha256';
  rulesHash: string;
  serverSeedHash: string;
};

export type RgsSeededProof = RgsSeedCommitment & {
  clientSeed: string;
  entropyHash: string;
  phase: 'revealed' | 'settled';
  result: RgsJsonValue;
  resultHash: string;
  roundId: string;
  schemaVersion: typeof RGS_PROOF_SCHEMA_VERSION;
  serverSeed: string;
};

export type RgsExternalCommitment = {
  commitmentHash: string;
  configHash: string;
  contractVersion: typeof RGS_CONTRACT_SCHEMA_VERSION;
  mode: RgsMode;
  proofKind: 'external-provider';
  request: RgsJsonValue;
  requestHash: string;
  roundId: string;
  rulesHash: string;
};

export type RgsExternalProof = RgsExternalCommitment & {
  evidence: RgsJsonValue;
  evidenceHash: string;
  phase: 'revealed' | 'settled';
  result: RgsJsonValue;
  resultHash: string;
  schemaVersion: typeof RGS_PROOF_SCHEMA_VERSION;
};

export type RgsProof = RgsExternalProof | RgsSeededProof;

export type RgsProofVerification = {
  errors: readonly string[];
  valid: boolean;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^dailydraft\.[a-z0-9-]+\.v[1-9][0-9]*$/;

const nextPhases: Readonly<Record<RgsRoundPhase, readonly RgsRoundPhase[]>> = {
  committed: ['played', 'failed'],
  failed: [],
  played: ['revealed', 'failed'],
  revealed: ['settled', 'failed'],
  session: ['committed', 'failed'],
  settled: [],
};

function assertHash(value: string, field: string): void {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 hash`);
  }
}

function assertIdentifier(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
}

function normalizeJson(value: RgsJsonValue): RgsJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('RGS canonical JSON does not allow non-finite numbers');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry));
  }

  const object = value as { readonly [key: string]: RgsJsonValue };
  const normalized: Record<string, RgsJsonValue> = {};
  for (const key of Object.keys(object).sort()) {
    normalized[key] = normalizeJson(object[key] as RgsJsonValue);
  }
  return normalized;
}

export function canonicalRgsJson(value: RgsJsonValue): string {
  return JSON.stringify(normalizeJson(value));
}

export function hashRgsValue(value: RgsJsonValue): string {
  return createHash('sha256').update(canonicalRgsJson(value)).digest('hex');
}

export function hashRgsText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function isRgsTransitionAllowed(from: RgsRoundPhase, to: RgsRoundPhase): boolean {
  return from === to || nextPhases[from].includes(to);
}

export function assertRgsTransition(from: RgsRoundPhase, to: RgsRoundPhase): void {
  if (!isRgsTransitionAllowed(from, to)) {
    throw new Error(`RGS transition ${from} -> ${to} is not allowed`);
  }
}

export function createRgsModeConfig(input: {
  activation: RgsModeActivation;
  calculatorVersion: string;
  config: RgsJsonValue;
  mode: RgsMode;
  proofKind: RgsProofKind;
  rules: RgsJsonValue;
}): RgsModeConfig {
  assertIdentifier(input.calculatorVersion, 'calculatorVersion');
  if (!VERSION_PATTERN.test(input.calculatorVersion)) {
    throw new Error('calculatorVersion must be a versioned DailyDraft identifier');
  }
  return {
    activation: input.activation,
    calculatorVersion: input.calculatorVersion,
    configHash: hashRgsValue(input.config),
    contractVersion: RGS_CONTRACT_SCHEMA_VERSION,
    mode: input.mode,
    proofKind: input.proofKind,
    realValueGate: 'hitl-required',
    rulesHash: hashRgsValue(input.rules),
    schemaVersion: RGS_MODE_CONFIG_SCHEMA_VERSION,
  };
}

export function createRgsSeedCommitment(input: {
  commitmentId: string;
  configHash: string;
  mode: RgsMode;
  rulesHash: string;
  serverSeed: string;
}): RgsSeedCommitment {
  assertHash(input.configHash, 'configHash');
  assertHash(input.rulesHash, 'rulesHash');
  assertIdentifier(input.commitmentId, 'commitmentId');
  assertIdentifier(input.serverSeed, 'serverSeed');

  const serverSeedHash = hashRgsText(input.serverSeed);
  const commitmentPayload = {
    commitmentId: input.commitmentId,
    configHash: input.configHash,
    contractVersion: RGS_CONTRACT_SCHEMA_VERSION,
    mode: input.mode,
    proofKind: 'seeded-sha256',
    rulesHash: input.rulesHash,
    serverSeedHash,
  } as const;

  return {
    ...commitmentPayload,
    commitmentHash: hashRgsValue(commitmentPayload),
  };
}

/**
 * The v1 entropy derivation intentionally preserves the existing Gacha
 * snapshot/rules/seed byte sequence.
 */
export function deriveRgsSeededEntropy(input: {
  clientSeed: string;
  configHash: string;
  rulesHash: string;
  serverSeed: string;
}): string {
  assertHash(input.configHash, 'configHash');
  assertHash(input.rulesHash, 'rulesHash');
  assertIdentifier(input.clientSeed, 'clientSeed');
  assertIdentifier(input.serverSeed, 'serverSeed');
  return hashRgsText(
    `${input.configHash}:${input.rulesHash}:${input.serverSeed}:${input.clientSeed}`,
  );
}

export function createRgsSeededProof(input: {
  clientSeed: string;
  commitmentId: string;
  configHash: string;
  mode: RgsMode;
  phase: 'revealed' | 'settled';
  result: RgsJsonValue;
  roundId: string;
  rulesHash: string;
  serverSeed: string;
}): RgsSeededProof {
  assertIdentifier(input.roundId, 'roundId');
  const commitment = createRgsSeedCommitment(input);
  return {
    ...commitment,
    clientSeed: input.clientSeed,
    entropyHash: deriveRgsSeededEntropy(input),
    phase: input.phase,
    result: normalizeJson(input.result),
    resultHash: hashRgsValue(input.result),
    roundId: input.roundId,
    schemaVersion: RGS_PROOF_SCHEMA_VERSION,
    serverSeed: input.serverSeed,
  };
}

export function createRgsExternalCommitment(input: {
  configHash: string;
  mode: RgsMode;
  request: RgsJsonValue;
  roundId: string;
  rulesHash: string;
}): RgsExternalCommitment {
  assertHash(input.configHash, 'configHash');
  assertHash(input.rulesHash, 'rulesHash');
  assertIdentifier(input.roundId, 'roundId');

  const request = normalizeJson(input.request);
  const requestHash = hashRgsValue(request);
  const commitmentPayload = {
    configHash: input.configHash,
    contractVersion: RGS_CONTRACT_SCHEMA_VERSION,
    mode: input.mode,
    proofKind: 'external-provider',
    requestHash,
    roundId: input.roundId,
    rulesHash: input.rulesHash,
  } as const;
  return {
    ...commitmentPayload,
    commitmentHash: hashRgsValue(commitmentPayload),
    request,
  };
}

export function createRgsExternalProof(input: {
  configHash: string;
  evidence: RgsJsonValue;
  mode: RgsMode;
  phase: 'revealed' | 'settled';
  request: RgsJsonValue;
  result: RgsJsonValue;
  roundId: string;
  rulesHash: string;
}): RgsExternalProof {
  const commitment = createRgsExternalCommitment(input);
  return {
    ...commitment,
    evidence: normalizeJson(input.evidence),
    evidenceHash: hashRgsValue(input.evidence),
    phase: input.phase,
    result: normalizeJson(input.result),
    resultHash: hashRgsValue(input.result),
    schemaVersion: RGS_PROOF_SCHEMA_VERSION,
  };
}

export function verifyRgsProof(proof: RgsProof): RgsProofVerification {
  const errors: string[] = [];
  try {
    if (proof.schemaVersion !== RGS_PROOF_SCHEMA_VERSION) {
      errors.push('unsupported schemaVersion');
    }
    if (proof.contractVersion !== RGS_CONTRACT_SCHEMA_VERSION) {
      errors.push('unsupported contractVersion');
    }
    assertHash(proof.configHash, 'configHash');
    assertHash(proof.rulesHash, 'rulesHash');

    if (proof.proofKind === 'seeded-sha256') {
      const expected = createRgsSeededProof(proof);
      if (expected.serverSeedHash !== proof.serverSeedHash) {
        errors.push('serverSeedHash mismatch');
      }
      if (expected.commitmentHash !== proof.commitmentHash) {
        errors.push('commitmentHash mismatch');
      }
      if (expected.entropyHash !== proof.entropyHash) {
        errors.push('entropyHash mismatch');
      }
      if (expected.resultHash !== proof.resultHash) {
        errors.push('resultHash mismatch');
      }
    } else {
      const expected = createRgsExternalProof(proof);
      if (expected.requestHash !== proof.requestHash) {
        errors.push('requestHash mismatch');
      }
      if (expected.commitmentHash !== proof.commitmentHash) {
        errors.push('commitmentHash mismatch');
      }
      if (expected.evidenceHash !== proof.evidenceHash) {
        errors.push('evidenceHash mismatch');
      }
      if (expected.resultHash !== proof.resultHash) {
        errors.push('resultHash mismatch');
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'proof verification failed');
  }

  return { errors, valid: errors.length === 0 };
}

const fixtureHash = (character: string): string => character.repeat(64);

export const rgsCompatibilityFixtures = {
  modes: {
    crash: createRgsModeConfig({
      activation: 'fixture-only',
      calculatorVersion: 'dailydraft.crash-calculators.v1',
      config: { maxMultiplierBps: 100_000 },
      mode: 'crash',
      proofKind: 'seeded-sha256',
      rules: { schemaVersion: 'dailydraft.crash-rules.v1' },
    }),
    duel: createRgsModeConfig({
      activation: 'devnet',
      calculatorVersion: 'dailydraft.duel-opening.v1',
      config: { providerMode: 'dailydraft-devnet' },
      mode: 'duel',
      proofKind: 'external-provider',
      rules: { comparisonMetric: 'insured-value', tieRule: 'creator-wins' },
    }),
    flip: createRgsModeConfig({
      activation: 'fixture-only',
      calculatorVersion: 'dailydraft.flip-inventory.v1',
      config: { inventorySchemaVersion: 'dailydraft.flip-inventory.v1' },
      mode: 'flip',
      proofKind: 'seeded-sha256',
      rules: { outcomeSides: ['heads', 'tails'] },
    }),
    gacha: createRgsModeConfig({
      activation: 'devnet',
      calculatorVersion: 'dailydraft.gacha-pull-odds-calculator.v1',
      config: { inventorySnapshot: 'sealed' },
      mode: 'gacha',
      proofKind: 'seeded-sha256',
      rules: { schemaVersion: 'dailydraft.gacha-pull-odds.v1' },
    }),
  },
  seededProof: createRgsSeededProof({
    clientSeed: 'fixture-client-seed',
    commitmentId: 'gachaseed_fixture_001',
    configHash: fixtureHash('a'),
    mode: 'gacha',
    phase: 'settled',
    result: { collectibleRef: 'fixture:card:001', selectedIndex: 0 },
    roundId: 'rip_fixture_001',
    rulesHash: fixtureHash('b'),
    serverSeed: 'fixture-server-seed',
  }),
  schemaVersion: RGS_CONTRACT_SCHEMA_VERSION,
} as const;
