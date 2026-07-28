import { createHash } from 'node:crypto';
import type { DatabaseClient, Prisma } from '@dailydraft/db';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  FLIP_PROBABILITY_SCALE_PPM,
  type FLIP_RULES_CALCULATOR_VERSION,
  type FLIP_RULES_SCHEMA_VERSION,
  type FlipEligibleOutcome,
  type FlipOutcomeBand,
  type FlipRuleSet,
  flipOutcomeBandForValue,
  validateFlipRuleSet,
} from './flip-rules.service.js';
import {
  FLIP_SELECTION_FIXTURE_VERSION,
  FLIP_SESSION_ENVIRONMENT,
  type FlipSessionSnapshot,
  FlipSessionStateError,
  FlipSessionStateService,
  flipSessionFixtureModeEnabled,
} from './flip-session-state.service.js';

export const FLIP_APPROVED_ENTROPY_SCHEMA_VERSION = 'dailydraft.flip-approved-entropy.v1' as const;
export const FLIP_SELECTION_PROOF_SCHEMA_VERSION = 'dailydraft.flip-selection-proof.v1' as const;
export const FLIP_SELECTION_ALGORITHM_VERSION = 'dailydraft.flip-sha256-rejection-v1' as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const FIXTURE_ENTROPY_REFERENCE_PATTERN = /^fixture-entropy:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$/;
const MAX_ENTROPY_PAYLOAD_BYTES = 512;
const UINT64_RANGE = 1n << 64n;

export type FlipSelectionErrorCode =
  | 'DISABLED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'INVALID_ENTROPY'
  | 'INVALID_PROOF'
  | 'INVALID_STATE';

export class FlipSelectionError extends Error {
  constructor(
    readonly code: FlipSelectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FlipSelectionError';
  }
}

export interface FlipApprovedEntropyInput {
  approvedAt: string;
  payload: string;
  reference: string;
  schemaVersion: typeof FLIP_APPROVED_ENTROPY_SCHEMA_VERSION;
  sessionReference: string;
  source: 'fixture-approved';
}

export interface FlipSelectionAuditProof {
  algorithmVersion: typeof FLIP_SELECTION_ALGORITHM_VERSION;
  entropyApprovedAt: string;
  entropyHash: string;
  entropyReference: string;
  entropySchemaVersion: typeof FLIP_APPROVED_ENTROPY_SCHEMA_VERSION;
  entropySource: 'fixture-approved';
  poolCommitmentHash: string;
  resultHash: string;
  rollPpm: number;
  rulesHash: string;
  schemaVersion: typeof FLIP_SELECTION_PROOF_SCHEMA_VERSION;
  selectedBandLabel: string;
  selectedBandOutcomeCount: number;
  selectedBandOutcomeIndex: number;
  selectedOrdinal: number;
  sessionReference: string;
  snapshotContentHash: string;
}

export interface FlipSelectionResult {
  proof: FlipSelectionAuditProof;
  selectedOutcome: FlipEligibleOutcome;
  session: FlipSessionSnapshot;
}

export interface SelectFixtureFlipOutcomeInput {
  approvedEntropy: FlipApprovedEntropyInput;
  expectedVersion: number;
  sessionReference: string;
  transitionKey: string;
}

export interface FlipSelectionCommittedInput {
  committedAt: Date;
  outcomeSpace: unknown;
  poolCommitmentHash: string;
  rules: unknown;
  rulesHash: string;
  sessionReference: string;
  snapshotContentHash: string;
}

