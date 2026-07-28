import { createHash } from 'node:crypto';
import {
  CRASH_HISTORY_SCHEMA_VERSION,
  CRASH_RECEIPT_SCHEMA_VERSION,
  type CrashHistoryItem,
  type CrashHistoryPage,
  type CrashReceipt,
  type CrashReceiptEvent,
  type CrashResolutionStatus,
  type CrashSafeNextAction,
  type CrashSettlementPublicStatus,
} from '@dailydraft/contracts/crash-history';
import type { DatabaseClient, Prisma } from '@dailydraft/db';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import type { ListCrashHistoryQuery } from './crash-decision.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { CrashSettlementService } from './crash-settlement.service.js';
import type { CrashRoundSnapshot } from './crash-stage-state.js';
// biome-ignore lint/style/useImportType: Nest uses the state service class as a runtime injection token.
import { CrashStageStateService, CrashStateMachineError } from './crash-stage-state.js';

type CrashHistoryCursor = { createdAt: string; id: string };
type CrashHistoryMetadata = Prisma.CrashRoundGetPayload<{
  select: {
    createdAt: true;
    custodyIntents: {
      select: {
        activationMode: true;
        approvedRecipient: true;
        architectureVersion: true;
        assetReference: true;
        calculatorVersion: true;
        createdAt: true;
        id: true;
        network: true;
        playerWalletReference: true;
        policyHash: true;
        policyVersion: true;
        recoveryReason: true;
        requestedRecipient: true;
        roundId: true;
        rulesHash: true;
        rulesVersion: true;
        signingStatus: true;
        stage: true;
        stateMachineRulesHash: true;
        stateMachineVersion: true;
        status: true;
      };
    };
    id: true;
    playerWalletReference: true;
    settlement: {
      select: {
        custodyPolicyHash: true;
        settlementPolicyHash: true;
      };
    };
    updatedAt: true;
  };
}>;

