import { createHash, randomUUID } from 'node:crypto';
import {
  type DatabaseClient,
  FlipAcquisitionOperationKind as DatabaseFlipAcquisitionOperationKind,
  FlipAcquisitionOperationStatus as DatabaseFlipAcquisitionOperationStatus,
  type FlipAcquisitionRecoveryBranch as DatabaseFlipAcquisitionRecoveryBranch,
  FlipAcquisitionRecoveryMode as DatabaseFlipAcquisitionRecoveryMode,
  HouseInventoryDisposition,
  HouseInventoryListingState,
  HouseInventoryStatus,
  HouseTreasuryLedgerType,
  type Prisma,
} from '@dailydraft/db';
import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { acquireNamespacedAdvisoryTransactionLock } from '../database/advisory-lock.js';
import { DATABASE_CLIENT } from '../database/database.constants.js';
import {
  canonicalFlipAcquisitionStringify,
  type FlipAcquisitionPolicy,
  type FlipAcquisitionRecoveryBranch,
  validateFlipAcquisitionPolicy,
} from './flip-acquisition.policy.js';
import {
  FLIP_ACQUISITION_PROVIDER,
  FlipAcquisitionAmbiguousError,
  FlipAcquisitionDefinitelyNotAppliedError,
  type FlipAcquisitionProvider,
  type FlipAcquisitionProviderRequest,
  type FlipAcquisitionProviderResult,
} from './flip-acquisition.provider.js';
import {
  FLIP_PURCHASE_FIXTURE_VERSION,
  FLIP_RECOVERY_FIXTURE_VERSION,
  FLIP_SESSION_ENVIRONMENT,
  FLIP_TRANSFER_FIXTURE_VERSION,
  FlipSessionStateService,
  flipSessionFixtureModeEnabled,
} from './flip-session-state.service.js';

export const FLIP_ACQUISITION_SCHEMA_VERSION = 'dailydraft.flip-acquisition.v1' as const;
export const FLIP_ACQUISITION_RECEIPT_SCHEMA_VERSION =
  'dailydraft.flip-acquisition-receipt.v1' as const;

const POLICY_LOCK_NAMESPACE = 1_584_503_772;
const ACQUISITION_LEASE_MS = 60_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

type AcquisitionRecord = Prisma.FlipAcquisitionGetPayload<{
  include: { operations: true; policy: true };
}>;
type OperationRecord = AcquisitionRecord['operations'][number];

interface PlannedOperation {
  amount: string;
  assetReference: string;
  destinationReference: string;
  expectedSessionVersion: number;
  kind: DatabaseFlipAcquisitionOperationKind;
  listingReference: string;
  operationKey: string;
  providerRequestKey: string;
  requestHash: string;
  sequence: number;
  sourceReference: string;
}

export interface FlipAcquisitionSnapshot {
  finalizedOperationCount: number;
  operations: readonly {
    failureCode: string | null;
    kind: 'purchase' | 'transfer';
    providerReference: string | null;
    recoveryMode: 'none' | 'retryable' | 'reconcile-only';
    status: 'prepared' | 'recovery-required' | 'finalized';
  }[];
  receiptHash: string | null;
  recoveryBranch: FlipAcquisitionRecoveryBranch | null;
  recoveryReason: string | null;
  sessionReference: string;
  status: 'pending' | 'recovery-required' | 'acquired';
}

