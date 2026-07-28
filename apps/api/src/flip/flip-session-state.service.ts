import { createHash, randomUUID } from 'node:crypto';
import {
  type DatabaseClient,
  FlipSessionStatus as DatabaseFlipSessionStatus,
  FlipSessionTransitionKind as DatabaseFlipSessionTransitionKind,
  type Prisma,
} from '@dailydraft/db';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE_CLIENT } from '../database/database.constants.js';
import type { Money } from '../domain.js';
import { stableStringify } from '../providers/valuation-policy.js';

export const FLIP_SESSION_STATE_MACHINE_VERSION = 'dailydraft.flip-session-state.v1' as const;
export const FLIP_STAKE_FIXTURE_VERSION = 'dailydraft.flip-stake-fixture.v1' as const;
export const FLIP_SELECTION_FIXTURE_VERSION = 'dailydraft.flip-selection-fixture.v1' as const;
export const FLIP_PURCHASE_FIXTURE_VERSION = 'dailydraft.flip-purchase-fixture.v1' as const;
export const FLIP_TRANSFER_FIXTURE_VERSION = 'dailydraft.flip-transfer-fixture.v1' as const;
export const FLIP_REVEAL_READY_FIXTURE_VERSION = 'dailydraft.flip-reveal-ready-fixture.v1' as const;
export const FLIP_SETTLEMENT_FIXTURE_VERSION = 'dailydraft.flip-settlement-fixture.v1' as const;
export const FLIP_RECOVERY_FIXTURE_VERSION = 'dailydraft.flip-recovery-fixture.v1' as const;
export const FLIP_SESSION_CLOCK = Symbol('FLIP_SESSION_CLOCK');
export const FLIP_SESSION_ENVIRONMENT = Symbol('FLIP_SESSION_ENVIRONMENT');

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const FIXTURE_REFERENCE_PATTERN = /^fixture-[a-z][a-z-]*:[A-Za-z0-9][A-Za-z0-9._:-]{0,200}$/;
const FIXTURE_WALLET_PATTERN = /^fixture-wallet:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const MAX_U64 = 18_446_744_073_709_551_615n;

const MONEY_KEYS = ['amount', 'currency', 'decimals'] as const;
const STAKE_KEYS = ['amount', 'reference', 'schemaVersion', 'status'] as const;
const POOL_COMMITMENT_EVIDENCE_KEYS = [
  'eligibleOutcomeCount',
  'poolCommitmentHash',
  'poolCommitmentId',
  'rulesHash',
  'snapshotContentHash',
] as const;
const SELECTION_KEYS = [
  'bandLabel',
  'listingValueAmount',
  'ordinal',
  'providerAssetReference',
  'providerListingReference',
  'reference',
  'resultHash',
  'schemaVersion',
] as const;
const PURCHASE_KEYS = [
  'amount',
  'provider',
  'providerAssetReference',
  'providerListingReference',
  'reference',
  'schemaVersion',
  'status',
] as const;
const TRANSFER_KEYS = [
  'destinationWalletReference',
  'providerAssetReference',
  'reference',
  'schemaVersion',
  'sourceCustodyReference',
  'status',
] as const;
const REVEAL_READY_KEYS = [
  'purchaseReference',
  'reference',
  'schemaVersion',
  'status',
  'transferReference',
] as const;
const SETTLEMENT_KEYS = [
  'payout',
  'providerAssetReference',
  'reference',
  'resultHash',
  'schemaVersion',
  'status',
] as const;
const RECOVERY_REQUEST_KEYS = ['reasonCode', 'reference', 'schemaVersion', 'status'] as const;
const RECOVERY_COMPLETION_KEYS = [
  'payout',
  'reference',
  'resultHash',
  'schemaVersion',
  'status',
] as const;
const TERMINAL_FAILURE_KEYS = ['reasonCode', 'reference', 'schemaVersion', 'status'] as const;

export type FlipSessionStateErrorCode =
  | 'CONCURRENT_TRANSITION'
  | 'DISABLED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'INVALID_EVIDENCE'
  | 'INVALID_TRANSITION'
  | 'NOT_FOUND';

export class FlipSessionStateError extends Error {
  constructor(
    readonly code: FlipSessionStateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FlipSessionStateError';
  }
}

export interface FlipSessionClock {
  now(): Date;
}

export interface CreateFixtureFlipSessionInput {
  playerWalletReference: string;
  sessionReference: string;
}

export interface FlipStakeFixture {
  amount: Money;
  reference: string;
  schemaVersion: typeof FLIP_STAKE_FIXTURE_VERSION;
  status: 'fixture-confirmed';
}

export interface FlipSelectionFixture {
  bandLabel: string;
  listingValueAmount: string;
  ordinal: number;
  providerAssetReference: string;
  providerListingReference: string;
  reference: string;
  resultHash: string;
  schemaVersion: typeof FLIP_SELECTION_FIXTURE_VERSION;
}

export interface FlipPurchaseFixture {
  amount: Money;
  provider: 'fixture-marketplace';
  providerAssetReference: string;
  providerListingReference: string;
  reference: string;
  schemaVersion: typeof FLIP_PURCHASE_FIXTURE_VERSION;
  status: 'fixture-acquired';
}

export interface FlipTransferFixture {
  destinationWalletReference: string;
  providerAssetReference: string;
  reference: string;
  schemaVersion: typeof FLIP_TRANSFER_FIXTURE_VERSION;
  sourceCustodyReference: string;
  status: 'fixture-transferred';
}

export interface FlipRevealReadyFixture {
  purchaseReference: string;
  reference: string;
  schemaVersion: typeof FLIP_REVEAL_READY_FIXTURE_VERSION;
  status: 'fixture-ready';
  transferReference: string;
}

export interface FlipSettlementFixture {
  payout: Money;
  providerAssetReference: string;
  reference: string;
  resultHash: string;
  schemaVersion: typeof FLIP_SETTLEMENT_FIXTURE_VERSION;
  status: 'fixture-recorded';
}

export interface FlipRecoveryRequestFixture {
  reasonCode: string;
  reference: string;
  schemaVersion: typeof FLIP_RECOVERY_FIXTURE_VERSION;
  status: 'fixture-recovery-required';
}

export interface FlipRecoveryCompletionFixture {
  payout: Money;
  reference: string;
  resultHash: string;
  schemaVersion: typeof FLIP_RECOVERY_FIXTURE_VERSION;
  status: 'fixture-recovered';
}

export interface FlipTerminalFailureFixture {
  reasonCode: string;
  reference: string;
  schemaVersion: typeof FLIP_RECOVERY_FIXTURE_VERSION;
  status: 'fixture-failed';
}

interface FlipTransitionBoundary {
  expectedVersion: number;
  transitionKey: string;
}

export type FlipSessionAction =
  | (FlipTransitionBoundary & {
      evidence: FlipStakeFixture;
      kind: 'confirm-stake';
    })
  | (FlipTransitionBoundary & {
      evidence: { poolCommitmentId: string };
      kind: 'commit-pool';
    })
  | (FlipTransitionBoundary & {
      evidence: FlipSelectionFixture;
      kind: 'record-selection';
    })
  | (FlipTransitionBoundary & {
      evidence: FlipPurchaseFixture;
      kind: 'record-purchase';
    })
  | (FlipTransitionBoundary & {
      evidence: FlipTransferFixture;
      kind: 'record-transfer';
    })
  | (FlipTransitionBoundary & {
      evidence: FlipRevealReadyFixture;
      kind: 'mark-reveal-ready';
    })
  | (FlipTransitionBoundary & {
      evidence: FlipSettlementFixture;
      kind: 'settle';
    })
  | (FlipTransitionBoundary & {
      evidence: FlipRecoveryRequestFixture;
      kind: 'request-recovery';
    })
  | (FlipTransitionBoundary & {
      evidence: FlipRecoveryCompletionFixture;
      kind: 'complete-recovery';
    })
  | (FlipTransitionBoundary & {
      evidence: FlipTerminalFailureFixture;
      kind: 'terminate';
    });

