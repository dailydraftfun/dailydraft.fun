import { createHash, randomUUID } from 'node:crypto';
import {
  type DatabaseClient,
  HouseInventoryDisposition,
  HouseInventoryListingState,
  HouseInventoryStatus,
  HouseTreasuryLedgerType,
  type Prisma,
} from '@dailydraft/db';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import type { Money } from '../domain.js';
import { stableStringify } from '../providers/valuation-policy.js';
import {
  CRASH_SETTLEMENT_POLICY,
  type CrashSettlementPolicy,
  validateCrashSettlementPolicy,
} from './crash-settlement.policy.js';
import {
  CRASH_SETTLEMENT_PROVIDER,
  CRASH_SETTLEMENT_PROVIDER_FIXTURE_VERSION,
  CrashSettlementAmbiguousError,
  CrashSettlementDefinitelyNotAppliedError,
  type CrashSettlementProvider,
  type CrashSettlementProviderRequest,
  type CrashSettlementProviderResult,
} from './crash-settlement.provider.js';
import {
  CRASH_ENVIRONMENT,
  CrashStateMachineError,
  crashStateFixtureModeEnabled,
} from './crash-stage-state.js';

export const CRASH_SETTLEMENT_RECEIPT_SCHEMA_VERSION =
  'dailydraft.crash-settlement-receipt.v1' as const;

const SETTLEMENT_LEASE_MS = 60_000;
const MAX_RECOVERY_BATCH = 100;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MONEY_PATTERN = /^(0|[1-9]\d*)$/;

type SettlementRecord = Prisma.CrashSettlementGetPayload<{
  include: { operations: true };
}>;
type TerminalRound = Prisma.CrashRoundGetPayload<{
  include: {
    custodyIntents: true;
    houseReservation: true;
    settlement: { include: { operations: true } };
    transitions: true;
  };
}>;

interface PlannedOperation {
  amount: string;
  assetReference: string;
  destinationReference: string;
  kind: 'LIQUIDATE' | 'OPEN' | 'PURCHASE' | 'TRANSFER';
  operationKey: string;
  providerRequestKey: string;
  requestHash: string;
  sequence: number;
  sourceReference: string;
  stage: number | null;
}

export interface CrashSettlementSnapshot {
  custodyPolicyHash: string;
  custodyPolicyVersion: string;
  expectedOperationCount: number;
  finalizedOperationCount: number;
  inventoryPolicyHash: string;
  inventoryPolicyVersion: string;
  kind: 'bust' | 'cash-out';
  operations: readonly {
    failureCode: string | null;
    kind: 'liquidate' | 'open' | 'purchase' | 'transfer';
    operationKey: string;
    providerSignature: string | null;
    recoveryMode: 'none' | 'reconcile-only' | 'retryable';
    sequence: number;
    status: 'finalized' | 'prepared' | 'recovery-required';
  }[];
  receiptHash: string | null;
  recoveryReason: string | null;
  roundId: string;
  settlementPolicyHash: string;
  settlementPolicyVersion: string;
  settledAt: string | null;
  status: 'pending' | 'recovery-required' | 'settled';
}