@Injectable()
export class FlipAcquisitionService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    @Inject(FLIP_ACQUISITION_PROVIDER) private readonly provider: FlipAcquisitionProvider,
    @Inject(FlipSessionStateService) private readonly sessions: FlipSessionStateService,
    @Inject(FLIP_SESSION_ENVIRONMENT) private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async createFixturePolicy(input: {
    policy: unknown;
    rulesKey: string;
    rulesVersion: number;
  }): Promise<{ created: boolean; id: string; policyHash: string }> {
    this.requireFixtureMode();
    const rulesKey = requireIdentifier(input.rulesKey, 'rulesKey');
    if (!Number.isInteger(input.rulesVersion) || input.rulesVersion < 1) {
      throw new ConflictException('Flip acquisition rules version is invalid');
    }
    const policy = validateFlipAcquisitionPolicy(input.policy);
    return this.database.$transaction(async (transaction) => {
      await acquireNamespacedAdvisoryTransactionLock(
        transaction,
        `${rulesKey}:${input.rulesVersion}`,
        POLICY_LOCK_NAMESPACE,
      );
      const ruleset = await transaction.flipRuleSet.findUnique({
        where: {
          rulesKey_version: { rulesKey, version: input.rulesVersion },
        },
      });
      if (
        !ruleset?.sealedAt ||
        ruleset.rulesHash !== policy.rulesHash ||
        ruleset.version !== policy.rulesVersion
      ) {
        throw new ServiceUnavailableException(
          'Flip acquisition policy requires its exact sealed reviewed ruleset',
        );
      }
      const existing = await transaction.flipAcquisitionPolicy.findUnique({
        where: { rulesetId: ruleset.id },
      });
      if (existing) {
        if (!existing.sealedAt || existing.policyHash !== policy.policyHash) {
          throw new ConflictException(
            'Flip ruleset is already bound to another acquisition policy',
          );
        }
        return { created: false, id: existing.id, policyHash: existing.policyHash };
      }
      const id = createId('flipacqpolicy');
      await transaction.flipAcquisitionPolicy.create({
        data: {
          activation: policy.activation,
          failureBranches: policy.failureBranches as unknown as Prisma.InputJsonValue,
          houseInventoryCustodyReference: policy.houseInventoryCustodyReference,
          id,
          network: policy.network,
          policyCanonicalPreimage: canonicalFlipAcquisitionStringify(unsignedPolicy(policy)),
          policyHash: policy.policyHash,
          policyVersion: policy.policyVersion,
          provider: policy.provider,
          providerSourceCustodyReference: policy.providerSourceCustodyReference,
          reviewReference: policy.reviewReference,
          reviewedAt: new Date(policy.reviewedAt),
          rulesetId: ruleset.id,
          schemaVersion: policy.schemaVersion,
        },
      });
      const sealed = await transaction.flipAcquisitionPolicy.updateMany({
        data: { sealedAt: new Date() },
        where: { id, sealedAt: null },
      });
      if (sealed.count !== 1) {
        throw new ServiceUnavailableException('Flip acquisition policy could not be sealed');
      }
      return { created: true, id, policyHash: policy.policyHash };
    });
  }

  async resumeFixtureAcquisition(sessionReference: string): Promise<FlipAcquisitionSnapshot> {
    this.requireFixtureMode();
    const sessionId = requireIdentifier(sessionReference, 'sessionReference');
    const acquisition = await this.ensurePlan(sessionId);
    if (
      acquisition.status === 'ACQUIRED' ||
      (acquisition.status === 'RECOVERY_REQUIRED' &&
        acquisition.operations.some(
          (operation) => operation.recoveryMode === DatabaseFlipAcquisitionRecoveryMode.RETRYABLE,
        ))
    ) {
      return toSnapshot(acquisition);
    }

    const leaseOwner = randomUUID();
    const now = new Date();
    const claimed = await this.database.flipAcquisition.updateMany({
      data: {
        leaseExpiresAt: new Date(now.getTime() + ACQUISITION_LEASE_MS),
        leaseOwner,
        version: { increment: 1 },
      },
      where: {
        id: acquisition.id,
        status: { in: ['PENDING', 'RECOVERY_REQUIRED'] },
        OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
    });
    if (claimed.count !== 1) return toSnapshot(await this.requireAcquisition(acquisition.id));

    try {
      const ordered = [...acquisition.operations].sort(
        (left, right) => left.sequence - right.sequence,
      );
      for (const candidate of ordered) {
        const current = await this.database.flipAcquisitionOperation.findUnique({
          where: { id: candidate.id },
        });
        if (!current) throw new ServiceUnavailableException('Flip acquisition operation is absent');
        if (current.status === DatabaseFlipAcquisitionOperationStatus.FINALIZED) {
          await this.ensureLifecycleTransition(acquisition, current);
          continue;
        }
        const request = operationRequest(sessionId, current);
        const reconciled = await this.provider.reconcile(request);
        if (reconciled) {
          await this.finalizeOperation(acquisition.id, current, reconciled);
          await this.ensureLifecycleTransition(
            acquisition,
            await this.database.flipAcquisitionOperation.findUniqueOrThrow({
              where: { id: current.id },
            }),
          );
          continue;
        }
        if (current.recoveryMode === DatabaseFlipAcquisitionRecoveryMode.RECONCILE_ONLY) {
          await this.recordAmbiguous(
            acquisition.id,
            current.id,
            leaseOwner,
            current.failureCode ?? 'PROVIDER_RESULT_AMBIGUOUS',
            current.providerReference,
            false,
          );
          return toSnapshot(await this.requireAcquisition(acquisition.id));
        }

        let result: FlipAcquisitionProviderResult;
        try {
          result = await this.provider.execute(request);
        } catch (error) {
          if (error instanceof FlipAcquisitionDefinitelyNotAppliedError) {
            await this.recordReviewedRecovery(acquisition, current, leaseOwner, error.code);
          } else {
            const ambiguous =
              error instanceof FlipAcquisitionAmbiguousError
                ? error
                : new FlipAcquisitionAmbiguousError('PROVIDER_RESPONSE_AMBIGUOUS');
            await this.recordAmbiguous(
              acquisition.id,
              current.id,
              leaseOwner,
              ambiguous.code,
              ambiguous.providerReference,
              true,
            );
          }
          return toSnapshot(await this.requireAcquisition(acquisition.id));
        }
        await this.finalizeOperation(acquisition.id, current, result, true);
        await this.ensureLifecycleTransition(
          acquisition,
          await this.database.flipAcquisitionOperation.findUniqueOrThrow({
            where: { id: current.id },
          }),
        );
      }
      return toSnapshot(await this.finalizeAcquisition(acquisition.id, leaseOwner));
    } catch (error) {
      await this.releaseLease(acquisition.id, leaseOwner).catch(() => undefined);
      throw error;
    }
  }

  async findFixtureAcquisition(sessionReference: string): Promise<FlipAcquisitionSnapshot | null> {
    const sessionId = requireIdentifier(sessionReference, 'sessionReference');
    const row = await this.database.flipAcquisition.findUnique({
      include: { operations: { orderBy: { sequence: 'asc' } }, policy: true },
      where: { sessionId },
    });
    return row ? toSnapshot(row) : null;
  }

  private async ensurePlan(sessionId: string): Promise<AcquisitionRecord> {
    const session = await this.database.flipSession.findUnique({
      include: {
        poolCommitment: {
          include: { ruleset: { include: { acquisitionPolicy: true } } },
        },
        selectionProof: true,
      },
      where: { id: sessionId },
    });
    if (
      !session?.poolCommitment ||
      !session.selectionProof?.finalizedAt ||
      !session.selectionProof.terminalTransitionId ||
      session.selectedOrdinal === null ||
      !session.selectedBandLabel ||
      !session.selectedAssetReference ||
      !session.selectedListingReference ||
      !session.selectedValueAmount ||
      ![
        'SELECTION_RECORDED',
        'PURCHASE_RECORDED',
        'TRANSFER_RECORDED',
        'RECOVERY_REQUIRED',
      ].includes(session.status)
    ) {
      throw new ConflictException(
        'Flip acquisition requires an exact finalized deterministic selection',
      );
    }
    const commitment = session.poolCommitment;
    const selectionProof = session.selectionProof;
    const selectedAssetReference = session.selectedAssetReference;
    const selectedBandLabel = session.selectedBandLabel;
    const selectedListingReference = session.selectedListingReference;
    const selectedOrdinal = session.selectedOrdinal;
    const selectedValueAmount = session.selectedValueAmount;
    if (
      !commitment ||
      !selectionProof ||
      !selectedAssetReference ||
      !selectedBandLabel ||
      !selectedListingReference ||
      selectedOrdinal === null ||
      !selectedValueAmount
    ) {
      throw new ConflictException('Flip acquisition selection binding is incomplete');
    }
    const storedPolicy = commitment.ruleset.acquisitionPolicy;
    if (
      !storedPolicy?.sealedAt ||
      storedPolicy.createdAt > commitment.committedAt ||
      storedPolicy.reviewedAt > commitment.committedAt
    ) {
      throw new ServiceUnavailableException(
        'Flip acquisition requires a precommitted reviewed recovery policy',
      );
    }
    const policy = validateFlipAcquisitionPolicy({
      activation: storedPolicy.activation,
      failureBranches: storedPolicy.failureBranches,
      houseInventoryCustodyReference: storedPolicy.houseInventoryCustodyReference,
      network: storedPolicy.network,
      policyHash: storedPolicy.policyHash,
      policyVersion: storedPolicy.policyVersion,
      provider: storedPolicy.provider,
      providerSourceCustodyReference: storedPolicy.providerSourceCustodyReference,
      reviewReference: storedPolicy.reviewReference,
      reviewedAt: storedPolicy.reviewedAt.toISOString(),
      rulesHash: commitment.rulesHash,
      rulesVersion: commitment.rulesVersion,
      schemaVersion: storedPolicy.schemaVersion,
    });
    const durableAcquisition = await this.database.flipAcquisition.findUnique({
      include: { operations: true, policy: true },
      where: { sessionId },
    });
    if (durableAcquisition) {
      assertPlanReplay(durableAcquisition, session, policy);
      return durableAcquisition;
    }
    if (session.status !== 'SELECTION_RECORDED') {
      throw new ConflictException('Flip acquisition recovery has no durable acquisition plan');
    }
    const operations = planOperations(
      {
        id: session.id,
        playerWalletReference: session.playerWalletReference,
        selectedAssetReference,
        selectedListingReference,
        selectedValueAmount,
        version: session.version,
      },
      policy,
    );
    const requestKey = `flip-acquisition:${selectionProof.resultHash.slice(0, 40)}`;
    const requestHash = acquisitionRequestHash(session, policy, operations, requestKey);
    try {
      return await this.database.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
            SELECT "id" FROM "FlipSession" WHERE "id" = ${sessionId} FOR UPDATE
          `;
          const existing = await transaction.flipAcquisition.findUnique({
            include: { operations: true, policy: true },
            where: { sessionId },
          });
          if (existing) {
            assertRequestHash(existing.requestHash, requestHash);
            return existing;
          }
          return transaction.flipAcquisition.create({
            data: {
              activationMode: 'fixture-only',
              expectedOperationCount: operations.length,
              houseInventoryCustodyReference: policy.houseInventoryCustodyReference,
              id: createId('flipacquisition'),
              network: policy.network,
              operations: {
                create: operations.map((operation) => ({
                  ...operation,
                  currency: 'USDC',
                  decimals: 6,
                  id: createId('flipacqop'),
                })),
              },
              playerWalletReference: session.playerWalletReference,
              policyId: storedPolicy.id,
              provider: policy.provider,
              requestHash,
              requestKey,
              rulesHash: commitment.rulesHash,
              rulesVersion: commitment.rulesVersion,
              schemaVersion: FLIP_ACQUISITION_SCHEMA_VERSION,
              selectedAssetReference,
              selectedBandLabel,
              selectedListingReference,
              selectedOrdinal,
              selectedValueAmount,
              selectionProofId: selectionProof.id,
              sessionId,
              sourceCustodyReference: policy.providerSourceCustodyReference,
            },
            include: { operations: true, policy: true },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const concurrent = await this.database.flipAcquisition.findUnique({
        include: { operations: true, policy: true },
        where: { sessionId },
      });
      if (concurrent) {
        assertRequestHash(concurrent.requestHash, requestHash);
        return concurrent;
      }
      throw error;
    }
  }

  private async finalizeOperation(
    acquisitionId: string,
    operation: OperationRecord,
    result: FlipAcquisitionProviderResult,
    executed = false,
  ): Promise<void> {
    if (
      !result.finalized ||
      !HASH_PATTERN.test(result.resultHash) ||
      !IDENTIFIER_PATTERN.test(result.providerReference) ||
      result.evidence.providerRequestKey !== operation.providerRequestKey
    ) {
      throw new ConflictException('Flip acquisition provider evidence is invalid');
    }
    await this.database.$transaction(async (transaction) => {
      const current = await transaction.flipAcquisitionOperation.findUnique({
        where: { id: operation.id },
      });
      if (
        !current ||
        current.acquisitionId !== acquisitionId ||
        current.requestHash !== operation.requestHash
      ) {
        throw new ConflictException('Flip acquisition operation binding changed');
      }
      if (current.status === DatabaseFlipAcquisitionOperationStatus.FINALIZED) {
        if (
          current.providerReference !== result.providerReference ||
          current.providerResultHash !== result.resultHash
        ) {
          throw new ConflictException('Flip acquisition replay changed provider evidence');
        }
        return;
      }
      const updated = await transaction.flipAcquisitionOperation.updateMany({
        data: {
          failureCode: null,
          finalizedAt: new Date(),
          lastAttemptedAt: executed ? new Date() : current.lastAttemptedAt,
          providerEvidence: result.evidence as unknown as Prisma.InputJsonValue,
          providerReference: result.providerReference,
          providerResultHash: result.resultHash,
          recoveryMode: DatabaseFlipAcquisitionRecoveryMode.NONE,
          status: DatabaseFlipAcquisitionOperationStatus.FINALIZED,
          ...(executed ? { submissionCount: { increment: 1 } } : {}),
        },
        where: {
          id: current.id,
          requestHash: current.requestHash,
          status: { in: ['PREPARED', 'RECOVERY_REQUIRED'] },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Flip acquisition finality lost a concurrent race');
      }
      await transaction.flipAcquisition.updateMany({
        data: {
          finalizedOperationCount: { increment: 1 },
          recoveryBranch: null,
          failureCode: null,
          status: 'PENDING',
          version: { increment: 1 },
        },
        where: { id: acquisitionId, status: { in: ['PENDING', 'RECOVERY_REQUIRED'] } },
      });
    });
  }

  private async ensureLifecycleTransition(
    acquisition: AcquisitionRecord,
    operation: OperationRecord,
  ): Promise<void> {
    if (
      operation.status !== DatabaseFlipAcquisitionOperationStatus.FINALIZED ||
      !operation.providerReference ||
      !operation.providerResultHash
    ) {
      throw new ConflictException('Flip acquisition lifecycle requires finalized provider proof');
    }
    if (operation.kind === DatabaseFlipAcquisitionOperationKind.PURCHASE) {
      await this.sessions.transition(acquisition.sessionId, {
        evidence: {
          amount: { amount: operation.amount, currency: 'USDC', decimals: 6 },
          provider: 'fixture-marketplace',
          providerAssetReference: operation.assetReference,
          providerListingReference: operation.listingReference,
          reference: operation.providerReference,
          schemaVersion: FLIP_PURCHASE_FIXTURE_VERSION,
          status: 'fixture-acquired',
        },
        expectedVersion: operation.expectedSessionVersion,
        kind: 'record-purchase',
        transitionKey: operation.operationKey,
      });
      return;
    }
    await this.sessions.transition(acquisition.sessionId, {
      evidence: {
        destinationWalletReference: operation.destinationReference,
        providerAssetReference: operation.assetReference,
        reference: operation.providerReference,
        schemaVersion: FLIP_TRANSFER_FIXTURE_VERSION,
        sourceCustodyReference: operation.sourceReference,
        status: 'fixture-transferred',
      },
      expectedVersion: operation.expectedSessionVersion,
      kind: 'record-transfer',
      transitionKey: operation.operationKey,
    });
  }

  private async recordReviewedRecovery(
    acquisition: AcquisitionRecord,
    operation: OperationRecord,
    leaseOwner: string,
    failureCode: string,
  ): Promise<void> {
    const policy = storedPolicy(acquisition.policy, acquisition);
    const reviewed = policy.failureBranches.find(
      (candidate) => candidate.failureCode === failureCode,
    );
    if (!reviewed) {
      throw new ServiceUnavailableException(
        'Flip provider failure has no pre-reviewed acquisition recovery branch',
      );
    }
    await this.database.$transaction(async (transaction) => {
      const updated = await transaction.flipAcquisitionOperation.updateMany({
        data: {
          failureCode,
          lastAttemptedAt: new Date(),
          recoveryMode: DatabaseFlipAcquisitionRecoveryMode.RETRYABLE,
          status: DatabaseFlipAcquisitionOperationStatus.RECOVERY_REQUIRED,
          submissionCount: { increment: 1 },
        },
        where: {
          acquisitionId: acquisition.id,
          id: operation.id,
          requestHash: operation.requestHash,
          status: { in: ['PREPARED', 'RECOVERY_REQUIRED'] },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Flip recovery branch lost a concurrent race');
      }
      await transaction.flipAcquisition.update({
        data: {
          failureCode,
          leaseExpiresAt: null,
          leaseOwner: null,
          recoveryBranch: toDatabaseBranch(reviewed.branch),
          status: 'RECOVERY_REQUIRED',
          version: { increment: 1 },
        },
        where: { id: acquisition.id, leaseOwner },
      });
      if (operation.kind === DatabaseFlipAcquisitionOperationKind.TRANSFER) {
        await ledgerRetainedAsset(transaction, acquisition, operation, reviewed.branch);
      }
    });
    const session = await this.sessions.findSession(acquisition.sessionId);
    if (session.status !== 'recovery-required') {
      await this.sessions.transition(acquisition.sessionId, {
        evidence: {
          reasonCode: `${failureCode}:${reviewed.branch.toUpperCase()}`,
          reference: `fixture-recovery:${sha256(`${acquisition.id}:${failureCode}`).slice(0, 32)}`,
          schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
          status: 'fixture-recovery-required',
        },
        expectedVersion: session.version,
        kind: 'request-recovery',
        transitionKey: `flip-acquisition-recovery:${acquisition.id}`,
      });
    }
  }

  private async recordAmbiguous(
    acquisitionId: string,
    operationId: string,
    leaseOwner: string,
    failureCode: string,
    providerReference: string | null,
    executed: boolean,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.flipAcquisitionOperation.update({
        data: {
          failureCode,
          providerReference,
          recoveryMode: DatabaseFlipAcquisitionRecoveryMode.RECONCILE_ONLY,
          status: DatabaseFlipAcquisitionOperationStatus.RECOVERY_REQUIRED,
          ...(executed ? { lastAttemptedAt: new Date(), submissionCount: { increment: 1 } } : {}),
        },
        where: { id: operationId },
      });
      await transaction.flipAcquisition.update({
        data: {
          failureCode,
          leaseExpiresAt: null,
          leaseOwner: null,
          recoveryBranch: null,
          status: 'RECOVERY_REQUIRED',
          version: { increment: 1 },
        },
        where: { id: acquisitionId, leaseOwner },
      });
    });
  }

  private async finalizeAcquisition(
    acquisitionId: string,
    leaseOwner: string,
  ): Promise<AcquisitionRecord> {
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.flipAcquisition.findUniqueOrThrow({
        include: { operations: { orderBy: { sequence: 'asc' } }, policy: true },
        where: { id: acquisitionId },
      });
      if (current.status === 'ACQUIRED') return current;
      if (
        current.finalizedOperationCount !== current.expectedOperationCount ||
        current.operations.some(
          (operation) => operation.status !== DatabaseFlipAcquisitionOperationStatus.FINALIZED,
        )
      ) {
        throw new ConflictException('Flip acquisition operations are not all finalized');
      }
      const receipt = {
        operations: current.operations.map((operation) => ({
          kind: operation.kind.toLowerCase(),
          providerReference: operation.providerReference,
          providerResultHash: operation.providerResultHash,
          requestHash: operation.requestHash,
        })),
        policyHash: current.policy.policyHash,
        schemaVersion: FLIP_ACQUISITION_RECEIPT_SCHEMA_VERSION,
        selectionProofId: current.selectionProofId,
        sessionReference: current.sessionId,
      };
      const receiptHash = sha256(canonicalFlipAcquisitionStringify(receipt));
      await transaction.flipAcquisition.update({
        data: {
          acquiredAt: new Date(),
          failureCode: null,
          leaseExpiresAt: null,
          leaseOwner: null,
          receipt,
          receiptHash,
          recoveryBranch: null,
          status: 'ACQUIRED',
          version: { increment: 1 },
        },
        where: { id: acquisitionId, leaseOwner },
      });
      return transaction.flipAcquisition.findUniqueOrThrow({
        include: { operations: { orderBy: { sequence: 'asc' } }, policy: true },
        where: { id: acquisitionId },
      });
    });
  }

  private async requireAcquisition(id: string): Promise<AcquisitionRecord> {
    return this.database.flipAcquisition.findUniqueOrThrow({
      include: { operations: { orderBy: { sequence: 'asc' } }, policy: true },
      where: { id },
    });
  }

  private async releaseLease(id: string, leaseOwner: string): Promise<void> {
    await this.database.flipAcquisition.updateMany({
      data: { leaseExpiresAt: null, leaseOwner: null, version: { increment: 1 } },
      where: { id, leaseOwner, status: { not: 'ACQUIRED' } },
    });
  }

  private requireFixtureMode(): void {
    if (!flipSessionFixtureModeEnabled(this.environment)) {
      throw new ServiceUnavailableException(
        'Flip acquisition is disabled outside explicit non-production fixture mode',
      );
    }
  }
}

function planOperations(
  session: {
    id: string;
    playerWalletReference: string;
    selectedAssetReference: string;
    selectedListingReference: string;
    selectedValueAmount: string;
    version: number;
  },
  policy: FlipAcquisitionPolicy,
): PlannedOperation[] {
  const base = {
    amount: session.selectedValueAmount,
    assetReference: session.selectedAssetReference,
    listingReference: session.selectedListingReference,
  };
  return [
    plannedOperation({
      ...base,
      destinationReference: policy.houseInventoryCustodyReference,
      expectedSessionVersion: session.version,
      kind: DatabaseFlipAcquisitionOperationKind.PURCHASE,
      sequence: 1,
      sessionId: session.id,
      sourceReference: policy.providerSourceCustodyReference,
    }),
    plannedOperation({
      ...base,
      destinationReference: session.playerWalletReference,
      expectedSessionVersion: session.version + 1,
      kind: DatabaseFlipAcquisitionOperationKind.TRANSFER,
      sequence: 2,
      sessionId: session.id,
      sourceReference: policy.houseInventoryCustodyReference,
    }),
  ];
}

function plannedOperation(input: {
  amount: string;
  assetReference: string;
  destinationReference: string;
  expectedSessionVersion: number;
  kind: DatabaseFlipAcquisitionOperationKind;
  listingReference: string;
  sequence: number;
  sessionId: string;
  sourceReference: string;
}): PlannedOperation {
  const operationKey = `flip-acquisition:${input.sequence}:${input.kind.toLowerCase()}`;
  const providerRequestKey = `fixture-acquisition:${sha256(
    canonicalFlipAcquisitionStringify({ operationKey, sessionReference: input.sessionId }),
  ).slice(0, 40)}`;
  const requestHash = sha256(
    canonicalFlipAcquisitionStringify({
      amount: input.amount,
      assetReference: input.assetReference,
      currency: 'USDC',
      decimals: 6,
      destinationReference: input.destinationReference,
      kind: input.kind.toLowerCase(),
      listingReference: input.listingReference,
      operationKey,
      providerRequestKey,
      sessionReference: input.sessionId,
      sourceReference: input.sourceReference,
    }),
  );
  return {
    amount: input.amount,
    assetReference: input.assetReference,
    destinationReference: input.destinationReference,
    expectedSessionVersion: input.expectedSessionVersion,
    kind: input.kind,
    listingReference: input.listingReference,
    operationKey,
    providerRequestKey,
    requestHash,
    sequence: input.sequence,
    sourceReference: input.sourceReference,
  };
}

function acquisitionRequestHash(
  session: {
    id: string;
    poolCommitmentHash: string | null;
    rulesHash: string | null;
    selectionProof: { id: string; resultHash: string } | null;
    snapshotContentHash: string | null;
  },
  policy: FlipAcquisitionPolicy,
  operations: readonly PlannedOperation[],
  requestKey: string,
): string {
  return sha256(
    canonicalFlipAcquisitionStringify({
      operations,
      policyHash: policy.policyHash,
      poolCommitmentHash: session.poolCommitmentHash,
      requestKey,
      rulesHash: session.rulesHash,
      selectionProofId: session.selectionProof?.id,
      selectionResultHash: session.selectionProof?.resultHash,
      sessionReference: session.id,
      snapshotContentHash: session.snapshotContentHash,
    }),
  );
}

function operationRequest(
  sessionReference: string,
  operation: OperationRecord,
): FlipAcquisitionProviderRequest {
  return {
    amount: operation.amount,
    assetReference: operation.assetReference,
    currency: 'USDC',
    decimals: 6,
    destinationReference: operation.destinationReference,
    kind: operation.kind.toLowerCase() as 'purchase' | 'transfer',
    listingReference: operation.listingReference,
    operationKey: operation.operationKey,
    providerRequestKey: operation.providerRequestKey,
    requestHash: operation.requestHash,
    sessionReference,
    sourceReference: operation.sourceReference,
  };
}

function assertPlanReplay(
  acquisition: AcquisitionRecord,
  session: {
    id: string;
    selectedAssetReference: string | null;
    selectedListingReference: string | null;
    selectedOrdinal: number | null;
    selectedValueAmount: string | null;
    selectionProof: { id: string } | null;
  },
  policy: FlipAcquisitionPolicy,
): void {
  if (
    acquisition.sessionId !== session.id ||
    acquisition.selectionProofId !== session.selectionProof?.id ||
    acquisition.policy.policyHash !== policy.policyHash ||
    acquisition.selectedAssetReference !== session.selectedAssetReference ||
    acquisition.selectedListingReference !== session.selectedListingReference ||
    acquisition.selectedOrdinal !== session.selectedOrdinal ||
    acquisition.selectedValueAmount !== session.selectedValueAmount
  ) {
    throw new ConflictException('Flip acquisition replay changed its immutable selection binding');
  }
}

function assertRequestHash(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new ConflictException('Flip acquisition request key was reused with different input');
  }
}

function storedPolicy(
  stored: AcquisitionRecord['policy'],
  acquisition: AcquisitionRecord,
): FlipAcquisitionPolicy {
  return validateFlipAcquisitionPolicy({
    activation: stored.activation,
    failureBranches: stored.failureBranches,
    houseInventoryCustodyReference: stored.houseInventoryCustodyReference,
    network: stored.network,
    policyHash: stored.policyHash,
    policyVersion: stored.policyVersion,
    provider: stored.provider,
    providerSourceCustodyReference: stored.providerSourceCustodyReference,
    reviewReference: stored.reviewReference,
    reviewedAt: stored.reviewedAt.toISOString(),
    rulesHash: acquisition.rulesHash,
    rulesVersion: acquisition.rulesVersion,
    schemaVersion: stored.schemaVersion,
  });
}

function unsignedPolicy(policy: FlipAcquisitionPolicy) {
  const { policyHash: _policyHash, ...unsigned } = policy;
  return unsigned;
}

function toDatabaseBranch(
  branch: FlipAcquisitionRecoveryBranch,
): DatabaseFlipAcquisitionRecoveryBranch {
  return branch.toUpperCase() as DatabaseFlipAcquisitionRecoveryBranch;
}

async function ledgerRetainedAsset(
  transaction: Prisma.TransactionClient,
  acquisition: AcquisitionRecord,
  operation: OperationRecord,
  branch: FlipAcquisitionRecoveryBranch,
): Promise<void> {
  const purchase = await transaction.flipAcquisitionOperation.findFirst({
    where: {
      acquisitionId: acquisition.id,
      kind: DatabaseFlipAcquisitionOperationKind.PURCHASE,
      status: DatabaseFlipAcquisitionOperationStatus.FINALIZED,
    },
  });
  if (!purchase) return;
  await acquireNamespacedAdvisoryTransactionLock(
    transaction,
    acquisition.selectedAssetReference,
    POLICY_LOCK_NAMESPACE,
  );
  const existing = await transaction.houseInventoryAsset.findUnique({
    where: { assetReference: acquisition.selectedAssetReference },
  });
  if (existing) {
    if (
      existing.flipSessionId !== acquisition.sessionId ||
      existing.flipAcquisitionOperationId !== operation.id
    ) {
      throw new ConflictException('Flip retained asset already belongs to another source');
    }
    return;
  }
  const inventoryId = createId('hinv');
  await transaction.houseInventoryAsset.create({
    data: {
      acquisitionValueAmount: acquisition.selectedValueAmount,
      acquisitionValueCurrency: 'USDC',
      acquisitionValueDecimals: 6,
      assetReference: acquisition.selectedAssetReference,
      buybackEligible: false,
      custodyWallet: acquisition.houseInventoryCustodyReference,
      displayName: acquisition.selectedAssetReference,
      disposition: HouseInventoryDisposition.MANUAL_REVIEW,
      flipAcquisitionOperationId: operation.id,
      flipSessionId: acquisition.sessionId,
      id: inventoryId,
      insuredValueAmount: acquisition.selectedValueAmount,
      insuredValueCurrency: 'USDC',
      insuredValueDecimals: 6,
      listingState: HouseInventoryListingState.UNLISTED,
      status: HouseInventoryStatus.HELD,
    },
  });
  await transaction.houseTreasuryLedgerEntry.create({
    data: {
      amount: acquisition.selectedValueAmount,
      currency: 'USDC',
      decimals: 6,
      flipSessionId: acquisition.sessionId,
      id: createId('hledger'),
      idempotencyKey: `flip-recovery-inventory:${operation.id}`,
      inventoryId,
      metadata: { branch, selectionProofId: acquisition.selectionProofId },
      type: HouseTreasuryLedgerType.FLIP_RECOVERY_INVENTORY,
    },
  });
}

function toSnapshot(record: AcquisitionRecord): FlipAcquisitionSnapshot {
  return {
    finalizedOperationCount: record.finalizedOperationCount,
    operations: [...record.operations]
      .sort((left, right) => left.sequence - right.sequence)
      .map((operation) => ({
        failureCode: operation.failureCode,
        kind: operation.kind.toLowerCase() as 'purchase' | 'transfer',
        providerReference: operation.providerReference,
        recoveryMode: operation.recoveryMode.toLowerCase().replace('_', '-') as
          | 'none'
          | 'retryable'
          | 'reconcile-only',
        status: operation.status.toLowerCase().replace('_', '-') as
          | 'prepared'
          | 'recovery-required'
          | 'finalized',
      })),
    receiptHash: record.receiptHash,
    recoveryBranch: record.recoveryBranch
      ? (record.recoveryBranch.toLowerCase() as FlipAcquisitionRecoveryBranch)
      : null,
    recoveryReason: record.failureCode,
    sessionReference: record.sessionId,
    status: record.status.toLowerCase().replace('_', '-') as
      | 'pending'
      | 'recovery-required'
      | 'acquired',
  };
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new ConflictException(`Flip acquisition ${label} is invalid`);
  }
  return value;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