export interface FlipSessionSnapshot {
  id: string;
  playerWalletReference: string;
  poolCommitment: {
    id: string;
    poolCommitmentHash: string;
    rulesHash: string;
    snapshotContentHash: string;
  } | null;
  purchaseReference: string | null;
  purchasedAt: string | null;
  revealReadyAt: string | null;
  revealReadyReference: string | null;
  selectedOutcome: {
    bandLabel: string;
    listingValueAmount: string;
    ordinal: number;
    providerAssetReference: string;
    providerListingReference: string;
  } | null;
  stake: Money | null;
  stateMachineVersion: typeof FLIP_SESSION_STATE_MACHINE_VERSION;
  status:
    | 'awaiting-stake'
    | 'stake-confirmed'
    | 'pool-committed'
    | 'selection-recorded'
    | 'purchase-recorded'
    | 'transfer-recorded'
    | 'reveal-ready'
    | 'recovery-required'
    | 'settled'
    | 'recovered'
    | 'failed';
  terminalAt: string | null;
  terminalReason: string | null;
  transferReference: string | null;
  transferredAt: string | null;
  transitions: readonly FlipSessionTransitionSnapshot[];
  version: number;
}

export interface FlipSessionTransitionSnapshot {
  createdAt: string;
  evidence: unknown;
  fromStatus: FlipSessionSnapshot['status'] | null;
  kind:
    | 'session-started'
    | 'stake-confirmed'
    | 'pool-committed'
    | 'selection-recorded'
    | 'purchase-recorded'
    | 'transfer-recorded'
    | 'reveal-ready'
    | 'settled'
    | 'recovery-requested'
    | 'recovery-completed'
    | 'terminated';
  poolCommitmentHash: string | null;
  selectedAssetReference: string | null;
  sequence: number;
  terminalReason: string | null;
  toStatus: FlipSessionSnapshot['status'];
  transitionKey: string;
}

export function flipSessionFixtureModeEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.DAILYDRAFT_FLIP_FIXTURE_MODE !== 'true') return false;
  if (environment.VERCEL_ENV === 'production') return false;
  return (
    environment.NODE_ENV === 'test' ||
    environment.NODE_ENV === 'development' ||
    environment.VERCEL_ENV === 'preview'
  );
}

export function flipSessionStateCapability(environment: NodeJS.ProcessEnv = process.env): {
  fixtureReady: boolean;
  playable: false;
  reason: string;
} {
  if (flipSessionFixtureModeEnabled(environment)) {
    return {
      fixtureReady: true,
      playable: false,
      reason:
        'Marketplace Flip lifecycle fixtures are ready; live play remains disabled pending acquisition, economics, and HITL promotion.',
    };
  }
  return {
    fixtureReady: false,
    playable: false,
    reason: 'Marketplace Flip lifecycle is disabled outside explicit fixture or preview mode.',
  };
}

@Injectable()
export class FlipSessionStateService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
    @Inject(FLIP_SESSION_CLOCK) private readonly clock: FlipSessionClock,
    @Inject(FLIP_SESSION_ENVIRONMENT) private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async createFixtureSession(input: CreateFixtureFlipSessionInput): Promise<FlipSessionSnapshot> {
    this.requireFixtureMode();
    const sessionReference = requireIdentifier(input.sessionReference, 'sessionReference');
    if (!FIXTURE_WALLET_PATTERN.test(input.playerWalletReference)) {
      throw stateError(
        'INVALID_EVIDENCE',
        'Flip session requires a synthetic fixture wallet reference',
      );
    }
    const requestPayload = stableStringify({
      playerWalletReference: input.playerWalletReference,
      sessionReference,
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });
    const requestHash = sha256(requestPayload);
    const existing = await this.database.flipSession.findUnique({
      include: {
        poolCommitment: { include: { ruleset: true } },
        transitions: { orderBy: { sequence: 'asc' } },
      },
      where: { id: sessionReference },
    });
    if (existing) {
      if (existing.transitions[0]?.requestHash !== requestHash) {
        throw stateError(
          'IDEMPOTENCY_MISMATCH',
          'Flip sessionReference was reused with different input',
        );
      }
      return toSnapshot(existing);
    }

    const now = this.clock.now();
    try {
      const created = await this.database.$transaction(
        (transaction) =>
          transaction.flipSession.create({
            data: {
              activationMode: 'fixture-only',
              id: sessionReference,
              playerWalletReference: input.playerWalletReference,
              stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
              status: DatabaseFlipSessionStatus.AWAITING_STAKE,
              transitions: {
                create: {
                  evidence: {
                    playerWalletReference: input.playerWalletReference,
                    stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
                  },
                  fromStatus: null,
                  id: createId('fliptransition'),
                  kind: DatabaseFlipSessionTransitionKind.SESSION_STARTED,
                  requestHash,
                  requestPayload,
                  sequence: 1,
                  toStatus: DatabaseFlipSessionStatus.AWAITING_STAKE,
                  transitionKey: 'session-started',
                },
              },
              updatedAt: now,
              version: 1,
            },
            include: {
              poolCommitment: { include: { ruleset: true } },
              transitions: { orderBy: { sequence: 'asc' } },
            },
          }),
        { isolationLevel: 'Serializable' },
      );
      return toSnapshot(created);
    } catch (error) {
      const concurrent = await this.database.flipSession.findUnique({
        include: {
          poolCommitment: { include: { ruleset: true } },
          transitions: { orderBy: { sequence: 'asc' } },
        },
        where: { id: sessionReference },
      });
      if (concurrent?.transitions[0]?.requestHash === requestHash) return toSnapshot(concurrent);
      throw error;
    }
  }

  async findSession(sessionReference: string): Promise<FlipSessionSnapshot> {
    requireIdentifier(sessionReference, 'sessionReference');
    const session = await this.database.flipSession.findUnique({
      include: {
        poolCommitment: { include: { ruleset: true } },
        transitions: { orderBy: { sequence: 'asc' } },
      },
      where: { id: sessionReference },
    });
    if (!session) {
      throw stateError('NOT_FOUND', `Flip session ${sessionReference} was not found`);
    }
    return toSnapshot(session);
  }

  async transition(
    sessionReference: string,
    action: FlipSessionAction,
  ): Promise<FlipSessionSnapshot> {
    this.requireFixtureMode();
    requireIdentifier(sessionReference, 'sessionReference');
    requireIdentifier(action.transitionKey, 'transitionKey');
    if (!Number.isInteger(action.expectedVersion) || action.expectedVersion < 1) {
      throw stateError('INVALID_TRANSITION', 'Flip expectedVersion is invalid');
    }
    const normalized = normalizeAction(action);
    const requestPayload = stableStringify({
      action: normalized,
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    });
    const requestHash = sha256(requestPayload);
    const replay = await this.findReplay(sessionReference, action.transitionKey, requestHash);
    if (replay) return replay;

    const now = this.clock.now();
    try {
      return await this.database
        .$transaction(
          async (transaction) => {
            const current = await transaction.flipSession.findUnique({
              where: { id: sessionReference },
            });
            if (!current) {
              throw stateError('NOT_FOUND', `Flip session ${sessionReference} was not found`);
            }
            assertAggregateContract(current);
            if (TERMINAL_STATUSES.has(current.status)) {
              throw stateError('INVALID_TRANSITION', 'A terminal Flip session cannot transition');
            }
            if (current.version !== action.expectedVersion) {
              throw stateError(
                'INVALID_TRANSITION',
                'Flip transition does not match the durable version',
              );
            }

            const resolved = await resolveAction(transaction, current, normalized, now);
            const updated = await transaction.flipSession.updateMany({
              data: {
                ...resolved.update,
                status: resolved.toStatus,
                version: { increment: 1 },
              },
              where: {
                id: sessionReference,
                status: current.status,
                version: current.version,
              },
            });
            if (updated.count !== 1) {
              throw stateError('CONCURRENT_TRANSITION', 'Flip session changed concurrently');
            }
            await transaction.flipSessionTransition.create({
              data: {
                evidence: resolved.evidence as unknown as Prisma.InputJsonValue,
                fromStatus: current.status,
                id: createId('fliptransition'),
                kind: resolved.kind,
                poolCommitmentHash: resolved.poolCommitmentHash,
                requestHash,
                requestPayload,
                selectedAssetReference: resolved.selectedAssetReference,
                sequence: current.version + 1,
                sessionId: sessionReference,
                terminalReason: resolved.terminalReason,
                toStatus: resolved.toStatus,
                transitionKey: action.transitionKey,
              },
            });
            return loadSession(transaction, sessionReference);
          },
          { isolationLevel: 'Serializable' },
        )
        .then(toSnapshot);
    } catch (error) {
      const concurrentReplay = await this.findReplay(
        sessionReference,
        action.transitionKey,
        requestHash,
      );
      if (concurrentReplay) return concurrentReplay;
      throw error;
    }
  }

  private async findReplay(
    sessionReference: string,
    transitionKey: string,
    requestHash: string,
  ): Promise<FlipSessionSnapshot | null> {
    const existing = await this.database.flipSessionTransition.findUnique({
      where: {
        sessionId_transitionKey: {
          sessionId: sessionReference,
          transitionKey,
        },
      },
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw stateError(
        'IDEMPOTENCY_MISMATCH',
        'Flip transitionKey was reused with different evidence',
      );
    }
    return this.findSession(sessionReference);
  }

  private requireFixtureMode(): void {
    if (!flipSessionFixtureModeEnabled(this.environment)) {
      throw stateError(
        'DISABLED',
        'Flip session state is disabled outside explicit fixture or preview mode',
      );
    }
  }
}

