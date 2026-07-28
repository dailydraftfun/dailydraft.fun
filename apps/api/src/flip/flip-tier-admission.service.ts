import { randomUUID } from 'node:crypto';
import type { DatabaseClient, Prisma } from '@dailydraft/db';

import {
  evaluateFlipTierAdmission,
  FLIP_TIER_ADMISSION_POLICY_VERSION,
  type FlipProviderHealthAdapter,
  type FlipTierAdmissionDecision,
  type FlipTierAdmissionPool,
} from './flip-tier-admission.policy.js';

type AdmissionWriter = Pick<
  Prisma.TransactionClient,
  'flipTierAdmissionDecision' | 'flipTierAdmissionState'
>;

interface AdmissionBindings {
  inventoryPolicyHash: string | null;
  poolCommitmentHash: string | null;
  poolCommitmentId: string | null;
  rulesHash: string | null;
  snapshotContentHash: string | null;
}

export class FlipTierAdmissionError extends Error {
  readonly code = 'TIER_SUSPENDED' as const;

  constructor(
    readonly decision: FlipTierAdmissionDecision,
    readonly bindings: AdmissionBindings,
  ) {
    super(`Flip tier ${decision.tierKey} is suspended: ${decision.reason}`);
    this.name = 'FlipTierAdmissionError';
  }
}

export async function readFlipProviderHealth(adapter: FlipProviderHealthAdapter): Promise<unknown> {
  try {
    return await adapter.readFixtureHealth();
  } catch {
    return Symbol.for('invalid-flip-provider-health-fixture');
  }
}

export async function admitFlipStake(
  transaction: Prisma.TransactionClient,
  input: {
    evaluatedAt: Date;
    providerHealth: unknown;
    sessionReference: string;
    stakeAmount: string;
    stakeCurrency: string;
    stakeDecimals: number;
  },
): Promise<string> {
  const pool = await transaction.flipSessionPoolCommitment.findUnique({
    include: { ruleset: true, snapshot: true },
    where: { sessionReference: input.sessionReference },
  });
  const decision = evaluateFlipTierAdmission({
    evaluatedAt: input.evaluatedAt,
    pool: pool as FlipTierAdmissionPool | null,
    providerHealth: input.providerHealth,
    stakeAmount: input.stakeAmount,
    stakeCurrency: input.stakeCurrency,
    stakeDecimals: input.stakeDecimals,
  });
  const bindings = admissionBindings(pool);
  if (!decision.allowed) {
    throw new FlipTierAdmissionError(decision, bindings);
  }

  const decisionId = await recordFlipTierAdmissionDecision(
    transaction,
    decision,
    bindings,
    input.sessionReference,
  );
  await recordFlipTierAdmissionState(transaction, decision, bindings);
  return decisionId;
}

export async function persistRejectedFlipTierAdmission(
  database: DatabaseClient,
  error: FlipTierAdmissionError,
  sessionReference: string,
): Promise<void> {
  await database.$transaction(async (transaction) => {
    await recordFlipTierAdmissionDecision(
      transaction,
      error.decision,
      error.bindings,
      sessionReference,
    );
    await recordFlipTierAdmissionState(transaction, error.decision, error.bindings);
  });
}

async function recordFlipTierAdmissionDecision(
  writer: AdmissionWriter,
  decision: FlipTierAdmissionDecision,
  bindings: AdmissionBindings,
  sessionReference: string,
): Promise<string> {
  const id = `flipadmission_${randomUUID().replaceAll('-', '')}`;
  await writer.flipTierAdmissionDecision.create({
    data: {
      allowed: decision.allowed,
      evaluatedAt: decision.evaluatedAt,
      id,
      inventoryPolicyHash: bindings.inventoryPolicyHash,
      policyHash: decision.policyHash,
      policyVersion: FLIP_TIER_ADMISSION_POLICY_VERSION,
      poolCommitmentHash: bindings.poolCommitmentHash,
      poolCommitmentId: bindings.poolCommitmentId,
      ...(decision.providerHealth === null
        ? {}
        : {
            providerHealth: decision.providerHealth as unknown as Prisma.InputJsonValue,
          }),
      providerHealthHash: decision.providerHealthHash,
      reason: decision.reason,
      reenableBoundary: decision.reenableBoundary,
      rulesHash: bindings.rulesHash,
      sessionReference,
      snapshotContentHash: bindings.snapshotContentHash,
      tierKey: decision.tierKey,
    },
  });
  return id;
}

async function recordFlipTierAdmissionState(
  writer: AdmissionWriter,
  decision: FlipTierAdmissionDecision,
  bindings: AdmissionBindings,
): Promise<void> {
  const existing = await writer.flipTierAdmissionState.findUnique({
    select: { evaluatedAt: true },
    where: { tierKey: decision.tierKey },
  });
  if (existing && existing.evaluatedAt.getTime() > decision.evaluatedAt.getTime()) return;
  const disabled = !decision.allowed;
  await writer.flipTierAdmissionState.upsert({
    create: {
      disabled,
      evaluatedAt: decision.evaluatedAt,
      policyHash: decision.policyHash,
      providerHealthHash: decision.providerHealthHash,
      reason: decision.reason,
      reenableBoundary: decision.reenableBoundary,
      rulesHash: bindings.rulesHash,
      snapshotContentHash: bindings.snapshotContentHash,
      tierKey: decision.tierKey,
    },
    update: {
      disabled,
      evaluatedAt: decision.evaluatedAt,
      policyHash: decision.policyHash,
      providerHealthHash: decision.providerHealthHash,
      reason: decision.reason,
      reenableBoundary: decision.reenableBoundary,
      rulesHash: bindings.rulesHash,
      snapshotContentHash: bindings.snapshotContentHash,
      version: { increment: 1 },
    },
    where: { tierKey: decision.tierKey },
  });
}

function admissionBindings(
  pool: {
    id: string;
    poolCommitmentHash: string;
    rulesHash: string;
    snapshot: { contentHash: string; policyHash: string };
    snapshotContentHash: string;
  } | null,
): AdmissionBindings {
  return {
    inventoryPolicyHash: pool?.snapshot.policyHash ?? null,
    poolCommitmentHash: pool?.poolCommitmentHash ?? null,
    poolCommitmentId: pool?.id ?? null,
    rulesHash: pool?.rulesHash ?? null,
    snapshotContentHash: pool?.snapshotContentHash ?? null,
  };
}