@Injectable()
export class CrashHistoryService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    private readonly state: CrashStageStateService,
    private readonly settlements: CrashSettlementService,
  ) {}

  async list(playerWallet: string, query: ListCrashHistoryQuery): Promise<CrashHistoryPage> {
    this.state.assertFixtureModeEnabled();
    const cursor = query.cursor ? decodeCrashHistoryCursor(query.cursor) : null;
    const walletReference = fixtureWallet(playerWallet);
    const rows = await this.database.crashRound.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true, id: true },
      take: query.limit + 1,
      where: {
        activationMode: 'fixture-only',
        playerWalletReference: walletReference,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
    });
    const visible = rows.slice(0, query.limit);
    const data = await Promise.all(
      visible.map(async ({ id }) => historyItem(await this.getReceipt(id, playerWallet))),
    );
    const boundary = visible.at(-1);
    return {
      data,
      hasMore: rows.length > query.limit,
      nextCursor:
        rows.length > query.limit && boundary
          ? encodeCrashHistoryCursor({
              createdAt: boundary.createdAt.toISOString(),
              id: boundary.id,
            })
          : null,
      schemaVersion: CRASH_HISTORY_SCHEMA_VERSION,
    };
  }

  async getReceipt(roundId: string, playerWallet: string): Promise<CrashReceipt> {
    const round = await this.state.findRound(roundId);
    assertPlayer(round, playerWallet);
    const [metadata, settlement] = await Promise.all([
      this.database.crashRound.findUnique({
        select: {
          createdAt: true,
          custodyIntents: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              activationMode: true,
              approvedRecipient: true,
              architectureVersion: true,
              assetReference: true,
              calculatorVersion: true,
              createdAt: true,
              id: true,
              network: true,
              playerWalletReference: true,
              policyHash: true,
              policyVersion: true,
              recoveryReason: true,
              requestedRecipient: true,
              roundId: true,
              rulesHash: true,
              rulesVersion: true,
              signingStatus: true,
              stage: true,
              stateMachineRulesHash: true,
              stateMachineVersion: true,
              status: true,
            },
          },
          id: true,
          playerWalletReference: true,
          settlement: {
            select: {
              custodyPolicyHash: true,
              settlementPolicyHash: true,
            },
          },
          updatedAt: true,
        },
        where: { id: roundId },
      }),
      this.settlements.findFixtureSettlement(roundId),
    ]);
    if (!metadata || metadata.playerWalletReference !== fixtureWallet(playerWallet)) {
      throw new CrashStateMachineError('NOT_FOUND', `Crash round ${roundId} was not found`);
    }
    const custodyBinding = assertReceiptMetadata(round, metadata, settlement);

    const settlementStatus = settlement?.status ?? round.settlementStatus;
    const custody = custodyState(metadata, settlementStatus);
    const events = [
      ...round.transitions.map(transitionEvent),
      ...metadata.custodyIntents.map(custodyEvent),
      ...(settlement?.operations.map(settlementEvent) ?? []),
    ].sort(compareEvents);

    return {
      bindings: {
        architectureVersion: round.architectureVersion,
        calculatorVersion: round.calculatorVersion,
        custodyPolicyHash:
          metadata.settlement?.custodyPolicyHash ?? custodyBinding?.policyHash ?? null,
        custodyPolicyVersion:
          settlement?.custodyPolicyVersion ?? custodyBinding?.policyVersion ?? null,
        inventoryPolicyHash: settlement?.inventoryPolicyHash ?? null,
        inventoryPolicyVersion: settlement?.inventoryPolicyVersion ?? null,
        riskRulesHash: round.riskRulesHash,
        riskRulesVersion: round.riskRulesVersion,
        rulesHash: round.rulesHash,
        rulesVersion: round.rulesVersion,
        settlementPolicyHash:
          metadata.settlement?.settlementPolicyHash ?? settlement?.settlementPolicyHash ?? null,
        settlementPolicyVersion: settlement?.settlementPolicyVersion ?? null,
        stateMachineRulesHash: round.stateMachineRulesHash,
        stateMachineVersion: round.stateMachineVersion,
      },
      createdAt: metadata.createdAt.toISOString(),
      decisionDeadline: round.decisionDeadline,
      custody,
      events,
      finality: {
        custody:
          settlementStatus === 'settled'
            ? 'settled'
            : custody.status === 'recovery-required'
              ? 'recovery-required'
              : 'not-final',
        gameState: 'committed',
        settlement: settlementStatus,
      },
      mode: 'fixture-preview',
      network: 'solana-devnet',
      pot: round.pot,
      privacy: {
        exposesProviderSignatures: false,
        exposesWalletAddresses: false,
      },
      roundId: round.id,
      resolution: resolutionStatus(round, settlementStatus, settlement),
      safeNextAction: safeNextAction(round, settlementStatus),
      schemaVersion: CRASH_RECEIPT_SCHEMA_VERSION,
      settlement: {
        expectedOperationCount: settlement?.expectedOperationCount ?? 0,
        finalizedOperationCount: settlement?.finalizedOperationCount ?? 0,
        receiptHash: settlement?.receiptHash ?? round.settlementReceiptHash,
        recoveryReason: publicRecoveryCode(settlement?.recoveryReason),
        status: settlementStatus,
      },
      stage: round.stage,
      status: round.status,
      terminalAt: round.terminalAt,
      terminalReason: round.terminalReason,
      updatedAt: metadata.updatedAt.toISOString(),
      version: round.version,
    };
  }
}

export function encodeCrashHistoryCursor(cursor: CrashHistoryCursor): string {
  if (!validCursor(cursor)) throw new BadRequestException('Crash history cursor is invalid');
  return `v1.${Buffer.from(JSON.stringify(cursor)).toString('base64url')}`;
}

export function decodeCrashHistoryCursor(value: string): CrashHistoryCursor {
  if (!/^v1\.[A-Za-z0-9_-]{1,480}$/.test(value)) {
    throw new BadRequestException('Crash history cursor is invalid');
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice(3), 'base64url').toString('utf8'),
    ) as unknown;
    if (!validCursor(decoded)) throw new Error('invalid cursor');
    return decoded;
  } catch {
    throw new BadRequestException('Crash history cursor is invalid');
  }
}