type NormalizedAction = FlipSessionAction;
type FlipSessionRow = Prisma.FlipSessionGetPayload<Record<string, never>>;
type FlipSessionWithTransitions = Prisma.FlipSessionGetPayload<{
  include: {
    poolCommitment: { include: { ruleset: true } };
    transitions: true;
  };
}>;

interface ResolvedAction {
  evidence: unknown;
  kind: DatabaseFlipSessionTransitionKind;
  poolCommitmentHash: string | null;
  selectedAssetReference: string | null;
  terminalReason: string | null;
  toStatus: DatabaseFlipSessionStatus;
  update: Prisma.FlipSessionUncheckedUpdateManyInput;
}

const TERMINAL_STATUSES = new Set<DatabaseFlipSessionStatus>([
  DatabaseFlipSessionStatus.SETTLED,
  DatabaseFlipSessionStatus.RECOVERED,
  DatabaseFlipSessionStatus.FAILED,
]);

function normalizeAction(action: FlipSessionAction): NormalizedAction {
  switch (action.kind) {
    case 'confirm-stake':
      return {
        ...action,
        evidence: requireStake(action.evidence),
      };
    case 'commit-pool':
      requireExactKeys(action.evidence, ['poolCommitmentId'], 'pool commitment');
      return {
        ...action,
        evidence: {
          poolCommitmentId: requireIdentifier(action.evidence.poolCommitmentId, 'poolCommitmentId'),
        },
      };
    case 'record-selection':
      return {
        ...action,
        evidence: requireSelection(action.evidence),
      };
    case 'record-purchase':
      return {
        ...action,
        evidence: requirePurchase(action.evidence),
      };
    case 'record-transfer':
      return {
        ...action,
        evidence: requireTransfer(action.evidence),
      };
    case 'mark-reveal-ready':
      return {
        ...action,
        evidence: requireRevealReady(action.evidence),
      };
    case 'settle':
      return {
        ...action,
        evidence: requireSettlement(action.evidence),
      };
    case 'request-recovery':
      return {
        ...action,
        evidence: requireRecoveryRequest(action.evidence),
      };
    case 'complete-recovery':
      return {
        ...action,
        evidence: requireRecoveryCompletion(action.evidence),
      };
    case 'terminate':
      return {
        ...action,
        evidence: requireTerminalFailure(action.evidence),
      };
  }
}

async function resolveAction(
  transaction: Prisma.TransactionClient,
  current: FlipSessionRow,
  action: NormalizedAction,
  now: Date,
): Promise<ResolvedAction> {
  if (action.kind === 'request-recovery') {
    if (current.status === DatabaseFlipSessionStatus.RECOVERY_REQUIRED) {
      throw stateError('INVALID_TRANSITION', 'Flip recovery is already required');
    }
    return {
      evidence: action.evidence,
      kind: DatabaseFlipSessionTransitionKind.RECOVERY_REQUESTED,
      poolCommitmentHash: current.poolCommitmentHash,
      selectedAssetReference: current.selectedAssetReference,
      terminalReason: null,
      toStatus: DatabaseFlipSessionStatus.RECOVERY_REQUIRED,
      update: {},
    };
  }
  if (action.kind === 'complete-recovery') {
    requireStatus(current, DatabaseFlipSessionStatus.RECOVERY_REQUIRED, action.kind);
    return {
      evidence: action.evidence,
      kind: DatabaseFlipSessionTransitionKind.RECOVERY_COMPLETED,
      poolCommitmentHash: current.poolCommitmentHash,
      selectedAssetReference: current.selectedAssetReference,
      terminalReason: 'FIXTURE_RECOVERY_COMPLETED',
      toStatus: DatabaseFlipSessionStatus.RECOVERED,
      update: {
        terminalAt: now,
        terminalReason: 'FIXTURE_RECOVERY_COMPLETED',
      },
    };
  }
  if (action.kind === 'terminate') {
    requireStatus(current, DatabaseFlipSessionStatus.RECOVERY_REQUIRED, action.kind);
    const terminalReason = `FIXTURE_TERMINATED:${action.evidence.reasonCode}`;
    return {
      evidence: action.evidence,
      kind: DatabaseFlipSessionTransitionKind.TERMINATED,
      poolCommitmentHash: current.poolCommitmentHash,
      selectedAssetReference: current.selectedAssetReference,
      terminalReason,
      toStatus: DatabaseFlipSessionStatus.FAILED,
      update: { terminalAt: now, terminalReason },
    };
  }

  switch (action.kind) {
    case 'confirm-stake': {
      requireStatus(current, DatabaseFlipSessionStatus.AWAITING_STAKE, action.kind);
      return {
        evidence: action.evidence,
        kind: DatabaseFlipSessionTransitionKind.STAKE_CONFIRMED,
        poolCommitmentHash: null,
        selectedAssetReference: null,
        terminalReason: null,
        toStatus: DatabaseFlipSessionStatus.STAKE_CONFIRMED,
        update: {
          stakeAmount: action.evidence.amount.amount,
          stakeCurrency: action.evidence.amount.currency,
          stakeDecimals: action.evidence.amount.decimals,
        },
      };
    }
    case 'commit-pool': {
      requireStatus(current, DatabaseFlipSessionStatus.STAKE_CONFIRMED, action.kind);
      const commitment = await transaction.flipSessionPoolCommitment.findUnique({
        include: { ruleset: true },
        where: { id: action.evidence.poolCommitmentId },
      });
      if (
        !commitment?.sealedAt ||
        commitment.sessionReference !== current.id ||
        !commitment.ruleset.sealedAt ||
        commitment.ruleset.activation !== 'fixture-only' ||
        commitment.ruleset.currency !== 'USDC' ||
        commitment.ruleset.decimals !== 6 ||
        commitment.rulesHash !== commitment.ruleset.rulesHash ||
        current.stakeAmount !== commitment.ruleset.stakeAmount ||
        current.stakeCurrency !== commitment.ruleset.currency ||
        current.stakeDecimals !== commitment.ruleset.decimals
      ) {
        throw stateError(
          'INVALID_EVIDENCE',
          'Flip pool commitment does not match the sealed fixture session and stake',
        );
      }
      const evidence = Object.freeze({
        eligibleOutcomeCount: commitment.eligibleOutcomeCount,
        poolCommitmentHash: commitment.poolCommitmentHash,
        poolCommitmentId: commitment.id,
        rulesHash: commitment.rulesHash,
        snapshotContentHash: commitment.snapshotContentHash,
      });
      return {
        evidence,
        kind: DatabaseFlipSessionTransitionKind.POOL_COMMITTED,
        poolCommitmentHash: commitment.poolCommitmentHash,
        selectedAssetReference: null,
        terminalReason: null,
        toStatus: DatabaseFlipSessionStatus.POOL_COMMITTED,
        update: {
          poolCommitmentHash: commitment.poolCommitmentHash,
          poolCommitmentId: commitment.id,
          rulesHash: commitment.rulesHash,
          snapshotContentHash: commitment.snapshotContentHash,
        },
      };
    }
    case 'record-selection': {
      requireStatus(current, DatabaseFlipSessionStatus.POOL_COMMITTED, action.kind);
      if (!current.poolCommitmentId) {
        throw stateError('INVALID_EVIDENCE', 'Flip session has no durable pool commitment');
      }
      const commitment = await transaction.flipSessionPoolCommitment.findUnique({
        select: { outcomeSpace: true, sealedAt: true },
        where: { id: current.poolCommitmentId },
      });
      if (!commitment?.sealedAt) {
        throw stateError('INVALID_EVIDENCE', 'Flip pool commitment is absent or unsealed');
      }
      const selected = parseOutcomeSpace(commitment.outcomeSpace).find(
        (outcome) => outcome.ordinal === action.evidence.ordinal,
      );
      if (
        !selected ||
        selected.bandLabel !== action.evidence.bandLabel ||
        selected.listingValueAmount !== action.evidence.listingValueAmount ||
        selected.providerAssetReference !== action.evidence.providerAssetReference ||
        selected.providerListingReference !== action.evidence.providerListingReference
      ) {
        throw stateError(
          'INVALID_EVIDENCE',
          'Flip selection is not an exact member of the committed outcome space',
        );
      }
      return {
        evidence: action.evidence,
        kind: DatabaseFlipSessionTransitionKind.SELECTION_RECORDED,
        poolCommitmentHash: current.poolCommitmentHash,
        selectedAssetReference: selected.providerAssetReference,
        terminalReason: null,
        toStatus: DatabaseFlipSessionStatus.SELECTION_RECORDED,
        update: {
          selectedAssetReference: selected.providerAssetReference,
          selectedBandLabel: selected.bandLabel,
          selectedListingReference: selected.providerListingReference,
          selectedOrdinal: selected.ordinal,
          selectedValueAmount: selected.listingValueAmount,
        },
      };
    }
    case 'record-purchase': {
      requireStatus(current, DatabaseFlipSessionStatus.SELECTION_RECORDED, action.kind);
      requireSelectedOutcome(current);
      if (
        action.evidence.providerAssetReference !== current.selectedAssetReference ||
        action.evidence.providerListingReference !== current.selectedListingReference ||
        action.evidence.amount.amount !== current.selectedValueAmount
      ) {
        throw stateError(
          'INVALID_EVIDENCE',
          'Flip purchase does not match the durable selected outcome',
        );
      }
      return {
        evidence: action.evidence,
        kind: DatabaseFlipSessionTransitionKind.PURCHASE_RECORDED,
        poolCommitmentHash: current.poolCommitmentHash,
        selectedAssetReference: current.selectedAssetReference,
        terminalReason: null,
        toStatus: DatabaseFlipSessionStatus.PURCHASE_RECORDED,
        update: {
          purchaseReference: action.evidence.reference,
          purchasedAt: now,
        },
      };
    }
    case 'record-transfer': {
      requireStatus(current, DatabaseFlipSessionStatus.PURCHASE_RECORDED, action.kind);
      if (
        !current.purchaseReference ||
        action.evidence.providerAssetReference !== current.selectedAssetReference ||
        action.evidence.destinationWalletReference !== current.playerWalletReference
      ) {
        throw stateError(
          'INVALID_EVIDENCE',
          'Flip transfer does not match the acquired outcome and player fixture wallet',
        );
      }
      return {
        evidence: action.evidence,
        kind: DatabaseFlipSessionTransitionKind.TRANSFER_RECORDED,
        poolCommitmentHash: current.poolCommitmentHash,
        selectedAssetReference: current.selectedAssetReference,
        terminalReason: null,
        toStatus: DatabaseFlipSessionStatus.TRANSFER_RECORDED,
        update: {
          transferReference: action.evidence.reference,
          transferredAt: now,
        },
      };
    }
    case 'mark-reveal-ready': {
      requireStatus(current, DatabaseFlipSessionStatus.TRANSFER_RECORDED, action.kind);
      if (
        !current.purchasedAt ||
        !current.transferredAt ||
        action.evidence.purchaseReference !== current.purchaseReference ||
        action.evidence.transferReference !== current.transferReference
      ) {
        throw stateError(
          'INVALID_EVIDENCE',
          'Flip reveal finality requires the durable acquisition and transfer receipts',
        );
      }
      return {
        evidence: action.evidence,
        kind: DatabaseFlipSessionTransitionKind.REVEAL_READY,
        poolCommitmentHash: current.poolCommitmentHash,
        selectedAssetReference: current.selectedAssetReference,
        terminalReason: null,
        toStatus: DatabaseFlipSessionStatus.REVEAL_READY,
        update: {
          revealReadyAt: now,
          revealReadyReference: action.evidence.reference,
        },
      };
    }
    case 'settle': {
      requireStatus(current, DatabaseFlipSessionStatus.REVEAL_READY, action.kind);
      if (
        !current.purchasedAt ||
        !current.transferredAt ||
        !current.revealReadyAt ||
        action.evidence.providerAssetReference !== current.selectedAssetReference
      ) {
        throw stateError(
          'INVALID_EVIDENCE',
          'Flip settlement requires durable acquisition, transfer, and reveal readiness',
        );
      }
      return {
        evidence: action.evidence,
        kind: DatabaseFlipSessionTransitionKind.SETTLED,
        poolCommitmentHash: current.poolCommitmentHash,
        selectedAssetReference: current.selectedAssetReference,
        terminalReason: 'FIXTURE_SETTLED',
        toStatus: DatabaseFlipSessionStatus.SETTLED,
        update: {
          terminalAt: now,
          terminalReason: 'FIXTURE_SETTLED',
        },
      };
    }
  }
}