@Injectable()
export class FlipOutcomeSelectionService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    @Inject(FlipSessionStateService) private readonly sessions: FlipSessionStateService,
    @Inject(FLIP_SESSION_ENVIRONMENT) private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async selectFixtureOutcome(input: SelectFixtureFlipOutcomeInput): Promise<FlipSelectionResult> {
    if (!flipSessionFixtureModeEnabled(this.environment)) {
      throw selectionError(
        'DISABLED',
        'Flip outcome selection is disabled outside explicit fixture or preview mode',
      );
    }
    const sessionReference = requireIdentifier(input.sessionReference, 'sessionReference');
    const transitionKey = requireIdentifier(input.transitionKey, 'transitionKey');
    if (
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      input.approvedEntropy.sessionReference !== sessionReference
    ) {
      throw selectionError('INVALID_STATE', 'Flip selection boundary is invalid');
    }

    const session = await this.database.flipSession.findUnique({
      include: { poolCommitment: { include: { ruleset: true } } },
      where: { id: sessionReference },
    });
    if (
      !session?.poolCommitment ||
      (session.status !== 'POOL_COMMITTED' && session.status !== 'SELECTION_RECORDED')
    ) {
      throw selectionError(
        'INVALID_STATE',
        'Flip selection requires the exact durable pool-committed session',
      );
    }
    const commitment = session.poolCommitment;
    const computed = selectFlipOutcomeReproducibly(
      {
        committedAt: commitment.committedAt,
        outcomeSpace: commitment.outcomeSpace,
        poolCommitmentHash: commitment.poolCommitmentHash,
        rules: storedRules(commitment.ruleset),
        rulesHash: commitment.rulesHash,
        sessionReference,
        snapshotContentHash: commitment.snapshotContentHash,
      },
      input.approvedEntropy,
    );
    const proofId = `fixture-selection-proof:${computed.proof.resultHash.slice(0, 48)}`;
    const requestHash = sha256(
      stableStringify({
        entropyHash: computed.proof.entropyHash,
        expectedVersion: input.expectedVersion,
        proofResultHash: computed.proof.resultHash,
        sessionReference,
        transitionKey,
      }),
    );

    await this.ensurePreparedProof({
      commitmentId: commitment.id,
      proof: computed.proof,
      proofId,
      requestHash,
      transitionKey,
    });

    let transitioned: FlipSessionSnapshot;
    try {
      transitioned = await this.sessions.transition(sessionReference, {
        evidence: {
          ...computed.selectedOutcome,
          reference: proofId,
          resultHash: computed.proof.resultHash,
          schemaVersion: FLIP_SELECTION_FIXTURE_VERSION,
        },
        expectedVersion: input.expectedVersion,
        kind: 'record-selection',
        transitionKey,
      });
    } catch (error) {
      if (
        error instanceof FlipSessionStateError &&
        error.code === 'INVALID_TRANSITION' &&
        session.status === 'SELECTION_RECORDED'
      ) {
        transitioned = await this.sessions.findSession(sessionReference);
      } else {
        throw error;
      }
    }
    assertSelectedReplay(transitioned, computed.selectedOutcome);
    await this.finalizeProof(proofId, sessionReference, transitionKey);
    return {
      proof: computed.proof,
      selectedOutcome: computed.selectedOutcome,
      session: await this.sessions.findSession(sessionReference),
    };
  }

  private async ensurePreparedProof(input: {
    commitmentId: string;
    proof: FlipSelectionAuditProof;
    proofId: string;
    requestHash: string;
    transitionKey: string;
  }): Promise<void> {
    const existing = await this.database.flipOutcomeSelectionProof.findUnique({
      where: { sessionId: input.proof.sessionReference },
    });
    if (existing) {
      assertStoredProof(existing, input);
      return;
    }
    try {
      await this.database.flipOutcomeSelectionProof.create({
        data: {
          algorithmVersion: input.proof.algorithmVersion,
          entropyApprovedAt: new Date(input.proof.entropyApprovedAt),
          entropyHash: input.proof.entropyHash,
          entropyReference: input.proof.entropyReference,
          entropySchemaVersion: input.proof.entropySchemaVersion,
          entropySource: input.proof.entropySource,
          id: input.proofId,
          poolCommitmentHash: input.proof.poolCommitmentHash,
          poolCommitmentId: input.commitmentId,
          requestHash: input.requestHash,
          resultHash: input.proof.resultHash,
          rollPpm: input.proof.rollPpm,
          rulesHash: input.proof.rulesHash,
          schemaVersion: input.proof.schemaVersion,
          selectedBandLabel: input.proof.selectedBandLabel,
          selectedBandOutcomeCount: input.proof.selectedBandOutcomeCount,
          selectedBandOutcomeIndex: input.proof.selectedBandOutcomeIndex,
          selectedOrdinal: input.proof.selectedOrdinal,
          sessionId: input.proof.sessionReference,
          snapshotContentHash: input.proof.snapshotContentHash,
          transitionKey: input.transitionKey,
        },
      });
    } catch (error) {
      const concurrent = await this.database.flipOutcomeSelectionProof.findUnique({
        where: { sessionId: input.proof.sessionReference },
      });
      if (!concurrent) throw error;
      assertStoredProof(concurrent, input);
    }
  }

  private async finalizeProof(
    proofId: string,
    sessionId: string,
    transitionKey: string,
  ): Promise<void> {
    const transition = await this.database.flipSessionTransition.findUnique({
      where: { sessionId_transitionKey: { sessionId, transitionKey } },
    });
    if (
      !transition ||
      transition.kind !== 'SELECTION_RECORDED' ||
      transition.evidence === null ||
      (transition.evidence as { reference?: unknown }).reference !== proofId
    ) {
      throw selectionError(
        'INVALID_PROOF',
        'Flip selection proof has no matching append-only transition',
      );
    }
    const current = await this.database.flipOutcomeSelectionProof.findUniqueOrThrow({
      where: { id: proofId },
    });
    if (current.terminalTransitionId) {
      if (current.terminalTransitionId !== transition.id) {
        throw selectionError(
          'IDEMPOTENCY_MISMATCH',
          'Flip selection proof finalized against another transition',
        );
      }
      return;
    }
    const finalized = await this.database.flipOutcomeSelectionProof.updateMany({
      data: { finalizedAt: new Date(), terminalTransitionId: transition.id },
      where: { finalizedAt: null, id: proofId, terminalTransitionId: null },
    });
    if (finalized.count !== 1) {
      const concurrent = await this.database.flipOutcomeSelectionProof.findUniqueOrThrow({
        where: { id: proofId },
      });
      if (concurrent.terminalTransitionId !== transition.id) {
        throw selectionError(
          'IDEMPOTENCY_MISMATCH',
          'Flip selection proof finalized concurrently with different evidence',
        );
      }
    }
  }
}