function historyItem(receipt: CrashReceipt): CrashHistoryItem {
  return {
    createdAt: receipt.createdAt,
    currentStage: receipt.stage,
    decisionDeadline: receipt.decisionDeadline,
    gameState: {
      committed: true,
      status: receipt.status,
      version: receipt.version,
    },
    pot: receipt.pot,
    receiptHref: `/v1/crash/rounds/${receipt.roundId}/receipt`,
    resolution: receipt.resolution,
    roundId: receipt.roundId,
    safeNextAction: receipt.safeNextAction,
    settlement: {
      finalizedOperationCount: receipt.settlement.finalizedOperationCount,
      receiptHash: receipt.settlement.receiptHash,
      status: receipt.settlement.status,
    },
    terminalReason: receipt.terminalReason,
    updatedAt: receipt.updatedAt,
  };
}

function transitionEvent(transition: CrashRoundSnapshot['transitions'][number]): CrashReceiptEvent {
  const kinds = {
    busted: 'round-busted',
    'cashed-out': 'round-cashed-out',
    completed: 'round-completed',
    'deadline-defaulted': 'deadline-defaulted',
    'round-started': 'round-started',
    'stage-continued': 'stage-continued',
  } as const;
  return {
    amount: transitionAmount(transition.valueChange),
    decision: transition.decision,
    eventId: `transition:${transition.sequence}`,
    kind: kinds[transition.kind],
    occurredAt: transition.createdAt,
    reference: publicReference('transition', transition.transitionKey),
    stage: transition.toStage,
    terminalReason: transition.terminalReason,
  };
}

function custodyEvent(intent: CrashHistoryMetadata['custodyIntents'][number]): CrashReceiptEvent {
  return {
    amount: null,
    decision: null,
    eventId: `custody:${publicReference('custody-event', intent.id)}`,
    kind: intent.status === 'PREPARED' ? 'custody-prepared' : 'custody-recovery-required',
    occurredAt: intent.createdAt.toISOString(),
    reference: publicReference('custody', intent.id),
    stage: intent.stage,
    terminalReason: null,
  };
}

function settlementEvent(
  operation: NonNullable<
    Awaited<ReturnType<CrashSettlementService['findFixtureSettlement']>>
  >['operations'][number],
): CrashReceiptEvent {
  return {
    amount:
      operation.decimals === 6 && /^(0|[1-9][0-9]{0,19})$/.test(operation.amount)
        ? { amount: operation.amount, currency: 'USDC', decimals: 6 }
        : null,
    decision: null,
    eventId: `settlement:${operation.sequence}`,
    kind:
      operation.status === 'finalized'
        ? 'settlement-finalized'
        : operation.status === 'recovery-required'
          ? 'settlement-recovery-required'
          : 'settlement-prepared',
    occurredAt: operation.finalizedAt ?? operation.updatedAt ?? operation.createdAt,
    reference: publicReference('settlement', operation.operationKey),
    stage: operation.stage ?? operation.sequence,
    terminalReason: publicRecoveryCode(operation.failureCode),
  };
}

function custodyState(
  metadata: CrashHistoryMetadata,
  settlementStatus: CrashSettlementPublicStatus,
): CrashReceipt['custody'] {
  const preparedIntentCount = metadata.custodyIntents.filter(
    ({ status }) => status === 'PREPARED',
  ).length;
  const recoveryRequiredIntentCount = metadata.custodyIntents.length - preparedIntentCount;
  return {
    preparedIntentCount,
    recoveryRequiredIntentCount,
    status:
      recoveryRequiredIntentCount > 0
        ? 'recovery-required'
        : preparedIntentCount > 0 || settlementStatus === 'settled'
          ? 'prepared'
          : 'not-started',
  };
}