async function loadSession(
  transaction: Prisma.TransactionClient,
  sessionReference: string,
): Promise<FlipSessionWithTransitions> {
  return transaction.flipSession.findUniqueOrThrow({
    include: {
      poolCommitment: { include: { ruleset: true } },
      transitions: { orderBy: { sequence: 'asc' } },
    },
    where: { id: sessionReference },
  });
}

function toSnapshot(session: FlipSessionWithTransitions): FlipSessionSnapshot {
  assertSessionLedger(session);
  const selectedOutcome =
    session.selectedOrdinal === null ||
    session.selectedBandLabel === null ||
    session.selectedAssetReference === null ||
    session.selectedListingReference === null ||
    session.selectedValueAmount === null
      ? null
      : {
          bandLabel: session.selectedBandLabel,
          listingValueAmount: session.selectedValueAmount,
          ordinal: session.selectedOrdinal,
          providerAssetReference: session.selectedAssetReference,
          providerListingReference: session.selectedListingReference,
        };
  const poolCommitment =
    session.poolCommitmentId &&
    session.poolCommitmentHash &&
    session.rulesHash &&
    session.snapshotContentHash
      ? {
          id: session.poolCommitmentId,
          poolCommitmentHash: session.poolCommitmentHash,
          rulesHash: session.rulesHash,
          snapshotContentHash: session.snapshotContentHash,
        }
      : null;
  return {
    id: session.id,
    playerWalletReference: session.playerWalletReference,
    poolCommitment,
    purchaseReference: session.purchaseReference,
    purchasedAt: session.purchasedAt?.toISOString() ?? null,
    revealReadyAt: session.revealReadyAt?.toISOString() ?? null,
    revealReadyReference: session.revealReadyReference,
    selectedOutcome,
    stake:
      session.stakeAmount === null
        ? null
        : storedMoney(session.stakeAmount, session.stakeCurrency, session.stakeDecimals),
    stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    status: toStatus(session.status),
    terminalAt: session.terminalAt?.toISOString() ?? null,
    terminalReason: session.terminalReason,
    transferReference: session.transferReference,
    transferredAt: session.transferredAt?.toISOString() ?? null,
    transitions: session.transitions.map((transition) => ({
      createdAt: transition.createdAt.toISOString(),
      evidence: transition.evidence,
      fromStatus: transition.fromStatus ? toStatus(transition.fromStatus) : null,
      kind: toKind(transition.kind),
      poolCommitmentHash: transition.poolCommitmentHash,
      selectedAssetReference: transition.selectedAssetReference,
      sequence: transition.sequence,
      terminalReason: transition.terminalReason,
      toStatus: toStatus(transition.toStatus),
      transitionKey: transition.transitionKey,
    })),
    version: session.version,
  };
}

function assertAggregateContract(session: FlipSessionRow): void {
  if (
    session.activationMode !== 'fixture-only' ||
    !IDENTIFIER_PATTERN.test(session.id) ||
    session.stateMachineVersion !== FLIP_SESSION_STATE_MACHINE_VERSION ||
    !FIXTURE_WALLET_PATTERN.test(session.playerWalletReference)
  ) {
    throw stateError('DISABLED', 'Flip session durable contract is invalid');
  }
}