export function selectFlipOutcomeReproducibly(
  committed: FlipSelectionCommittedInput,
  approvedEntropy: FlipApprovedEntropyInput,
): { proof: FlipSelectionAuditProof; selectedOutcome: FlipEligibleOutcome } {
  const entropy = validateApprovedEntropy(approvedEntropy, committed.sessionReference);
  const committedAt = requireDate(committed.committedAt, 'committedAt');
  if (new Date(entropy.approvedAt).getTime() < committedAt.getTime()) {
    throw selectionError(
      'INVALID_ENTROPY',
      'Flip approved entropy predates the immutable pool commitment',
    );
  }
  if (
    !HASH_PATTERN.test(committed.poolCommitmentHash) ||
    !HASH_PATTERN.test(committed.rulesHash) ||
    !HASH_PATTERN.test(committed.snapshotContentHash)
  ) {
    throw selectionError('INVALID_PROOF', 'Flip committed selection hashes are invalid');
  }
  const rules = validateFlipRuleSet(committed.rules);
  if (rules.rulesHash !== committed.rulesHash) {
    throw selectionError('INVALID_PROOF', 'Flip selection rules do not match the commitment');
  }
  const outcomes = parseOutcomeSpace(committed.outcomeSpace);
  const representedBands = new Set<string>();
  for (const outcome of outcomes) {
    const derivedBand = flipOutcomeBandForValue(rules.bands, outcome.listingValueAmount);
    if (derivedBand.label !== outcome.bandLabel) {
      throw selectionError(
        'INVALID_PROOF',
        'Flip committed outcome does not match its reviewed value band',
      );
    }
    representedBands.add(outcome.bandLabel);
  }
  if (rules.bands.some((band) => !representedBands.has(band.label))) {
    throw selectionError(
      'INVALID_PROOF',
      'Flip committed outcome space does not represent every reviewed band',
    );
  }
  const entropyHash = sha256(stableStringify(entropy));
  const seed = sha256(
    stableStringify({
      algorithmVersion: FLIP_SELECTION_ALGORITHM_VERSION,
      entropyHash,
      poolCommitmentHash: committed.poolCommitmentHash,
      rulesHash: committed.rulesHash,
      sessionReference: committed.sessionReference,
      snapshotContentHash: committed.snapshotContentHash,
    }),
  );
  const rollPpm = unbiasedIndex(seed, 'band-roll', FLIP_PROBABILITY_SCALE_PPM);
  const band = flipBandForRoll(rules.bands, rollPpm);
  const bandOutcomes = outcomes.filter((outcome) => outcome.bandLabel === band.label);
  if (bandOutcomes.length === 0) {
    throw selectionError(
      'INVALID_PROOF',
      'Flip committed pool has no eligible outcome for the selected band',
    );
  }
  const selectedBandOutcomeIndex = unbiasedIndex(seed, 'band-outcome', bandOutcomes.length);
  const selectedOutcome = bandOutcomes[selectedBandOutcomeIndex];
  if (!selectedOutcome) {
    throw selectionError('INVALID_PROOF', 'Flip selected outcome is absent');
  }
  const unsignedProof = {
    algorithmVersion: FLIP_SELECTION_ALGORITHM_VERSION,
    entropyApprovedAt: entropy.approvedAt,
    entropyHash,
    entropyReference: entropy.reference,
    entropySchemaVersion: FLIP_APPROVED_ENTROPY_SCHEMA_VERSION,
    entropySource: 'fixture-approved',
    poolCommitmentHash: committed.poolCommitmentHash,
    rollPpm,
    rulesHash: committed.rulesHash,
    schemaVersion: FLIP_SELECTION_PROOF_SCHEMA_VERSION,
    selectedBandLabel: band.label,
    selectedBandOutcomeCount: bandOutcomes.length,
    selectedBandOutcomeIndex,
    selectedOrdinal: selectedOutcome.ordinal,
    sessionReference: committed.sessionReference,
    snapshotContentHash: committed.snapshotContentHash,
  } as const;
  const proof = Object.freeze({
    ...unsignedProof,
    resultHash: hashSelectionProof(unsignedProof),
  });
  return { proof, selectedOutcome };
}