function assertReceiptMetadata(
  round: CrashRoundSnapshot,
  metadata: CrashHistoryMetadata,
  settlement: Awaited<ReturnType<CrashSettlementService['findFixtureSettlement']>>,
): { policyHash: string; policyVersion: string } | null {
  const custodyBinding = assertReceiptCustodyEvidence(round, metadata.custodyIntents, settlement);
  const terminal = round.status !== 'active';
  if (
    (terminal && (!settlement || !metadata.settlement)) ||
    (!terminal && (settlement !== null || metadata.settlement !== null))
  ) {
    throw new CrashStateMachineError(
      'INVALID_EVIDENCE',
      'Crash receipt settlement evidence is incomplete',
    );
  }
  if (!settlement || !metadata.settlement) return custodyBinding;
  if (
    metadata.settlement.custodyPolicyHash !== settlement.custodyPolicyHash ||
    metadata.settlement.settlementPolicyHash !== settlement.settlementPolicyHash
  ) {
    throw new CrashStateMachineError(
      'INVALID_EVIDENCE',
      'Crash receipt metadata conflicts with verified settlement',
    );
  }
  return custodyBinding;
}

function assertReceiptCustodyEvidence(
  round: CrashRoundSnapshot,
  intents: CrashHistoryMetadata['custodyIntents'],
  settlement: Awaited<ReturnType<CrashSettlementService['findFixtureSettlement']>>,
): { policyHash: string; policyVersion: string } | null {
  const expected = round.transitions.flatMap((transition) => {
    if (!transition.outcome) return [];
    if (
      typeof transition.outcome !== 'object' ||
      Array.isArray(transition.outcome) ||
      transition.outcome === null
    ) {
      throw invalidReceiptCustody();
    }
    const outcome = transition.outcome as Record<string, unknown>;
    const custody = outcome.custody;
    const provider = outcome.provider;
    if (
      !custody ||
      typeof custody !== 'object' ||
      Array.isArray(custody) ||
      !provider ||
      typeof provider !== 'object' ||
      Array.isArray(provider)
    ) {
      throw invalidReceiptCustody();
    }
    const custodyRecord = custody as Record<string, unknown>;
    const providerRecord = provider as Record<string, unknown>;
    if (
      typeof custodyRecord.reference !== 'string' ||
      typeof custodyRecord.assetReference !== 'string' ||
      !Number.isInteger(providerRecord.stage) ||
      Number(providerRecord.stage) < 1
    ) {
      throw invalidReceiptCustody();
    }
    return [
      {
        assetReference: custodyRecord.assetReference,
        id: custodyRecord.reference,
        stage: Number(providerRecord.stage),
      },
    ];
  });
  if (expected.length !== intents.length) throw invalidReceiptCustody();

  const matched = new Set<string>();
  for (const binding of expected) {
    const intent = intents.find(({ id }) => id === binding.id);
    if (
      !intent ||
      matched.has(intent.id) ||
      intent.roundId !== round.id ||
      intent.assetReference !== binding.assetReference ||
      intent.stage !== binding.stage ||
      intent.activationMode !== 'fixture-only' ||
      intent.network !== 'solana-devnet' ||
      intent.playerWalletReference !== round.playerWalletReference ||
      intent.status !== 'PREPARED' ||
      intent.signingStatus !== 'NOT_STARTED' ||
      intent.recoveryReason !== null ||
      !intent.policyHash ||
      !intent.policyVersion ||
      !intent.approvedRecipient ||
      intent.requestedRecipient !== intent.approvedRecipient ||
      intent.architectureVersion !== round.architectureVersion ||
      intent.stateMachineVersion !== round.stateMachineVersion ||
      intent.stateMachineRulesHash !== round.stateMachineRulesHash ||
      intent.calculatorVersion !== round.calculatorVersion ||
      intent.rulesVersion !== round.rulesVersion ||
      intent.rulesHash !== round.rulesHash ||
      (settlement !== null &&
        (intent.approvedRecipient !== settlement.custodyRecipient ||
          intent.policyHash !== settlement.custodyPolicyHash ||
          intent.policyVersion !== settlement.custodyPolicyVersion))
    ) {
      throw invalidReceiptCustody();
    }
    matched.add(intent.id);
  }

  const first = intents[0];
  if (!first) return null;
  if (
    intents.some(
      ({ policyHash, policyVersion }) =>
        policyHash !== first.policyHash || policyVersion !== first.policyVersion,
    ) ||
    !first.policyHash ||
    !first.policyVersion
  ) {
    throw invalidReceiptCustody();
  }
  return { policyHash: first.policyHash, policyVersion: first.policyVersion };
}