@Injectable()
export class CrashSettlementService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    @Inject(CRASH_SETTLEMENT_POLICY) private readonly configuredPolicy: unknown,
    @Inject(CRASH_SETTLEMENT_PROVIDER) private readonly provider: CrashSettlementProvider,
    @Inject(CRASH_ENVIRONMENT) private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async resumeFixtureSettlement(roundId: string): Promise<CrashSettlementSnapshot> {
    this.requireFixtureMode();
    const policy = this.requirePolicy();
    const settlement = await this.ensurePlan(roundId, policy);
    if (settlement.status === 'SETTLED') return toSnapshot(settlement);

    const leaseOwner = randomUUID();
    const now = new Date();
    const claimed = await this.database.crashSettlement.updateMany({
      data: {
        leaseExpiresAt: new Date(now.getTime() + SETTLEMENT_LEASE_MS),
        leaseOwner,
        version: { increment: 1 },
      },
      where: {
        id: settlement.id,
        status: { in: ['PENDING', 'RECOVERY_REQUIRED'] },
        OR: [{ leaseOwner: null }, { leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
    });
    if (claimed.count !== 1) {
      return toSnapshot(await this.requireSettlement(settlement.id));
    }

    try {
      for (const candidate of settlement.operations.sort(
        (left, right) => left.sequence - right.sequence,
      )) {
        const current = await this.database.crashSettlementOperation.findUnique({
          where: { id: candidate.id },
        });
        if (!current || current.status === 'FINALIZED') continue;
        const request = operationRequest(roundId, current);
        const reconciled = await this.provider.reconcile(request);
        if (reconciled) {
          await this.finalizeOperation(settlement.id, current.id, current.requestHash, reconciled);
          continue;
        }
        if (current.recoveryMode === 'RECONCILE_ONLY') {
          await this.recordRecovery(
            settlement.id,
            current.id,
            leaseOwner,
            'PROVIDER_RESULT_AMBIGUOUS',
            'RECONCILE_ONLY',
            current.providerSignature,
            false,
          );
          return toSnapshot(await this.requireSettlement(settlement.id));
        }

        let result: CrashSettlementProviderResult;
        try {
          result = await this.provider.execute(request);
        } catch (error) {
          if (error instanceof CrashSettlementDefinitelyNotAppliedError) {
            await this.recordRecovery(
              settlement.id,
              current.id,
              leaseOwner,
              error.code,
              'RETRYABLE',
              null,
              true,
            );
          } else {
            const ambiguous =
              error instanceof CrashSettlementAmbiguousError
                ? error
                : new CrashSettlementAmbiguousError('PROVIDER_RESPONSE_AMBIGUOUS');
            await this.recordRecovery(
              settlement.id,
              current.id,
              leaseOwner,
              ambiguous.code,
              'RECONCILE_ONLY',
              ambiguous.signature,
              true,
            );
          }
          return toSnapshot(await this.requireSettlement(settlement.id));
        }
        await this.finalizeOperation(settlement.id, current.id, current.requestHash, result, true);
      }

      return toSnapshot(await this.finalizeSettlement(settlement.id, leaseOwner));
    } catch (error) {
      await this.releaseLease(settlement.id, leaseOwner).catch(() => undefined);
      throw error;
    }
  }

  async reconcilePendingFixtureSettlements(
    limit = MAX_RECOVERY_BATCH,
  ): Promise<{ checked: number; recovered: number; settled: number }> {
    this.requireFixtureMode();
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECOVERY_BATCH) {
      throw new CrashStateMachineError('INVALID_EVIDENCE', 'Crash settlement batch is invalid');
    }
    const candidates = await this.database.crashSettlement.findMany({
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      select: { roundId: true, status: true },
      take: limit,
      where: { status: { in: ['PENDING', 'RECOVERY_REQUIRED'] } },
    });
    const summary = { checked: 0, recovered: 0, settled: 0 };
    for (const candidate of candidates) {
      summary.checked += 1;
      const result = await this.resumeFixtureSettlement(candidate.roundId);
      if (candidate.status === 'RECOVERY_REQUIRED' && result.status !== 'recovery-required') {
        summary.recovered += 1;
      }
      if (result.status === 'settled') summary.settled += 1;
    }
    return summary;
  }

  async findFixtureSettlement(roundId: string): Promise<CrashSettlementSnapshot | null> {
    this.requireFixtureMode();
    const policy = this.requirePolicy();
    const round = await this.loadTerminalRound(roundId);
    if (!round.settlement) {
      if (round.status === 'ACTIVE') return null;
      throw new CrashStateMachineError(
        'INVALID_EVIDENCE',
        'Crash terminal settlement evidence is incomplete',
      );
    }
    assertVerifiedSettlement(round, round.settlement, policy);
    return toSnapshot(round.settlement);
  }

  private async ensurePlan(
    roundId: string,
    policy: CrashSettlementPolicy,
  ): Promise<SettlementRecord> {
    const round = await this.loadTerminalRound(roundId);
    assertPolicyBinding(round, policy);
    const terminal = round.transitions.at(-1);
    if (!terminal || terminal.toStatus === 'ACTIVE') {
      throw new CrashStateMachineError(
        'INVALID_TRANSITION',
        'Crash settlement requires a terminal round',
      );
    }
    const { idempotencyKey, kind, operations, requestHash } = settlementPlan(
      round,
      policy,
      terminal,
    );

    if (round.settlement) {
      assertPlanReplay(round.settlement, requestHash);
      return round.settlement;
    }

    try {
      const created = await this.database.$transaction(
        async (transaction) => {
          const existing = await transaction.crashSettlement.findUnique({
            include: { operations: true },
            where: { roundId },
          });
          if (existing) {
            assertPlanReplay(existing, requestHash);
            return existing;
          }
          const reservation = await transaction.houseTreasuryReservation.findUnique({
            where: { crashRoundId: roundId },
          });
          if (
            !reservation ||
            reservation.riskRulesHash !== policy.riskRulesHash ||
            reservation.status !== 'RELEASED'
          ) {
            throw new CrashStateMachineError(
              'INVALID_EVIDENCE',
              'Crash settlement requires the exact released risk reservation',
            );
          }
          const settlementId = createId('crashsettlement');
          const created = await transaction.crashSettlement.create({
            data: {
              activationMode: 'fixture-only',
              architectureVersion: round.architectureVersion,
              calculatorVersion: round.calculatorVersion,
              custodyRecipient: policy.approvedSessionCustody,
              custodyPolicyHash: policy.custodyPolicyHash,
              custodyPolicyVersion: policy.custodyPolicyVersion,
              expectedOperationCount: operations.length,
              id: settlementId,
              idempotencyKey,
              inventoryPolicyHash: policy.inventoryPolicyHash,
              inventoryPolicyVersion: policy.inventoryPolicyVersion,
              inventoryRecipient: policy.approvedInventoryCustody,
              kind,
              network: 'solana-devnet',
              operations: {
                create: operations.map((operation) => ({
                  ...operation,
                  currency: 'USDC',
                  decimals: 6,
                  id: createId('crashsettlementop'),
                })),
              },
              playerWalletReference: round.playerWalletReference,
              requestHash,
              riskRulesHash: policy.riskRulesHash,
              riskRulesVersion: policy.riskRulesVersion,
              roundId,
              rulesHash: round.rulesHash,
              rulesVersion: round.rulesVersion,
              settlementPolicyHash: policy.policyHash,
              settlementPolicyVersion: policy.policyVersion,
              stateMachineRulesHash: round.stateMachineRulesHash,
              stateMachineVersion: round.stateMachineVersion,
              status: 'PENDING',
              terminalTransitionId: terminal.id,
            },
            include: { operations: true },
          });
          await transaction.crashRound.updateMany({
            data: { settlementStatus: 'PENDING' },
            where: {
              id: roundId,
              settlementStatus: { in: ['NOT_REQUIRED', 'PENDING'] },
              status: { not: 'ACTIVE' },
            },
          });
          return created;
        },
        { isolationLevel: 'Serializable' },
      );
      return created;
    } catch (error) {
      const concurrent = await this.database.crashSettlement.findUnique({
        include: { operations: true },
        where: { roundId },
      });
      if (concurrent) {
        assertPlanReplay(concurrent, requestHash);
        return concurrent;
      }
      throw error;
    }
  }

  private async finalizeOperation(
    settlementId: string,
    operationId: string,
    requestHash: string,
    result: CrashSettlementProviderResult,
    executed = false,
  ): Promise<void> {
    if (
      !result.finalized ||
      !HASH_PATTERN.test(result.resultHash) ||
      !result.signature ||
      result.evidence.providerRequestKey.length === 0
    ) {
      throw new CrashStateMachineError(
        'INVALID_EVIDENCE',
        'Crash settlement provider finality evidence is invalid',
      );
    }
    await this.database.$transaction(async (transaction) => {
      const current = await transaction.crashSettlementOperation.findUnique({
        where: { id: operationId },
      });
      if (
        !current ||
        current.settlementId !== settlementId ||
        current.requestHash !== requestHash
      ) {
        throw new CrashStateMachineError(
          'INVALID_EVIDENCE',
          'Crash settlement operation binding changed',
        );
      }
      if (result.evidence.providerRequestKey !== current.providerRequestKey) {
        throw new CrashStateMachineError(
          'INVALID_EVIDENCE',
          'Crash settlement provider evidence belongs to another request',
        );
      }
      if (current.status === 'FINALIZED') {
        if (
          current.providerSignature !== result.signature ||
          current.providerResultHash !== result.resultHash
        ) {
          throw new CrashStateMachineError(
            'IDEMPOTENCY_MISMATCH',
            'Crash settlement operation finalized with different evidence',
          );
        }
        return;
      }
      const changed = await transaction.crashSettlementOperation.updateMany({
        data: {
          failureCode: null,
          finalizedAt: new Date(),
          lastAttemptedAt: new Date(),
          providerEvidence: result.evidence as unknown as Prisma.InputJsonValue,
          providerResultHash: result.resultHash,
          providerSignature: result.signature,
          recoveryMode: 'NONE',
          status: 'FINALIZED',
          ...(executed ? { submissionCount: { increment: 1 } } : {}),
        },
        where: { id: operationId, requestHash, status: { not: 'FINALIZED' } },
      });
      if (changed.count !== 1) {
        throw new CrashStateMachineError(
          'CONCURRENT_TRANSITION',
          'Crash settlement operation changed concurrently',
        );
      }
      const finalizedOperationCount = await transaction.crashSettlementOperation.count({
        where: { settlementId, status: 'FINALIZED' },
      });
      await transaction.crashSettlement.updateMany({
        data: {
          finalizedOperationCount,
          recoveryReason: null,
          status: 'PENDING',
          version: { increment: 1 },
        },
        where: { id: settlementId, status: { not: 'SETTLED' } },
      });
    });
  }

  private async recordRecovery(
    settlementId: string,
    operationId: string,
    leaseOwner: string,
    failureCode: string,
    recoveryMode: 'RECONCILE_ONLY' | 'RETRYABLE',
    signature: string | null,
    attempted: boolean,
  ): Promise<void> {
    const now = new Date();
    await this.database.$transaction(async (transaction) => {
      await transaction.crashSettlementOperation.updateMany({
        data: {
          failureCode,
          lastAttemptedAt: now,
          ...(signature ? { providerSignature: signature } : {}),
          recoveryMode,
          status: 'RECOVERY_REQUIRED',
          ...(attempted ? { submissionCount: { increment: 1 } } : {}),
        },
        where: { id: operationId, settlementId, status: { not: 'FINALIZED' } },
      });
      await transaction.crashSettlement.updateMany({
        data: {
          leaseExpiresAt: null,
          leaseOwner: null,
          recoveryReason: `${operationId}:${failureCode}`,
          status: 'RECOVERY_REQUIRED',
          version: { increment: 1 },
        },
        where: { id: settlementId, leaseOwner, status: { not: 'SETTLED' } },
      });
      await transaction.crashRound.updateMany({
        data: { settlementStatus: 'RECOVERY_REQUIRED' },
        where: { settlement: { is: { id: settlementId } } },
      });
    });
  }

  private async finalizeSettlement(
    settlementId: string,
    leaseOwner: string,
  ): Promise<SettlementRecord> {
    return this.database.$transaction(
      async (transaction) => {
        const settlement = await transaction.crashSettlement.findUnique({
          include: { operations: { orderBy: { sequence: 'asc' } } },
          where: { id: settlementId },
        });
        if (!settlement) {
          throw new CrashStateMachineError('NOT_FOUND', 'Crash settlement was not found');
        }
        if (settlement.status === 'SETTLED') return settlement;
        if (
          settlement.leaseOwner !== leaseOwner ||
          settlement.operations.length !== settlement.expectedOperationCount ||
          settlement.operations.some(
            (operation) =>
              operation.status !== 'FINALIZED' ||
              !operation.providerSignature ||
              !operation.providerResultHash ||
              !operation.finalizedAt,
          )
        ) {
          throw new CrashStateMachineError(
            'INVALID_EVIDENCE',
            'Crash settlement cannot finalize before every promised side effect',
          );
        }
        const round = await transaction.crashRound.findUnique({
          include: {
            houseReservation: true,
            transitions: { orderBy: { sequence: 'asc' } },
          },
          where: { id: settlement.roundId },
        });
        const terminal = round?.transitions.at(-1);
        if (
          !round ||
          !terminal ||
          terminal.id !== settlement.terminalTransitionId ||
          round.houseReservation?.status !== 'RELEASED' ||
          round.houseReservation.riskRulesHash !== settlement.riskRulesHash
        ) {
          throw new CrashStateMachineError(
            'INVALID_EVIDENCE',
            'Crash settlement terminal or risk evidence is incomplete',
          );
        }

        const receipt = settlementReceipt(settlement, terminal);
        const receiptHash = sha256(stableStringify(receipt));
        if (settlement.kind === 'BUST') {
          await recordBustInventory(transaction, settlement);
        }
        const now = new Date();
        const changed = await transaction.crashSettlement.updateMany({
          data: {
            finalizedOperationCount: settlement.expectedOperationCount,
            leaseExpiresAt: null,
            leaseOwner: null,
            receipt: receipt as unknown as Prisma.InputJsonValue,
            receiptHash,
            recoveryReason: null,
            settledAt: now,
            status: 'SETTLED',
            version: { increment: 1 },
          },
          where: {
            id: settlement.id,
            leaseOwner,
            status: { not: 'SETTLED' },
            version: settlement.version,
          },
        });
        if (changed.count !== 1) {
          throw new CrashStateMachineError(
            'CONCURRENT_TRANSITION',
            'Crash settlement finalized concurrently',
          );
        }
        const roundChanged = await transaction.crashRound.updateMany({
          data: {
            settledAt: now,
            settlementReceiptHash: receiptHash,
            settlementStatus: 'SETTLED',
          },
          where: {
            id: settlement.roundId,
            settlementReceiptHash: null,
            settlementStatus: { in: ['PENDING', 'RECOVERY_REQUIRED'] },
            status: { not: 'ACTIVE' },
          },
        });
        if (roundChanged.count !== 1) {
          throw new CrashStateMachineError(
            'CONCURRENT_TRANSITION',
            'Crash round settlement state changed concurrently',
          );
        }
        return transaction.crashSettlement.findUniqueOrThrow({
          include: { operations: { orderBy: { sequence: 'asc' } } },
          where: { id: settlement.id },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async loadTerminalRound(roundId: string): Promise<TerminalRound> {
    const round = await this.database.crashRound.findUnique({
      include: {
        custodyIntents: true,
        houseReservation: true,
        settlement: { include: { operations: { orderBy: { sequence: 'asc' } } } },
        transitions: { orderBy: { sequence: 'asc' } },
      },
      where: { id: roundId },
    });
    if (!round) {
      throw new CrashStateMachineError('NOT_FOUND', `Crash round ${roundId} was not found`);
    }
    return round;
  }

  private async requireSettlement(settlementId: string): Promise<SettlementRecord> {
    const row = await this.database.crashSettlement.findUnique({
      include: { operations: { orderBy: { sequence: 'asc' } } },
      where: { id: settlementId },
    });
    if (!row) throw new CrashStateMachineError('NOT_FOUND', 'Crash settlement was not found');
    return row;
  }

  private requireFixtureMode(): void {
    if (!crashStateFixtureModeEnabled(this.environment)) {
      throw new CrashStateMachineError(
        'DISABLED',
        'Crash settlement is disabled outside explicit fixture or preview mode',
      );
    }
  }

  private requirePolicy(): CrashSettlementPolicy {
    try {
      return validateCrashSettlementPolicy(this.configuredPolicy);
    } catch {
      throw new CrashStateMachineError(
        'DISABLED',
        'Crash settlement requires one exact fixture settlement and inventory policy',
      );
    }
  }

  private async releaseLease(settlementId: string, leaseOwner: string): Promise<void> {
    await this.database.crashSettlement.updateMany({
      data: { leaseExpiresAt: null, leaseOwner: null, version: { increment: 1 } },
      where: { id: settlementId, leaseOwner, status: { not: 'SETTLED' } },
    });
  }
}

function planOperations(
  round: TerminalRound,
  policy: CrashSettlementPolicy,
  kind: 'BUST' | 'CASH_OUT',
): PlannedOperation[] {
  const operations: Omit<PlannedOperation, 'providerRequestKey' | 'requestHash' | 'sequence'>[] =
    [];
  const promisedAssets = round.transitions.flatMap((transition) => {
    if (!transition.outcome) return [];
    const outcome = parseOutcome(transition.outcome);
    const intent = round.custodyIntents.find(
      (candidate) =>
        candidate.id === outcome.custodyReference &&
        candidate.assetReference === outcome.assetReference &&
        candidate.stage === outcome.stage,
    );
    if (
      !intent ||
      intent.status !== 'PREPARED' ||
      intent.signingStatus !== 'NOT_STARTED' ||
      intent.approvedRecipient !== policy.approvedSessionCustody ||
      intent.policyHash !== policy.custodyPolicyHash ||
      intent.policyVersion !== policy.custodyPolicyVersion
    ) {
      throw new CrashStateMachineError(
        'INVALID_EVIDENCE',
        'Crash settlement asset lacks approved custody evidence',
      );
    }
    return [{ ...outcome, sourceReference: intent.sourceWalletReference }];
  });

  for (const asset of promisedAssets) {
    operations.push({
      amount: asset.amount,
      assetReference: asset.assetReference,
      destinationReference: policy.approvedSessionCustody,
      kind: 'PURCHASE',
      operationKey: `stage:${asset.stage}:purchase:${asset.assetReference}`,
      sourceReference: asset.sourceReference,
      stage: asset.stage,
    });
    operations.push({
      amount: asset.amount,
      assetReference: asset.assetReference,
      destinationReference: policy.approvedSessionCustody,
      kind: 'OPEN',
      operationKey: `stage:${asset.stage}:open:${asset.assetReference}`,
      sourceReference: policy.approvedSessionCustody,
      stage: asset.stage,
    });
    operations.push({
      amount: asset.amount,
      assetReference: asset.assetReference,
      destinationReference:
        kind === 'CASH_OUT' ? round.playerWalletReference : policy.approvedInventoryCustody,
      kind: 'TRANSFER',
      operationKey: `stage:${asset.stage}:transfer:${asset.assetReference}`,
      sourceReference: policy.approvedSessionCustody,
      stage: asset.stage,
    });
    if (kind === 'BUST' && policy.bustDisposition === 'liquidate') {
      operations.push({
        amount: asset.amount,
        assetReference: asset.assetReference,
        destinationReference: policy.approvedInventoryCustody,
        kind: 'LIQUIDATE',
        operationKey: `stage:${asset.stage}:liquidate:${asset.assetReference}`,
        sourceReference: policy.approvedInventoryCustody,
        stage: asset.stage,
      });
    }
  }

  if (kind === 'CASH_OUT' && BigInt(round.potAmount) > 0n) {
    operations.push({
      amount: round.potAmount,
      assetReference: `fixture-proceeds:${sha256(round.id).slice(0, 32)}`,
      destinationReference: round.playerWalletReference,
      kind: 'TRANSFER',
      operationKey: `proceeds:transfer:${round.id}`,
      sourceReference: policy.approvedSessionCustody,
      stage: null,
    });
  }

  return operations.map((operation, index) => {
    const sequence = index + 1;
    const providerRequestKey = `crash-settlement:${sha256(
      stableStringify({
        operationKey: operation.operationKey,
        policyHash: policy.policyHash,
        roundId: round.id,
      }),
    )}`;
    const requestHash = sha256(
      stableStringify({
        ...operation,
        currency: 'USDC',
        decimals: 6,
        providerRequestKey,
        roundId: round.id,
        sequence,
      }),
    );
    return { ...operation, providerRequestKey, requestHash, sequence };
  });
}

function parseOutcome(value: Prisma.JsonValue): {
  amount: string;
  assetReference: string;
  custodyReference: string;
  stage: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidOutcome();
  }
  const custody = value.custody;
  const provider = value.provider;
  if (
    !custody ||
    typeof custody !== 'object' ||
    Array.isArray(custody) ||
    !provider ||
    typeof provider !== 'object' ||
    Array.isArray(provider) ||
    typeof custody.assetReference !== 'string' ||
    typeof custody.reference !== 'string' ||
    typeof provider.stage !== 'number' ||
    !provider.stageValue ||
    typeof provider.stageValue !== 'object' ||
    Array.isArray(provider.stageValue) ||
    typeof provider.stageValue.amount !== 'string' ||
    !MONEY_PATTERN.test(provider.stageValue.amount) ||
    provider.stageValue.currency !== 'USDC' ||
    provider.stageValue.decimals !== 6
  ) {
    throw invalidOutcome();
  }
  return {
    amount: provider.stageValue.amount,
    assetReference: custody.assetReference,
    custodyReference: custody.reference,
    stage: provider.stage,
  };
}

function invalidOutcome(): CrashStateMachineError {
  return new CrashStateMachineError(
    'INVALID_EVIDENCE',
    'Crash terminal outcome does not bind canonical custody and value evidence',
  );
}

function assertPolicyBinding(round: TerminalRound, policy: CrashSettlementPolicy): void {
  if (
    round.activationMode !== 'fixture-only' ||
    round.architectureVersion !== policy.architectureVersion ||
    round.stateMachineVersion !== policy.stateMachineVersion ||
    round.stateMachineRulesHash !== policy.stateMachineRulesHash ||
    round.calculatorVersion !== policy.calculatorVersion ||
    round.rulesVersion !== policy.rulesVersion ||
    round.rulesHash !== policy.rulesHash ||
    round.riskRulesVersion !== policy.riskRulesVersion ||
    round.riskRulesHash !== policy.riskRulesHash
  ) {
    throw new CrashStateMachineError(
      'DISABLED',
      'Crash settlement policy does not match the round rule, calculator, or risk binding',
    );
  }
}

function assertPlanReplay(settlement: { requestHash: string }, requestHash: string): void {
  if (settlement.requestHash !== requestHash) {
    throw new CrashStateMachineError(
      'IDEMPOTENCY_MISMATCH',
      'Crash terminal settlement plan changed across replay',
    );
  }
}

function settlementPlan(
  round: TerminalRound,
  policy: CrashSettlementPolicy,
  terminal: TerminalRound['transitions'][number],
): {
  idempotencyKey: string;
  kind: 'BUST' | 'CASH_OUT';
  operations: PlannedOperation[];
  requestHash: string;
} {
  const kind = terminalKind(round.status);
  const operations = planOperations(round, policy, kind);
  return {
    idempotencyKey: `terminal:${terminal.id}`,
    kind,
    operations,
    requestHash: sha256(
      stableStringify({
        kind,
        operations,
        policy: policyBinding(policy),
        round: roundBinding(round),
        terminalTransition: terminalBinding(terminal),
      }),
    ),
  };
}

function assertVerifiedSettlement(
  round: TerminalRound,
  settlement: SettlementRecord,
  policy: CrashSettlementPolicy,
): void {
  assertPolicyBinding(round, policy);
  const terminal = round.transitions.at(-1);
  if (!terminal || terminal.toStatus === 'ACTIVE') {
    throw invalidSettlementEvidence('terminal transition is missing');
  }
  const expected = settlementPlan(round, policy, terminal);
  assertPlanReplay(settlement, expected.requestHash);
  const exactBinding =
    settlement.activationMode === 'fixture-only' &&
    settlement.network === 'solana-devnet' &&
    settlement.roundId === round.id &&
    settlement.terminalTransitionId === terminal.id &&
    settlement.idempotencyKey === expected.idempotencyKey &&
    settlement.kind === expected.kind &&
    settlement.playerWalletReference === round.playerWalletReference &&
    settlement.custodyRecipient === policy.approvedSessionCustody &&
    settlement.custodyPolicyHash === policy.custodyPolicyHash &&
    settlement.custodyPolicyVersion === policy.custodyPolicyVersion &&
    settlement.inventoryRecipient === policy.approvedInventoryCustody &&
    settlement.inventoryPolicyHash === policy.inventoryPolicyHash &&
    settlement.inventoryPolicyVersion === policy.inventoryPolicyVersion &&
    settlement.settlementPolicyHash === policy.policyHash &&
    settlement.settlementPolicyVersion === policy.policyVersion &&
    settlement.expectedOperationCount === expected.operations.length &&
    settlement.operations.length === expected.operations.length;
  if (!exactBinding) throw invalidSettlementEvidence('durable bindings changed');

  for (const [index, operation] of settlement.operations
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .entries()) {
    const planned = expected.operations[index];
    if (
      !planned ||
      operation.sequence !== planned.sequence ||
      operation.operationKey !== planned.operationKey ||
      operation.providerRequestKey !== planned.providerRequestKey ||
      operation.requestHash !== planned.requestHash ||
      operation.kind !== planned.kind ||
      operation.assetReference !== planned.assetReference ||
      operation.sourceReference !== planned.sourceReference ||
      operation.destinationReference !== planned.destinationReference ||
      operation.amount !== planned.amount ||
      operation.currency !== 'USDC' ||
      operation.decimals !== 6 ||
      operation.stage !== planned.stage
    ) {
      throw invalidSettlementEvidence('operation plan changed');
    }
    assertOperationEvidence(operation);
  }

  const finalizedCount = settlement.operations.filter(
    ({ status }) => status === 'FINALIZED',
  ).length;
  if (settlement.finalizedOperationCount !== finalizedCount) {
    throw invalidSettlementEvidence('finalized operation count changed');
  }
  if (round.settlementStatus !== settlement.status) {
    throw invalidSettlementEvidence('round and settlement status conflict');
  }

  if (settlement.status === 'SETTLED') {
    const recomputed = settlementReceipt(settlement, terminal);
    const recomputedHash = sha256(stableStringify(recomputed));
    if (
      finalizedCount !== settlement.expectedOperationCount ||
      settlement.recoveryReason !== null ||
      !settlement.receipt ||
      stableStringify(settlement.receipt) !== stableStringify(recomputed) ||
      settlement.receiptHash !== recomputedHash ||
      round.settlementReceiptHash !== recomputedHash ||
      !settlement.settledAt ||
      !round.settledAt ||
      settlement.settledAt.getTime() !== round.settledAt.getTime()
    ) {
      throw invalidSettlementEvidence('settled receipt is incomplete or tampered');
    }
    return;
  }

  if (
    settlement.receipt !== null ||
    settlement.receiptHash !== null ||
    settlement.settledAt !== null ||
    round.settlementReceiptHash !== null ||
    round.settledAt !== null
  ) {
    throw invalidSettlementEvidence('non-final settlement claims finality');
  }
  const recoveryOperations = settlement.operations.filter(
    ({ status }) => status === 'RECOVERY_REQUIRED',
  );
  if (
    (settlement.status === 'RECOVERY_REQUIRED' &&
      (recoveryOperations.length === 0 || !settlement.recoveryReason)) ||
    (settlement.status === 'PENDING' &&
      (recoveryOperations.length > 0 || settlement.recoveryReason !== null))
  ) {
    throw invalidSettlementEvidence('recovery state is ambiguous');
  }
}

function assertOperationEvidence(operation: SettlementRecord['operations'][number]): void {
  const providerEvidence =
    operation.providerEvidence &&
    typeof operation.providerEvidence === 'object' &&
    !Array.isArray(operation.providerEvidence)
      ? operation.providerEvidence
      : null;
  const finalized =
    operation.status === 'FINALIZED' &&
    operation.recoveryMode === 'NONE' &&
    operation.failureCode === null &&
    Boolean(operation.providerSignature) &&
    Boolean(operation.providerResultHash && HASH_PATTERN.test(operation.providerResultHash)) &&
    providerEvidence?.providerRequestKey === operation.providerRequestKey &&
    providerEvidence.schemaVersion === CRASH_SETTLEMENT_PROVIDER_FIXTURE_VERSION &&
    Object.keys(providerEvidence).sort().join(',') === 'providerRequestKey,schemaVersion' &&
    Boolean(operation.finalizedAt);
  const prepared =
    operation.status === 'PREPARED' &&
    operation.recoveryMode === 'NONE' &&
    operation.failureCode === null &&
    operation.providerSignature === null &&
    operation.providerResultHash === null &&
    operation.finalizedAt === null;
  const recovering =
    operation.status === 'RECOVERY_REQUIRED' &&
    operation.recoveryMode !== 'NONE' &&
    Boolean(operation.failureCode) &&
    operation.providerResultHash === null &&
    operation.finalizedAt === null;
  if (!finalized && !prepared && !recovering) {
    throw invalidSettlementEvidence('operation finality is ambiguous');
  }
}

function invalidSettlementEvidence(detail: string): CrashStateMachineError {
  return new CrashStateMachineError('INVALID_EVIDENCE', `Crash verified settlement ${detail}`);
}

function operationRequest(
  roundId: string,
  operation: {
    amount: string;
    assetReference: string;
    currency: string;
    decimals: number;
    destinationReference: string;
    kind: 'LIQUIDATE' | 'OPEN' | 'PURCHASE' | 'TRANSFER';
    operationKey: string;
    providerRequestKey: string;
    requestHash: string;
    sequence: number;
    sourceReference: string;
    stage: number | null;
  },
): CrashSettlementProviderRequest {
  if (
    operation.currency !== 'USDC' ||
    operation.decimals !== 6 ||
    !MONEY_PATTERN.test(operation.amount)
  ) {
    throw new CrashStateMachineError(
      'INVALID_EVIDENCE',
      'Crash settlement operation value is not canonical USDC',
    );
  }
  return {
    amount: operation.amount,
    assetReference: operation.assetReference,
    currency: 'USDC',
    decimals: 6,
    destinationReference: operation.destinationReference,
    kind: operation.kind.toLowerCase() as CrashSettlementProviderRequest['kind'],
    operationKey: operation.operationKey,
    providerRequestKey: operation.providerRequestKey,
    requestHash: operation.requestHash,
    roundId,
    sequence: operation.sequence,
    sourceReference: operation.sourceReference,
    stage: operation.stage,
  };
}

function settlementReceipt(
  settlement: SettlementRecord,
  terminal: {
    id: string;
    kind: string;
    outcome: Prisma.JsonValue | null;
    settlement: Prisma.JsonValue | null;
    terminalReason: string | null;
    valueChange: Prisma.JsonValue | null;
  },
) {
  return {
    bindings: {
      architectureVersion: settlement.architectureVersion,
      calculatorVersion: settlement.calculatorVersion,
      custodyPolicyHash: settlement.custodyPolicyHash,
      custodyPolicyVersion: settlement.custodyPolicyVersion,
      inventoryPolicyHash: settlement.inventoryPolicyHash,
      inventoryPolicyVersion: settlement.inventoryPolicyVersion,
      riskRulesHash: settlement.riskRulesHash,
      riskRulesVersion: settlement.riskRulesVersion,
      rulesHash: settlement.rulesHash,
      rulesVersion: settlement.rulesVersion,
      settlementPolicyHash: settlement.settlementPolicyHash,
      settlementPolicyVersion: settlement.settlementPolicyVersion,
      stateMachineRulesHash: settlement.stateMachineRulesHash,
      stateMachineVersion: settlement.stateMachineVersion,
    },
    kind: settlement.kind.toLowerCase(),
    operations: settlement.operations.map((operation) => ({
      amount: money(operation.amount),
      assetReference: operation.assetReference,
      destinationReference: operation.destinationReference,
      kind: operation.kind.toLowerCase(),
      operationKey: operation.operationKey,
      providerResultHash: operation.providerResultHash,
      providerSignature: operation.providerSignature,
      requestHash: operation.requestHash,
      sequence: operation.sequence,
      sourceReference: operation.sourceReference,
      stage: operation.stage,
    })),
    roundId: settlement.roundId,
    schemaVersion: CRASH_SETTLEMENT_RECEIPT_SCHEMA_VERSION,
    terminal: {
      id: terminal.id,
      kind: terminal.kind.toLowerCase(),
      outcome: terminal.outcome,
      promisedSettlement: terminal.settlement,
      terminalReason: terminal.terminalReason,
      valueChange: terminal.valueChange,
    },
  };
}

async function recordBustInventory(
  transaction: Prisma.TransactionClient,
  settlement: SettlementRecord,
): Promise<void> {
  const transferOperations = settlement.operations.filter(
    (operation) =>
      operation.kind === 'TRANSFER' &&
      operation.stage !== null &&
      operation.destinationReference === settlement.inventoryRecipient,
  );
  for (const operation of transferOperations) {
    const existing = await transaction.houseInventoryAsset.findUnique({
      where: { crashSettlementOperationId: operation.id },
    });
    if (existing) {
      if (
        existing.crashRoundId !== settlement.roundId ||
        existing.assetReference !== operation.assetReference ||
        existing.custodyWallet !== settlement.inventoryRecipient
      ) {
        throw new CrashStateMachineError(
          'IDEMPOTENCY_MISMATCH',
          'Crash forfeited inventory source changed across settlement replay',
        );
      }
      continue;
    }
    const liquidated = settlement.operations.find(
      (candidate) =>
        candidate.kind === 'LIQUIDATE' &&
        candidate.assetReference === operation.assetReference &&
        candidate.stage === operation.stage,
    );
    const inventoryId = createId('hinv');
    await transaction.houseInventoryAsset.create({
      data: {
        acquisitionValueAmount: operation.amount,
        acquisitionValueCurrency: operation.currency,
        acquisitionValueDecimals: operation.decimals,
        assetReference: operation.assetReference,
        buybackEligible: false,
        crashRoundId: settlement.roundId,
        crashSettlementOperationId: operation.id,
        custodyWallet: settlement.inventoryRecipient,
        displayName: `Crash fixture stage ${operation.stage} forfeiture`,
        disposition: liquidated
          ? HouseInventoryDisposition.LIST
          : HouseInventoryDisposition.MANUAL_REVIEW,
        id: inventoryId,
        insuredValueAmount: operation.amount,
        insuredValueCurrency: operation.currency,
        insuredValueDecimals: operation.decimals,
        listingState: liquidated
          ? HouseInventoryListingState.SOLD
          : HouseInventoryListingState.UNLISTED,
        ...(liquidated
          ? {
              disposedAt: liquidated.finalizedAt,
              realizedAmount: liquidated.amount,
              realizedCurrency: liquidated.currency,
              realizedDecimals: liquidated.decimals,
              status: HouseInventoryStatus.DISPOSED,
            }
          : { status: HouseInventoryStatus.HELD }),
      },
    });
    await transaction.houseTreasuryLedgerEntry.create({
      data: {
        amount: operation.amount,
        crashRoundId: settlement.roundId,
        currency: operation.currency,
        decimals: operation.decimals,
        id: createId('hled'),
        idempotencyKey: `crash-forfeit-inventory:${operation.id}`,
        inventoryId,
        metadata: {
          inventoryPolicyHash: settlement.inventoryPolicyHash,
          inventoryPolicyVersion: settlement.inventoryPolicyVersion,
          settlementPolicyHash: settlement.settlementPolicyHash,
          settlementReceiptPending: true,
          stage: operation.stage,
        } as unknown as Prisma.InputJsonValue,
        type: HouseTreasuryLedgerType.CRASH_FORFEIT_INVENTORY,
      },
    });
  }
}

function terminalKind(status: string): 'BUST' | 'CASH_OUT' {
  if (status === 'CASHED_OUT' || status === 'COMPLETED') return 'CASH_OUT';
  if (status === 'BUSTED' || status === 'DEFAULTED') return 'BUST';
  throw new CrashStateMachineError(
    'INVALID_TRANSITION',
    'Crash settlement requires a terminal outcome',
  );
}

function policyBinding(policy: CrashSettlementPolicy) {
  return {
    custodyPolicyHash: policy.custodyPolicyHash,
    custodyPolicyVersion: policy.custodyPolicyVersion,
    inventoryPolicyHash: policy.inventoryPolicyHash,
    inventoryPolicyVersion: policy.inventoryPolicyVersion,
    policyHash: policy.policyHash,
    policyVersion: policy.policyVersion,
  };
}

function roundBinding(round: TerminalRound) {
  return {
    architectureVersion: round.architectureVersion,
    calculatorVersion: round.calculatorVersion,
    playerWalletReference: round.playerWalletReference,
    pot: money(round.potAmount),
    riskRulesHash: round.riskRulesHash,
    riskRulesVersion: round.riskRulesVersion,
    rulesHash: round.rulesHash,
    rulesVersion: round.rulesVersion,
    stateMachineRulesHash: round.stateMachineRulesHash,
    stateMachineVersion: round.stateMachineVersion,
  };
}

function terminalBinding(terminal: TerminalRound['transitions'][number]) {
  return {
    id: terminal.id,
    kind: terminal.kind,
    outcome: terminal.outcome,
    settlement: terminal.settlement,
    terminalReason: terminal.terminalReason,
    valueChange: terminal.valueChange,
  };
}

function money(amount: string): Money {
  return { amount, currency: 'USDC', decimals: 6 };
}

function toSnapshot(row: SettlementRecord): CrashSettlementSnapshot {
  return {
    custodyPolicyHash: row.custodyPolicyHash,
    custodyPolicyVersion: row.custodyPolicyVersion,
    expectedOperationCount: row.expectedOperationCount,
    finalizedOperationCount: row.finalizedOperationCount,
    inventoryPolicyHash: row.inventoryPolicyHash,
    inventoryPolicyVersion: row.inventoryPolicyVersion,
    kind: row.kind === 'BUST' ? 'bust' : 'cash-out',
    operations: [...row.operations]
      .sort((left, right) => left.sequence - right.sequence)
      .map((operation) => ({
        failureCode: operation.failureCode,
        kind: operation.kind.toLowerCase() as 'liquidate' | 'open' | 'purchase' | 'transfer',
        operationKey: operation.operationKey,
        providerSignature: operation.providerSignature,
        recoveryMode: operation.recoveryMode.toLowerCase().replace('_', '-') as
          | 'none'
          | 'reconcile-only'
          | 'retryable',
        sequence: operation.sequence,
        status: operation.status.toLowerCase().replace('_', '-') as
          | 'finalized'
          | 'prepared'
          | 'recovery-required',
      })),
    receiptHash: row.receiptHash,
    recoveryReason: row.recoveryReason,
    roundId: row.roundId,
    settlementPolicyHash: row.settlementPolicyHash,
    settlementPolicyVersion: row.settlementPolicyVersion,
    settledAt: row.settledAt?.toISOString() ?? null,
    status: row.status.toLowerCase().replace('_', '-') as
      | 'pending'
      | 'recovery-required'
      | 'settled',
  };
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