function assertSessionLedger(session: FlipSessionWithTransitions): void {
  assertAggregateContract(session);
  assertStoredCommitmentBinding(session);
  assertMilestoneContract(session);
  const first = session.transitions[0];
  const last = session.transitions.at(-1);
  const terminal = TERMINAL_STATUSES.has(session.status);
  const transitionsValid =
    session.transitions.length === session.version &&
    session.transitions.every(
      (transition, index) =>
        transition.sequence === index + 1 &&
        (index === 0
          ? transition.fromStatus === null
          : transition.fromStatus === session.transitions[index - 1]?.toStatus),
    );
  if (
    !transitionsValid ||
    first?.kind !== DatabaseFlipSessionTransitionKind.SESSION_STARTED ||
    first.toStatus !== DatabaseFlipSessionStatus.AWAITING_STAKE ||
    last?.toStatus !== session.status ||
    (terminal
      ? session.terminalAt === null || session.terminalReason === null
      : session.terminalAt !== null || session.terminalReason !== null) ||
    ((session.status === DatabaseFlipSessionStatus.REVEAL_READY ||
      session.status === DatabaseFlipSessionStatus.SETTLED) &&
      (!session.purchasedAt || !session.transferredAt || !session.revealReadyAt)) ||
    !session.transitions.every((transition) => isValidStoredTransition(session, transition))
  ) {
    throw stateError('DISABLED', 'Flip durable transition ledger is inconsistent');
  }
}

function assertMilestoneContract(session: FlipSessionWithTransitions): void {
  let milestoneStatus = session.status;
  if (
    milestoneStatus === DatabaseFlipSessionStatus.RECOVERY_REQUIRED ||
    milestoneStatus === DatabaseFlipSessionStatus.RECOVERED ||
    milestoneStatus === DatabaseFlipSessionStatus.FAILED
  ) {
    const recovery = session.transitions.find(
      (transition) => transition.kind === DatabaseFlipSessionTransitionKind.RECOVERY_REQUESTED,
    );
    if (
      !recovery?.fromStatus ||
      recovery.fromStatus === DatabaseFlipSessionStatus.RECOVERY_REQUIRED ||
      TERMINAL_STATUSES.has(recovery.fromStatus)
    ) {
      throw stateError('DISABLED', 'Flip recovery milestone origin is invalid');
    }
    milestoneStatus = recovery.fromStatus;
  }

  const milestoneRank = new Map<DatabaseFlipSessionStatus, number>([
    [DatabaseFlipSessionStatus.AWAITING_STAKE, 0],
    [DatabaseFlipSessionStatus.STAKE_CONFIRMED, 1],
    [DatabaseFlipSessionStatus.POOL_COMMITTED, 2],
    [DatabaseFlipSessionStatus.SELECTION_RECORDED, 3],
    [DatabaseFlipSessionStatus.PURCHASE_RECORDED, 4],
    [DatabaseFlipSessionStatus.TRANSFER_RECORDED, 5],
    [DatabaseFlipSessionStatus.REVEAL_READY, 6],
    [DatabaseFlipSessionStatus.SETTLED, 6],
  ]);
  const rank = milestoneRank.get(milestoneStatus);
  const milestonePresence = [
    [milestonePresent([session.stakeAmount, session.stakeCurrency, session.stakeDecimals]), 1],
    [
      milestonePresent([
        session.poolCommitmentId,
        session.poolCommitmentHash,
        session.rulesHash,
        session.snapshotContentHash,
      ]),
      2,
    ],
    [
      milestonePresent([
        session.selectedOrdinal,
        session.selectedBandLabel,
        session.selectedAssetReference,
        session.selectedListingReference,
        session.selectedValueAmount,
      ]),
      3,
    ],
    [milestonePresent([session.purchaseReference, session.purchasedAt]), 4],
    [milestonePresent([session.transferReference, session.transferredAt]), 5],
    [milestonePresent([session.revealReadyReference, session.revealReadyAt]), 6],
  ] as const;
  if (
    rank === undefined ||
    milestonePresence.some(([present, minimumRank]) => present !== rank >= minimumRank)
  ) {
    throw stateError('DISABLED', 'Flip durable milestones do not match the transition ledger');
  }
}

function milestonePresent(values: readonly unknown[]): boolean {
  const present = values.filter((value) => value !== null).length;
  if (present !== 0 && present !== values.length) {
    throw stateError('DISABLED', 'Flip durable milestone is only partially recorded');
  }
  return present === values.length;
}

type FlipSessionTransitionRow = FlipSessionWithTransitions['transitions'][number];