function invalidReceiptCustody(): CrashStateMachineError {
  return new CrashStateMachineError(
    'INVALID_EVIDENCE',
    'Crash receipt custody evidence is incomplete or ambiguous',
  );
}

function transitionAmount(value: unknown): CrashReceiptEvent['amount'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return safeMoney(record.nextPot) ?? safeMoney(record.after);
}

function safeMoney(value: unknown): CrashReceiptEvent['amount'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const money = value as Record<string, unknown>;
  return typeof money.amount === 'string' &&
    /^(0|[1-9][0-9]{0,19})$/.test(money.amount) &&
    money.currency === 'USDC' &&
    money.decimals === 6
    ? { amount: money.amount, currency: 'USDC', decimals: 6 }
    : null;
}

function resolutionStatus(
  round: CrashRoundSnapshot,
  settlementStatus: CrashSettlementPublicStatus,
  settlement: Awaited<ReturnType<CrashSettlementService['findFixtureSettlement']>>,
): CrashResolutionStatus {
  if (round.status === 'active') return 'active';
  if (settlementStatus === 'pending') return 'recovering';
  if (settlementStatus === 'recovery-required') {
    const operation = settlement?.operations.find(({ status }) => status === 'recovery-required');
    if (operation?.recoveryMode === 'reconcile-only') return 'disputed';
    if (operation?.recoveryMode === 'retryable') return 'failed';
    return 'recovering';
  }
  if (round.status === 'busted') return 'bust';
  if (round.status === 'defaulted') return 'timed-out';
  return 'cash-out';
}

function safeNextAction(
  round: CrashRoundSnapshot,
  settlementStatus: CrashSettlementPublicStatus,
): CrashSafeNextAction {
  if (round.status === 'active') return round.decisionDeadline ? 'choose-action' : 'reconnect';
  if (settlementStatus === 'recovery-required') return 'retry-settlement';
  if (settlementStatus === 'pending') return 'wait-for-settlement';
  return 'review-receipt';
}

function publicRecoveryCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[A-Z][A-Z0-9_]{0,119}$/.test(value) ? value : 'RECOVERY_REQUIRED';
}

function compareEvents(left: CrashReceiptEvent, right: CrashReceiptEvent): number {
  return (
    left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId)
  );
}

function publicReference(domain: string, value: string): string {
  return `crashref_${createHash('sha256')
    .update(`dailydraft.crash-public-reference.v1:${domain}:${value}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function assertPlayer(round: CrashRoundSnapshot, playerWallet: string): void {
  if (round.playerWalletReference !== fixtureWallet(playerWallet)) {
    throw new CrashStateMachineError('NOT_FOUND', `Crash round ${round.id} was not found`);
  }
}

function fixtureWallet(playerWallet: string): string {
  return `fixture-wallet:${playerWallet}`;
}

function validCursor(value: unknown): value is CrashHistoryCursor {
  if (!value || typeof value !== 'object') return false;
  const cursor = value as Partial<CrashHistoryCursor>;
  if (
    typeof cursor.id !== 'string' ||
    !/^crashround_[A-Za-z0-9._:-]{8,128}$/.test(cursor.id) ||
    typeof cursor.createdAt !== 'string'
  ) {
    return false;
  }
  const date = new Date(cursor.createdAt);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === cursor.createdAt;
}