export function verifyFlipSelectionAuditProof(input: {
  approvedEntropy: FlipApprovedEntropyInput;
  committed: FlipSelectionCommittedInput;
  proof: FlipSelectionAuditProof;
}): FlipEligibleOutcome {
  const reproduced = selectFlipOutcomeReproducibly(input.committed, input.approvedEntropy);
  if (stableStringify(reproduced.proof) !== stableStringify(input.proof)) {
    throw selectionError('INVALID_PROOF', 'Flip selection audit proof does not reproduce');
  }
  return reproduced.selectedOutcome;
}

export function flipBandForRoll(
  bands: readonly FlipOutcomeBand[],
  rollPpm: number,
): FlipOutcomeBand {
  if (!Number.isInteger(rollPpm) || rollPpm < 0 || rollPpm >= FLIP_PROBABILITY_SCALE_PPM) {
    throw selectionError('INVALID_PROOF', 'Flip selection roll is outside the PPM scale');
  }
  let upperBound = 0;
  for (const band of bands) {
    upperBound += band.probabilityPpm;
    if (rollPpm < upperBound) return band;
  }
  throw selectionError('INVALID_PROOF', 'Flip probability bands do not cover the roll');
}

function hashSelectionProof(proof: Omit<FlipSelectionAuditProof, 'resultHash'>): string {
  return sha256(stableStringify(proof));
}

function validateApprovedEntropy(
  value: FlipApprovedEntropyInput,
  sessionReference: string,
): FlipApprovedEntropyInput {
  requireEntropyExactKeys(value, [
    'approvedAt',
    'payload',
    'reference',
    'schemaVersion',
    'sessionReference',
    'source',
  ]);
  if (
    value.schemaVersion !== FLIP_APPROVED_ENTROPY_SCHEMA_VERSION ||
    value.source !== 'fixture-approved' ||
    value.sessionReference !== sessionReference ||
    !FIXTURE_ENTROPY_REFERENCE_PATTERN.test(value.reference) ||
    typeof value.payload !== 'string' ||
    value.payload.length === 0 ||
    Buffer.byteLength(value.payload, 'utf8') > MAX_ENTROPY_PAYLOAD_BYTES ||
    value.payload.trim() !== value.payload ||
    hasControlCharacter(value.payload)
  ) {
    throw selectionError('INVALID_ENTROPY', 'Flip approved entropy input is invalid');
  }
  const approvedAt = new Date(value.approvedAt);
  if (!Number.isFinite(approvedAt.getTime()) || approvedAt.toISOString() !== value.approvedAt) {
    throw selectionError('INVALID_ENTROPY', 'Flip approved entropy timestamp is invalid');
  }
  return Object.freeze({ ...value });
}