function isValidStoredTransition(
  session: FlipSessionWithTransitions,
  transition: FlipSessionTransitionRow,
): boolean {
  try {
    if (!HASH_PATTERN.test(transition.requestHash)) return false;

    const expected = expectedStoredTransition(session, transition);
    if (
      transition.fromStatus !== expected.fromStatus ||
      transition.toStatus !== expected.toStatus ||
      transition.poolCommitmentHash !== expected.poolCommitmentHash ||
      transition.selectedAssetReference !== expected.selectedAssetReference ||
      transition.terminalReason !== expected.terminalReason ||
      stableStringify(transition.evidence) !== stableStringify(expected.evidence) ||
      transition.requestHash !== expected.requestHash ||
      transition.requestPayload !== expected.requestPayload
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function expectedStoredTransition(
  session: FlipSessionWithTransitions,
  transition: FlipSessionTransitionRow,
): {
  evidence: unknown;
  fromStatus: DatabaseFlipSessionStatus | null;
  poolCommitmentHash: string | null;
  requestHash: string;
  requestPayload: string;
  selectedAssetReference: string | null;
  terminalReason: string | null;
  toStatus: DatabaseFlipSessionStatus;
} {
  const transitionKey = requireIdentifier(transition.transitionKey, 'stored transitionKey');
  if (transition.kind === DatabaseFlipSessionTransitionKind.SESSION_STARTED) {
    requireExactKeys(
      transition.evidence as object,
      ['playerWalletReference', 'stateMachineVersion'],
      'session start',
    );
    const evidence = transition.evidence as {
      playerWalletReference: unknown;
      stateMachineVersion: unknown;
    };
    if (
      transition.sequence !== 1 ||
      evidence.playerWalletReference !== session.playerWalletReference ||
      evidence.stateMachineVersion !== FLIP_SESSION_STATE_MACHINE_VERSION ||
      transitionKey !== 'session-started'
    ) {
      throw stateError('INVALID_EVIDENCE', 'Stored Flip session start is invalid');
    }
    const normalizedEvidence = {
      playerWalletReference: session.playerWalletReference,
      stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
    };
    return {
      evidence: normalizedEvidence,
      fromStatus: null,
      poolCommitmentHash: null,
      requestHash: sha256(
        stableStringify({
          playerWalletReference: session.playerWalletReference,
          sessionReference: session.id,
          stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
        }),
      ),
      requestPayload: stableStringify({
        playerWalletReference: session.playerWalletReference,
        sessionReference: session.id,
        stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
      }),
      selectedAssetReference: null,
      terminalReason: null,
      toStatus: DatabaseFlipSessionStatus.AWAITING_STAKE,
    };
  }

  if (transition.sequence <= 1) {
    throw stateError('INVALID_EVIDENCE', 'Stored Flip transition sequence is invalid');
  }

  let action: Omit<FlipSessionAction, 'expectedVersion' | 'transitionKey'>;
  let fromStatus: DatabaseFlipSessionStatus;
  let toStatus: DatabaseFlipSessionStatus;
  let poolCommitmentHash: string | null = session.poolCommitmentHash;
  let selectedAssetReference: string | null = session.selectedAssetReference;
  let terminalReason: string | null = null;

  switch (transition.kind) {
    case DatabaseFlipSessionTransitionKind.STAKE_CONFIRMED: {
      const evidence = requireStake(transition.evidence as unknown as FlipStakeFixture);
      if (
        evidence.amount.amount !== session.stakeAmount ||
        evidence.amount.currency !== session.stakeCurrency ||
        evidence.amount.decimals !== session.stakeDecimals
      ) {
        throw stateError('INVALID_EVIDENCE', 'Stored Flip stake evidence does not match session');
      }
      action = { evidence, kind: 'confirm-stake' };
      fromStatus = DatabaseFlipSessionStatus.AWAITING_STAKE;
      toStatus = DatabaseFlipSessionStatus.STAKE_CONFIRMED;
      poolCommitmentHash = null;
      selectedAssetReference = null;
      break;
    }
    case DatabaseFlipSessionTransitionKind.POOL_COMMITTED: {
      const evidence = requirePoolCommitmentEvidence(transition.evidence);
      if (
        evidence.eligibleOutcomeCount !== session.poolCommitment?.eligibleOutcomeCount ||
        evidence.poolCommitmentId !== session.poolCommitmentId ||
        evidence.poolCommitmentHash !== session.poolCommitmentHash ||
        evidence.rulesHash !== session.rulesHash ||
        evidence.snapshotContentHash !== session.snapshotContentHash
      ) {
        throw stateError(
          'INVALID_EVIDENCE',
          'Stored Flip pool commitment evidence does not match session',
        );
      }
      action = {
        evidence: { poolCommitmentId: evidence.poolCommitmentId },
        kind: 'commit-pool',
      };
      fromStatus = DatabaseFlipSessionStatus.STAKE_CONFIRMED;
      toStatus = DatabaseFlipSessionStatus.POOL_COMMITTED;
      selectedAssetReference = null;
      break;
    }
    case DatabaseFlipSessionTransitionKind.SELECTION_RECORDED: {
      const evidence = requireSelection(transition.evidence as unknown as FlipSelectionFixture);
      if (
        evidence.ordinal !== session.selectedOrdinal ||
        evidence.bandLabel !== session.selectedBandLabel ||
        evidence.providerAssetReference !== session.selectedAssetReference ||
        evidence.providerListingReference !== session.selectedListingReference ||
        evidence.listingValueAmount !== session.selectedValueAmount
      ) {
        throw stateError('INVALID_EVIDENCE', 'Stored Flip selection does not match session');
      }
      action = { evidence, kind: 'record-selection' };
      fromStatus = DatabaseFlipSessionStatus.POOL_COMMITTED;
      toStatus = DatabaseFlipSessionStatus.SELECTION_RECORDED;
      break;
    }
    case DatabaseFlipSessionTransitionKind.PURCHASE_RECORDED: {
      const evidence = requirePurchase(transition.evidence as unknown as FlipPurchaseFixture);
      if (
        evidence.reference !== session.purchaseReference ||
        evidence.providerAssetReference !== session.selectedAssetReference ||
        evidence.providerListingReference !== session.selectedListingReference ||
        evidence.amount.amount !== session.selectedValueAmount
      ) {
        throw stateError('INVALID_EVIDENCE', 'Stored Flip purchase does not match session');
      }
      action = { evidence, kind: 'record-purchase' };
      fromStatus = DatabaseFlipSessionStatus.SELECTION_RECORDED;
      toStatus = DatabaseFlipSessionStatus.PURCHASE_RECORDED;
      break;
    }
    case DatabaseFlipSessionTransitionKind.TRANSFER_RECORDED: {
      const evidence = requireTransfer(transition.evidence as unknown as FlipTransferFixture);
      if (
        evidence.reference !== session.transferReference ||
        evidence.providerAssetReference !== session.selectedAssetReference ||
        evidence.destinationWalletReference !== session.playerWalletReference
      ) {
        throw stateError('INVALID_EVIDENCE', 'Stored Flip transfer does not match session');
      }
      action = { evidence, kind: 'record-transfer' };
      fromStatus = DatabaseFlipSessionStatus.PURCHASE_RECORDED;
      toStatus = DatabaseFlipSessionStatus.TRANSFER_RECORDED;
      break;
    }
    case DatabaseFlipSessionTransitionKind.REVEAL_READY: {
      const evidence = requireRevealReady(transition.evidence as unknown as FlipRevealReadyFixture);
      if (
        evidence.reference !== session.revealReadyReference ||
        evidence.purchaseReference !== session.purchaseReference ||
        evidence.transferReference !== session.transferReference
      ) {
        throw stateError('INVALID_EVIDENCE', 'Stored Flip reveal evidence does not match session');
      }
      action = { evidence, kind: 'mark-reveal-ready' };
      fromStatus = DatabaseFlipSessionStatus.TRANSFER_RECORDED;
      toStatus = DatabaseFlipSessionStatus.REVEAL_READY;
      break;
    }
    case DatabaseFlipSessionTransitionKind.SETTLED: {
      const evidence = requireSettlement(transition.evidence as unknown as FlipSettlementFixture);
      if (evidence.providerAssetReference !== session.selectedAssetReference) {
        throw stateError('INVALID_EVIDENCE', 'Stored Flip settlement does not match session');
      }
      action = { evidence, kind: 'settle' };
      fromStatus = DatabaseFlipSessionStatus.REVEAL_READY;
      toStatus = DatabaseFlipSessionStatus.SETTLED;
      terminalReason = 'FIXTURE_SETTLED';
      break;
    }
    case DatabaseFlipSessionTransitionKind.RECOVERY_REQUESTED: {
      const evidence = requireRecoveryRequest(
        transition.evidence as unknown as FlipRecoveryRequestFixture,
      );
      if (
        transition.fromStatus === null ||
        transition.fromStatus === DatabaseFlipSessionStatus.RECOVERY_REQUIRED ||
        TERMINAL_STATUSES.has(transition.fromStatus)
      ) {
        throw stateError('INVALID_EVIDENCE', 'Stored Flip recovery origin is invalid');
      }
      action = { evidence, kind: 'request-recovery' };
      fromStatus = transition.fromStatus;
      toStatus = DatabaseFlipSessionStatus.RECOVERY_REQUIRED;
      break;
    }
    case DatabaseFlipSessionTransitionKind.RECOVERY_COMPLETED: {
      const evidence = requireRecoveryCompletion(
        transition.evidence as unknown as FlipRecoveryCompletionFixture,
      );
      action = { evidence, kind: 'complete-recovery' };
      fromStatus = DatabaseFlipSessionStatus.RECOVERY_REQUIRED;
      toStatus = DatabaseFlipSessionStatus.RECOVERED;
      terminalReason = 'FIXTURE_RECOVERY_COMPLETED';
      break;
    }
    case DatabaseFlipSessionTransitionKind.TERMINATED: {
      const evidence = requireTerminalFailure(
        transition.evidence as unknown as FlipTerminalFailureFixture,
      );
      action = { evidence, kind: 'terminate' };
      fromStatus = DatabaseFlipSessionStatus.RECOVERY_REQUIRED;
      toStatus = DatabaseFlipSessionStatus.FAILED;
      terminalReason = `FIXTURE_TERMINATED:${evidence.reasonCode}`;
      break;
    }
  }

  const normalizedAction = {
    ...action,
    expectedVersion: transition.sequence - 1,
    transitionKey,
  } as FlipSessionAction;
  const requestPayload = stableStringify({
    action: normalizedAction,
    stateMachineVersion: FLIP_SESSION_STATE_MACHINE_VERSION,
  });
  return {
    evidence:
      transition.kind === DatabaseFlipSessionTransitionKind.POOL_COMMITTED
        ? requirePoolCommitmentEvidence(transition.evidence)
        : action.evidence,
    fromStatus,
    poolCommitmentHash,
    requestHash: sha256(requestPayload),
    requestPayload,
    selectedAssetReference,
    terminalReason,
    toStatus,
  };
}

function assertStoredCommitmentBinding(session: FlipSessionWithTransitions): void {
  const commitment = session.poolCommitment;
  if (!commitment) {
    if (
      session.poolCommitmentId !== null ||
      session.poolCommitmentHash !== null ||
      session.rulesHash !== null ||
      session.snapshotContentHash !== null ||
      session.selectedOrdinal !== null ||
      session.selectedBandLabel !== null ||
      session.selectedAssetReference !== null ||
      session.selectedListingReference !== null ||
      session.selectedValueAmount !== null
    ) {
      throw stateError('DISABLED', 'Flip durable pool commitment binding is inconsistent');
    }
    return;
  }

  const outcomes = parseOutcomeSpace(commitment.outcomeSpace);
  if (
    commitment.id !== session.poolCommitmentId ||
    commitment.sessionReference !== session.id ||
    commitment.sealedAt === null ||
    commitment.ruleset.sealedAt === null ||
    commitment.ruleset.activation !== 'fixture-only' ||
    commitment.ruleset.currency !== 'USDC' ||
    commitment.ruleset.decimals !== 6 ||
    commitment.rulesHash !== commitment.ruleset.rulesHash ||
    commitment.rulesHash !== session.rulesHash ||
    commitment.snapshotContentHash !== session.snapshotContentHash ||
    commitment.poolCommitmentHash !== session.poolCommitmentHash ||
    commitment.eligibleOutcomeCount !== outcomes.length ||
    commitment.ruleset.stakeAmount !== session.stakeAmount ||
    commitment.ruleset.currency !== session.stakeCurrency ||
    commitment.ruleset.decimals !== session.stakeDecimals
  ) {
    throw stateError('DISABLED', 'Flip durable pool commitment binding is inconsistent');
  }

  if (session.selectedOrdinal === null) return;
  const selected = outcomes.find((outcome) => outcome.ordinal === session.selectedOrdinal);
  if (
    !selected ||
    selected.bandLabel !== session.selectedBandLabel ||
    selected.providerAssetReference !== session.selectedAssetReference ||
    selected.providerListingReference !== session.selectedListingReference ||
    selected.listingValueAmount !== session.selectedValueAmount
  ) {
    throw stateError('DISABLED', 'Flip durable selected outcome binding is inconsistent');
  }
}

function requireStatus(
  current: FlipSessionRow,
  expected: DatabaseFlipSessionStatus,
  action: FlipSessionAction['kind'],
): void {
  if (current.status !== expected) {
    throw stateError(
      'INVALID_TRANSITION',
      `Flip ${action} cannot run from ${toStatus(current.status)}`,
    );
  }
}

function requirePoolCommitmentEvidence(value: unknown): {
  eligibleOutcomeCount: number;
  poolCommitmentHash: string;
  poolCommitmentId: string;
  rulesHash: string;
  snapshotContentHash: string;
} {
  requireExactKeys(value as object, POOL_COMMITMENT_EVIDENCE_KEYS, 'pool commitment evidence');
  const evidence = value as {
    eligibleOutcomeCount?: unknown;
    poolCommitmentHash?: unknown;
    poolCommitmentId?: unknown;
    rulesHash?: unknown;
    snapshotContentHash?: unknown;
  };
  if (
    typeof evidence.eligibleOutcomeCount !== 'number' ||
    !Number.isInteger(evidence.eligibleOutcomeCount) ||
    evidence.eligibleOutcomeCount < 1 ||
    typeof evidence.poolCommitmentHash !== 'string' ||
    !HASH_PATTERN.test(evidence.poolCommitmentHash) ||
    typeof evidence.rulesHash !== 'string' ||
    !HASH_PATTERN.test(evidence.rulesHash) ||
    typeof evidence.snapshotContentHash !== 'string' ||
    !HASH_PATTERN.test(evidence.snapshotContentHash)
  ) {
    throw stateError('INVALID_EVIDENCE', 'Stored Flip pool commitment evidence is invalid');
  }
  return {
    eligibleOutcomeCount: evidence.eligibleOutcomeCount,
    poolCommitmentHash: evidence.poolCommitmentHash,
    poolCommitmentId: requireIdentifier(
      evidence.poolCommitmentId as string,
      'stored poolCommitmentId',
    ),
    rulesHash: evidence.rulesHash,
    snapshotContentHash: evidence.snapshotContentHash,
  };
}

function requireSelectedOutcome(current: FlipSessionRow): asserts current is FlipSessionRow & {
  selectedAssetReference: string;
  selectedListingReference: string;
  selectedValueAmount: string;
} {
  if (
    !current.selectedAssetReference ||
    !current.selectedListingReference ||
    !current.selectedValueAmount
  ) {
    throw stateError('INVALID_EVIDENCE', 'Flip session has no durable selected outcome');
  }
}

interface CommittedOutcome {
  bandLabel: string;
  listingValueAmount: string;
  ordinal: number;
  providerAssetReference: string;
  providerListingReference: string;
}

function parseOutcomeSpace(value: unknown): CommittedOutcome[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw stateError('INVALID_EVIDENCE', 'Flip committed outcome space is invalid');
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw stateError('INVALID_EVIDENCE', 'Flip committed outcome is invalid');
    }
    const outcome = candidate as Partial<CommittedOutcome>;
    const ordinal = outcome.ordinal;
    if (
      typeof ordinal !== 'number' ||
      !Number.isInteger(ordinal) ||
      ordinal < 0 ||
      typeof outcome.bandLabel !== 'string' ||
      typeof outcome.listingValueAmount !== 'string' ||
      typeof outcome.providerAssetReference !== 'string' ||
      typeof outcome.providerListingReference !== 'string'
    ) {
      throw stateError('INVALID_EVIDENCE', 'Flip committed outcome is invalid');
    }
    return {
      bandLabel: requireIdentifier(outcome.bandLabel, 'outcome band'),
      listingValueAmount: requireAmount(outcome.listingValueAmount, 'outcome value'),
      ordinal,
      providerAssetReference: requireReference(
        outcome.providerAssetReference,
        'providerAssetReference',
      ),
      providerListingReference: requireReference(
        outcome.providerListingReference,
        'providerListingReference',
      ),
    };
  });
}

