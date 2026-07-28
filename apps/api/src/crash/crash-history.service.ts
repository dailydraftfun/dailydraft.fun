import { createHash } from 'node:crypto';
import {
  CRASH_HISTORY_SCHEMA_VERSION,
  CRASH_RECEIPT_SCHEMA_VERSION,
  type CrashHistoryItem,
  type CrashHistoryPage,
  type CrashReceipt,
  type CrashReceiptEvent,
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
        createdAt: true;
        id: true;
        stage: true;
        status: true;
      };
    };
    id: true;
    playerWalletReference: true;
    settlement: {
      select: {
        custodyPolicyHash: true;
        operations: {
          select: {
            amount: true;
            createdAt: true;
            decimals: true;
            failureCode: true;
            finalizedAt: true;
            operationKey: true;
            sequence: true;
            stage: true;
            status: true;
            updatedAt: true;
          };
        };
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
            select: { createdAt: true, id: true, stage: true, status: true },
          },
          id: true,
          playerWalletReference: true,
          settlement: {
            select: {
              custodyPolicyHash: true,
              operations: {
                orderBy: { sequence: 'asc' },
                select: {
                  amount: true,
                  createdAt: true,
                  decimals: true,
                  failureCode: true,
                  finalizedAt: true,
                  operationKey: true,
                  sequence: true,
                  stage: true,
                  status: true,
                  updatedAt: true,
                },
              },
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
    assertReceiptMetadata(round, metadata, settlement);

    const settlementStatus = settlement?.status ?? round.settlementStatus;
    const custody = custodyState(metadata, settlementStatus);
    const events = [
      ...round.transitions.map(transitionEvent),
      ...metadata.custodyIntents.map(custodyEvent),
      ...(metadata.settlement?.operations.map(settlementEvent) ?? []),
    ].sort(compareEvents);

    return {
      bindings: {
        architectureVersion: round.architectureVersion,
        calculatorVersion: round.calculatorVersion,
        custodyPolicyHash: metadata.settlement?.custodyPolicyHash ?? null,
        custodyPolicyVersion: settlement?.custodyPolicyVersion ?? null,
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
      safeNextAction: safeNextAction(round, settlementStatus),
      schemaVersion: CRASH_RECEIPT_SCHEMA_VERSION,
      settlement: {
        expectedOperationCount: settlement?.expectedOperationCount ?? 0,
        finalizedOperationCount: settlement?.finalizedOperationCount ?? 0,
        receiptHash: settlement?.receiptHash ?? round.settlementReceiptHash,
        recoveryReason: safeRecoveryReason(settlement?.recoveryReason),
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
    gameState: {
      committed: true,
      status: receipt.status,
      version: receipt.version,
    },
    pot: receipt.pot,
    receiptHref: `/v1/crash/rounds/${receipt.roundId}/receipt`,
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
  operation: NonNullable<CrashHistoryMetadata['settlement']>['operations'][number],
): CrashReceiptEvent {
  return {
    amount:
      operation.decimals === 6 && /^(0|[1-9][0-9]{0,19})$/.test(operation.amount)
        ? { amount: operation.amount, currency: 'USDC', decimals: 6 }
        : null,
    decision: null,
    eventId: `settlement:${operation.sequence}`,
    kind:
      operation.status === 'FINALIZED'
        ? 'settlement-finalized'
        : operation.status === 'RECOVERY_REQUIRED'
          ? 'settlement-recovery-required'
          : 'settlement-prepared',
    occurredAt: (operation.finalizedAt ?? operation.updatedAt ?? operation.createdAt).toISOString(),
    reference: publicReference('settlement', operation.operationKey),
    stage: operation.stage ?? operation.sequence,
    terminalReason: safeRecoveryReason(operation.failureCode),
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
): void {
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
  if (!settlement || !metadata.settlement) return;
  const operations = [...metadata.settlement.operations].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (
    metadata.settlement.custodyPolicyHash !== settlement.custodyPolicyHash ||
    metadata.settlement.settlementPolicyHash !== settlement.settlementPolicyHash ||
    operations.length !== settlement.expectedOperationCount ||
    operations.filter(({ status }) => status === 'FINALIZED').length !==
      settlement.finalizedOperationCount ||
    operations.some((operation, index) => {
      const verified = settlement.operations[index];
      return (
        !verified ||
        operation.sequence !== verified.sequence ||
        operation.operationKey !== verified.operationKey ||
        operation.status.toLowerCase().replace('_', '-') !== verified.status
      );
    })
  ) {
    throw new CrashStateMachineError(
      'INVALID_EVIDENCE',
      'Crash receipt metadata conflicts with verified settlement',
    );
  }
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

function safeNextAction(
  round: CrashRoundSnapshot,
  settlementStatus: CrashSettlementPublicStatus,
): CrashSafeNextAction {
  if (round.status === 'active') return round.decisionDeadline ? 'choose-action' : 'reconnect';
  if (settlementStatus === 'recovery-required') return 'retry-settlement';
  if (settlementStatus === 'pending') return 'wait-for-settlement';
  return 'review-receipt';
}

function safeRecoveryReason(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9._:-]{1,240}$/.test(value) ? value : 'RECOVERY_REQUIRED';
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