function requireEntropyExactKeys(value: object, expectedKeys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw selectionError('INVALID_ENTROPY', 'Flip approved entropy input is invalid');
  }
  const expected = new Set(expectedKeys);
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw selectionError('INVALID_ENTROPY', 'Flip approved entropy input has unsupported fields');
  }
}

function parseOutcomeSpace(value: unknown): FlipEligibleOutcome[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw selectionError('INVALID_PROOF', 'Flip committed outcome space is invalid');
  }
  const ordinals = new Set<number>();
  const assets = new Set<string>();
  const listings = new Set<string>();
  return value.map((candidate) => {
    requireExactKeys(candidate as object, [
      'bandLabel',
      'listingValueAmount',
      'ordinal',
      'providerAssetReference',
      'providerListingReference',
    ]);
    const outcome = candidate as Partial<FlipEligibleOutcome>;
    if (
      typeof outcome.ordinal !== 'number' ||
      !Number.isInteger(outcome.ordinal) ||
      outcome.ordinal < 0 ||
      typeof outcome.listingValueAmount !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(outcome.listingValueAmount) ||
      typeof outcome.bandLabel !== 'string' ||
      !IDENTIFIER_PATTERN.test(outcome.bandLabel) ||
      typeof outcome.providerAssetReference !== 'string' ||
      outcome.providerAssetReference.length === 0 ||
      typeof outcome.providerListingReference !== 'string' ||
      outcome.providerListingReference.length === 0 ||
      ordinals.has(outcome.ordinal) ||
      assets.has(outcome.providerAssetReference) ||
      listings.has(outcome.providerListingReference)
    ) {
      throw selectionError('INVALID_PROOF', 'Flip committed outcome is invalid');
    }
    ordinals.add(outcome.ordinal);
    assets.add(outcome.providerAssetReference);
    listings.add(outcome.providerListingReference);
    return Object.freeze({
      bandLabel: outcome.bandLabel,
      listingValueAmount: outcome.listingValueAmount,
      ordinal: outcome.ordinal,
      providerAssetReference: outcome.providerAssetReference,
      providerListingReference: outcome.providerListingReference,
    });
  });
}

function storedRules(rules: {
  activation: string;
  bands: Prisma.JsonValue;
  calculatorVersion: string;
  currency: string;
  decimals: number;
  feeAmount: string;
  houseEdgePpm: number;
  inventoryPolicyVersion: string;
  poolKey: string;
  probabilityScalePpm: number;
  reviewReference: string;
  reviewedAt: Date;
  rulesHash: string;
  rulesKey: string;
  schemaVersion: string;
  stakeAmount: string;
  version: number;
}): FlipRuleSet {
  return validateFlipRuleSet({
    ...rules,
    activation: rules.activation as 'fixture-only',
    bands: rules.bands,
    calculatorVersion: rules.calculatorVersion as typeof FLIP_RULES_CALCULATOR_VERSION,
    currency: rules.currency as 'USDC',
    decimals: rules.decimals as 6,
    probabilityScalePpm: rules.probabilityScalePpm as typeof FLIP_PROBABILITY_SCALE_PPM,
    reviewedAt: rules.reviewedAt.toISOString(),
    schemaVersion: rules.schemaVersion as typeof FLIP_RULES_SCHEMA_VERSION,
  });
}