function requireStake(value: FlipStakeFixture): FlipStakeFixture {
  requireExactKeys(value, STAKE_KEYS, 'stake');
  if (value?.schemaVersion !== FLIP_STAKE_FIXTURE_VERSION || value.status !== 'fixture-confirmed') {
    throw stateError('INVALID_EVIDENCE', 'Flip stake fixture is invalid');
  }
  return Object.freeze({
    amount: requireMoney(value.amount, 'stake amount'),
    reference: requireFixtureReference(value.reference, 'stake reference'),
    schemaVersion: FLIP_STAKE_FIXTURE_VERSION,
    status: 'fixture-confirmed',
  });
}

function requireSelection(value: FlipSelectionFixture): FlipSelectionFixture {
  requireExactKeys(value, SELECTION_KEYS, 'selection');
  if (
    value?.schemaVersion !== FLIP_SELECTION_FIXTURE_VERSION ||
    !HASH_PATTERN.test(value.resultHash) ||
    !Number.isInteger(value.ordinal) ||
    value.ordinal < 0
  ) {
    throw stateError('INVALID_EVIDENCE', 'Flip selection fixture is invalid');
  }
  return Object.freeze({
    bandLabel: requireIdentifier(value.bandLabel, 'selection band'),
    listingValueAmount: requireAmount(value.listingValueAmount, 'selection value'),
    ordinal: value.ordinal,
    providerAssetReference: requireReference(
      value.providerAssetReference,
      'providerAssetReference',
    ),
    providerListingReference: requireReference(
      value.providerListingReference,
      'providerListingReference',
    ),
    reference: requireFixtureReference(value.reference, 'selection reference'),
    resultHash: value.resultHash,
    schemaVersion: FLIP_SELECTION_FIXTURE_VERSION,
  });
}

function requirePurchase(value: FlipPurchaseFixture): FlipPurchaseFixture {
  requireExactKeys(value, PURCHASE_KEYS, 'purchase');
  if (
    value?.schemaVersion !== FLIP_PURCHASE_FIXTURE_VERSION ||
    value.status !== 'fixture-acquired' ||
    value.provider !== 'fixture-marketplace'
  ) {
    throw stateError('INVALID_EVIDENCE', 'Flip purchase fixture is invalid');
  }
  return Object.freeze({
    amount: requireMoney(value.amount, 'purchase amount'),
    provider: 'fixture-marketplace',
    providerAssetReference: requireReference(
      value.providerAssetReference,
      'providerAssetReference',
    ),
    providerListingReference: requireReference(
      value.providerListingReference,
      'providerListingReference',
    ),
    reference: requireFixtureReference(value.reference, 'purchase reference'),
    schemaVersion: FLIP_PURCHASE_FIXTURE_VERSION,
    status: 'fixture-acquired',
  });
}

function requireTransfer(value: FlipTransferFixture): FlipTransferFixture {
  requireExactKeys(value, TRANSFER_KEYS, 'transfer');
  if (
    value?.schemaVersion !== FLIP_TRANSFER_FIXTURE_VERSION ||
    value.status !== 'fixture-transferred'
  ) {
    throw stateError('INVALID_EVIDENCE', 'Flip transfer fixture is invalid');
  }
  if (!FIXTURE_WALLET_PATTERN.test(value.destinationWalletReference)) {
    throw stateError('INVALID_EVIDENCE', 'Flip transfer destination must be a fixture wallet');
  }
  return Object.freeze({
    destinationWalletReference: value.destinationWalletReference,
    providerAssetReference: requireReference(
      value.providerAssetReference,
      'providerAssetReference',
    ),
    reference: requireFixtureReference(value.reference, 'transfer reference'),
    schemaVersion: FLIP_TRANSFER_FIXTURE_VERSION,
    sourceCustodyReference: requireFixtureReference(
      value.sourceCustodyReference,
      'source custody reference',
    ),
    status: 'fixture-transferred',
  });
}

function requireRevealReady(value: FlipRevealReadyFixture): FlipRevealReadyFixture {
  requireExactKeys(value, REVEAL_READY_KEYS, 'reveal readiness');
  if (
    value?.schemaVersion !== FLIP_REVEAL_READY_FIXTURE_VERSION ||
    value.status !== 'fixture-ready'
  ) {
    throw stateError('INVALID_EVIDENCE', 'Flip reveal readiness fixture is invalid');
  }
  return Object.freeze({
    purchaseReference: requireFixtureReference(value.purchaseReference, 'purchase reference'),
    reference: requireFixtureReference(value.reference, 'reveal readiness reference'),
    schemaVersion: FLIP_REVEAL_READY_FIXTURE_VERSION,
    status: 'fixture-ready',
    transferReference: requireFixtureReference(value.transferReference, 'transfer reference'),
  });
}

function requireSettlement(value: FlipSettlementFixture): FlipSettlementFixture {
  requireExactKeys(value, SETTLEMENT_KEYS, 'settlement');
  if (
    value?.schemaVersion !== FLIP_SETTLEMENT_FIXTURE_VERSION ||
    value.status !== 'fixture-recorded' ||
    !HASH_PATTERN.test(value.resultHash)
  ) {
    throw stateError('INVALID_EVIDENCE', 'Flip settlement fixture is invalid');
  }
  return Object.freeze({
    payout: requireMoney(value.payout, 'settlement payout'),
    providerAssetReference: requireReference(
      value.providerAssetReference,
      'providerAssetReference',
    ),
    reference: requireFixtureReference(value.reference, 'settlement reference'),
    resultHash: value.resultHash,
    schemaVersion: FLIP_SETTLEMENT_FIXTURE_VERSION,
    status: 'fixture-recorded',
  });
}

function requireRecoveryRequest(value: FlipRecoveryRequestFixture): FlipRecoveryRequestFixture {
  requireExactKeys(value, RECOVERY_REQUEST_KEYS, 'recovery request');
  if (
    value?.schemaVersion !== FLIP_RECOVERY_FIXTURE_VERSION ||
    value.status !== 'fixture-recovery-required'
  ) {
    throw stateError('INVALID_EVIDENCE', 'Flip recovery request fixture is invalid');
  }
  return Object.freeze({
    reasonCode: requireIdentifier(value.reasonCode, 'recovery reasonCode'),
    reference: requireFixtureReference(value.reference, 'recovery reference'),
    schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
    status: 'fixture-recovery-required',
  });
}

function requireRecoveryCompletion(
  value: FlipRecoveryCompletionFixture,
): FlipRecoveryCompletionFixture {
  requireExactKeys(value, RECOVERY_COMPLETION_KEYS, 'recovery completion');
  if (
    value?.schemaVersion !== FLIP_RECOVERY_FIXTURE_VERSION ||
    value.status !== 'fixture-recovered' ||
    !HASH_PATTERN.test(value.resultHash)
  ) {
    throw stateError('INVALID_EVIDENCE', 'Flip recovery completion fixture is invalid');
  }
  return Object.freeze({
    payout: requireMoney(value.payout, 'recovery payout'),
    reference: requireFixtureReference(value.reference, 'recovery reference'),
    resultHash: value.resultHash,
    schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
    status: 'fixture-recovered',
  });
}

function requireTerminalFailure(value: FlipTerminalFailureFixture): FlipTerminalFailureFixture {
  requireExactKeys(value, TERMINAL_FAILURE_KEYS, 'terminal failure');
  if (value?.schemaVersion !== FLIP_RECOVERY_FIXTURE_VERSION || value.status !== 'fixture-failed') {
    throw stateError('INVALID_EVIDENCE', 'Flip terminal failure fixture is invalid');
  }
  return Object.freeze({
    reasonCode: requireIdentifier(value.reasonCode, 'terminal reasonCode'),
    reference: requireFixtureReference(value.reference, 'terminal reference'),
    schemaVersion: FLIP_RECOVERY_FIXTURE_VERSION,
    status: 'fixture-failed',
  });
}

function requireMoney(value: unknown, label: string): Money {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as Partial<Money>).currency !== 'USDC' ||
    (value as Partial<Money>).decimals !== 6 ||
    typeof (value as Partial<Money>).amount !== 'string'
  ) {
    throw stateError('INVALID_EVIDENCE', `Flip ${label} is invalid`);
  }
  requireExactKeys(value, MONEY_KEYS, label);
  return Object.freeze({
    amount: requireAmount((value as Money).amount, label),
    currency: 'USDC',
    decimals: 6,
  });
}

function storedMoney(amount: string, currency: string | null, decimals: number | null): Money {
  if (currency !== 'USDC' || decimals !== 6) {
    throw stateError('INVALID_EVIDENCE', 'Stored Flip stake is not canonical USDC');
  }
  return { amount: requireAmount(amount, 'stored stake'), currency, decimals };
}

function requireAmount(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    !UNSIGNED_INTEGER_PATTERN.test(value) ||
    BigInt(value) > MAX_U64
  ) {
    throw stateError('INVALID_EVIDENCE', `Flip ${label} is invalid`);
  }
  return value;
}

function requireExactKeys(value: object, expectedKeys: readonly string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw stateError('INVALID_EVIDENCE', `Flip ${label} fixture is invalid`);
  }
  const keys = Object.keys(value);
  const expected = new Set(expectedKeys);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expected.has(key))) {
    throw stateError('INVALID_EVIDENCE', `Flip ${label} fixture has unsupported fields`);
  }
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw stateError('INVALID_EVIDENCE', `Flip ${label} is invalid`);
  }
  return value;
}

function requireReference(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 240 ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw stateError('INVALID_EVIDENCE', `Flip ${label} is invalid`);
  }
  return value;
}

function requireFixtureReference(value: string, label: string): string {
  if (!FIXTURE_REFERENCE_PATTERN.test(value)) {
    throw stateError('INVALID_EVIDENCE', `Flip ${label} is not fixture-backed`);
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function toStatus(status: DatabaseFlipSessionStatus): FlipSessionSnapshot['status'] {
  switch (status) {
    case DatabaseFlipSessionStatus.AWAITING_STAKE:
      return 'awaiting-stake';
    case DatabaseFlipSessionStatus.STAKE_CONFIRMED:
      return 'stake-confirmed';
    case DatabaseFlipSessionStatus.POOL_COMMITTED:
      return 'pool-committed';
    case DatabaseFlipSessionStatus.SELECTION_RECORDED:
      return 'selection-recorded';
    case DatabaseFlipSessionStatus.PURCHASE_RECORDED:
      return 'purchase-recorded';
    case DatabaseFlipSessionStatus.TRANSFER_RECORDED:
      return 'transfer-recorded';
    case DatabaseFlipSessionStatus.REVEAL_READY:
      return 'reveal-ready';
    case DatabaseFlipSessionStatus.RECOVERY_REQUIRED:
      return 'recovery-required';
    case DatabaseFlipSessionStatus.SETTLED:
      return 'settled';
    case DatabaseFlipSessionStatus.RECOVERED:
      return 'recovered';
    case DatabaseFlipSessionStatus.FAILED:
      return 'failed';
  }
}

function toKind(kind: DatabaseFlipSessionTransitionKind): FlipSessionTransitionSnapshot['kind'] {
  switch (kind) {
    case DatabaseFlipSessionTransitionKind.SESSION_STARTED:
      return 'session-started';
    case DatabaseFlipSessionTransitionKind.STAKE_CONFIRMED:
      return 'stake-confirmed';
    case DatabaseFlipSessionTransitionKind.POOL_COMMITTED:
      return 'pool-committed';
    case DatabaseFlipSessionTransitionKind.SELECTION_RECORDED:
      return 'selection-recorded';
    case DatabaseFlipSessionTransitionKind.PURCHASE_RECORDED:
      return 'purchase-recorded';
    case DatabaseFlipSessionTransitionKind.TRANSFER_RECORDED:
      return 'transfer-recorded';
    case DatabaseFlipSessionTransitionKind.REVEAL_READY:
      return 'reveal-ready';
    case DatabaseFlipSessionTransitionKind.SETTLED:
      return 'settled';
    case DatabaseFlipSessionTransitionKind.RECOVERY_REQUESTED:
      return 'recovery-requested';
    case DatabaseFlipSessionTransitionKind.RECOVERY_COMPLETED:
      return 'recovery-completed';
    case DatabaseFlipSessionTransitionKind.TERMINATED:
      return 'terminated';
  }
}

function stateError(code: FlipSessionStateErrorCode, message: string): FlipSessionStateError {
  return new FlipSessionStateError(code, message);
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