function assertSelectedReplay(session: FlipSessionSnapshot, expected: FlipEligibleOutcome): void {
  if (
    session.selectedOutcome?.ordinal !== expected.ordinal ||
    session.selectedOutcome.bandLabel !== expected.bandLabel ||
    session.selectedOutcome.providerAssetReference !== expected.providerAssetReference ||
    session.selectedOutcome.providerListingReference !== expected.providerListingReference ||
    session.selectedOutcome.listingValueAmount !== expected.listingValueAmount
  ) {
    throw selectionError(
      'IDEMPOTENCY_MISMATCH',
      'Flip session contains a different deterministic outcome',
    );
  }
}

function assertStoredProof(
  stored: {
    algorithmVersion: string;
    entropyApprovedAt: Date;
    entropyHash: string;
    entropyReference: string;
    entropySchemaVersion: string;
    entropySource: string;
    id: string;
    poolCommitmentHash: string;
    poolCommitmentId: string;
    requestHash: string;
    resultHash: string;
    rollPpm: number;
    rulesHash: string;
    schemaVersion: string;
    selectedBandLabel: string;
    selectedBandOutcomeCount: number;
    selectedBandOutcomeIndex: number;
    selectedOrdinal: number;
    snapshotContentHash: string;
    transitionKey: string;
  },
  input: {
    commitmentId: string;
    proof: FlipSelectionAuditProof;
    proofId: string;
    requestHash: string;
    transitionKey: string;
  },
): void {
  if (
    stored.algorithmVersion !== input.proof.algorithmVersion ||
    stored.entropyApprovedAt.toISOString() !== input.proof.entropyApprovedAt ||
    stored.entropyHash !== input.proof.entropyHash ||
    stored.entropyReference !== input.proof.entropyReference ||
    stored.entropySchemaVersion !== input.proof.entropySchemaVersion ||
    stored.entropySource !== input.proof.entropySource ||
    stored.id !== input.proofId ||
    stored.poolCommitmentHash !== input.proof.poolCommitmentHash ||
    stored.poolCommitmentId !== input.commitmentId ||
    stored.requestHash !== input.requestHash ||
    stored.resultHash !== input.proof.resultHash ||
    stored.rollPpm !== input.proof.rollPpm ||
    stored.rulesHash !== input.proof.rulesHash ||
    stored.schemaVersion !== input.proof.schemaVersion ||
    stored.selectedBandLabel !== input.proof.selectedBandLabel ||
    stored.selectedBandOutcomeCount !== input.proof.selectedBandOutcomeCount ||
    stored.selectedBandOutcomeIndex !== input.proof.selectedBandOutcomeIndex ||
    stored.selectedOrdinal !== input.proof.selectedOrdinal ||
    stored.snapshotContentHash !== input.proof.snapshotContentHash ||
    stored.transitionKey !== input.transitionKey
  ) {
    throw selectionError(
      'IDEMPOTENCY_MISMATCH',
      'Flip selection replay changed its deterministic proof',
    );
  }
}

function unbiasedIndex(seed: string, domain: string, modulus: number): number {
  if (!Number.isInteger(modulus) || modulus < 1) {
    throw selectionError('INVALID_PROOF', 'Flip selection modulus is invalid');
  }
  const divisor = BigInt(modulus);
  const acceptanceLimit = UINT64_RANGE - (UINT64_RANGE % divisor);
  for (let counter = 0; counter < 1024; counter += 1) {
    const digest = sha256(`${seed}:${domain}:${counter}`);
    const value = BigInt(`0x${digest.slice(0, 16)}`);
    if (value < acceptanceLimit) return Number(value % divisor);
  }
  throw selectionError('INVALID_PROOF', 'Flip selection could not derive an unbiased index');
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw selectionError('INVALID_STATE', `Flip ${label} is invalid`);
  }
  return value;
}

function requireDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw selectionError('INVALID_PROOF', `Flip ${label} is invalid`);
  }
  return new Date(value.getTime());
}

function requireExactKeys(value: object, expectedKeys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw selectionError('INVALID_PROOF', 'Flip deterministic input is invalid');
  }
  const expected = new Set(expectedKeys);
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw selectionError('INVALID_PROOF', 'Flip deterministic input has unsupported fields');
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function selectionError(code: FlipSelectionErrorCode, message: string): FlipSelectionError {
  return new FlipSelectionError(code, message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
