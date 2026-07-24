import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { DuelProviderOperationStatus } from '@openpacksduel/db';

import type { Duel, DuelEvent, DuelTransactionRecord, Page } from '../domain.js';
import { PacksService } from '../packs/packs.service.js';
import { CollectorCryptPackProvider } from '../providers/collector-crypt-pack.provider.js';
import { MockPackProvider } from '../providers/mock-pack.provider.js';
import type {
  GeneratePackInput,
  OpenedProviderPackSnapshot,
  OpenPackInput,
  ProviderPackSnapshot,
  ProviderResponseEvidence,
} from '../providers/pack-provider.js';
import { PackProvider } from '../providers/pack-provider.js';
import { PackProviderService } from '../providers/pack-provider.service.js';
import {
  assertProviderResponseEvidence,
  createProviderResponseEvidence,
  rawProviderResponsePayload,
} from '../providers/provider-response-evidence.js';
import { CANONICAL_VALUATION_POLICY_HASH } from '../providers/valuation-policy.js';
import type { ListDuelsQuery } from './duel.dto.js';
import {
  type CreateDuelRecord,
  DuelRepository,
  type LeaderboardDuelPage,
  type ResolveOpenedPacksRecord,
  type TransitionDuelRecord,
} from './duel.repository.js';
import { DuelOpeningService } from './duel-opening.service.js';
import { DuelsService } from './duels.service.js';
import type {
  ProviderOpeningOperation,
  ProviderOperationReservation,
} from './provider-opening.repository.js';

const CREATOR = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';

describe('DuelOpeningService', () => {
  test('uses one deterministic opening path for wallet and house opponents', async () => {
    const repository = new OpeningRepository([
      fundedDuel('duel_wallet', false),
      fundedDuel('duel_house', true),
    ]);
    const duels = new DuelsService(repository, new PacksService());
    const providers = new PackProviderService(
      new MockPackProvider(),
      new CollectorCryptPackProvider(),
    );
    const service = new DuelOpeningService(
      duels,
      repository,
      providers,
      new FixtureProviderOperations() as never,
    );

    const walletResult = await service.open('duel_wallet', 'open-wallet-0001');
    const houseResult = await service.open('duel_house', 'open-house-0001');

    for (const result of [walletResult, houseResult]) {
      expect(result.status).toBe('awaiting_assets');
      expect(result.result?.settlementReady).toBe(true);
      expect(result.result?.outcomes).toHaveLength(2);
      expect(result.winnerWallet).not.toBeNull();
      expect([CREATOR, OPPONENT]).toContain(result.winnerWallet ?? 'missing');
    }
    expect(repository.resolvedModes).toEqual(['direct', 'house']);
  });

  test('lets an already-funded house duel continue while emergency pause blocks direct opening', async () => {
    const repository = new OpeningRepository([
      fundedDuel('duel_paused_house', true),
      fundedDuel('duel_paused_direct', false),
    ]);
    const duels = new DuelsService(repository, new PacksService());
    const providers = new PackProviderService(
      new MockPackProvider(),
      new CollectorCryptPackProvider(),
    );
    const admin = {
      assertNotPaused: () => Promise.reject(new Error('New duel exposure is paused')),
    };
    const service = new DuelOpeningService(
      duels,
      repository,
      providers,
      new FixtureProviderOperations() as never,
      undefined,
      undefined,
      admin as never,
    );

    const houseResult = await service.open('duel_paused_house', 'open-paused-house-0001');

    expect(houseResult.status).toBe('awaiting_assets');
    await expect(service.open('duel_paused_direct', 'open-paused-direct-0001')).rejects.toThrow(
      'New duel exposure is paused',
    );
  });

  test('reconciles a devnet settlement misclassified as refunding before returning the receipt', async () => {
    const repository = new OpeningRepository([refundingDevnetDuel()]);
    const duels = new DuelsService(repository, new PacksService());
    const providers = new PackProviderService(
      new MockPackProvider(),
      new CollectorCryptPackProvider(),
    );
    const finalized: string[] = [];
    const service = new DuelOpeningService(
      duels,
      repository,
      providers,
      new FixtureProviderOperations() as never,
      {
        finalizeDuel: async (duelId: string) => {
          finalized.push(duelId);
          repository.setStatus(duelId, 'settled');
        },
      } as never,
      undefined,
      { assertNotPaused: () => Promise.reject(new Error('paused')) } as never,
    );

    const result = await service.open('duel_refunding', 'resume-refunding-0001');

    expect(finalized).toEqual(['duel_refunding']);
    expect(result.status).toBe('settled');
  });

  test('recovers an ambiguous one-sided open without duplicate requests or early reveal', async () => {
    const repository = new OpeningRepository([fundedDuel('duel_recovery', false)]);
    const duels = new DuelsService(repository, new PacksService());
    const operations = new FixtureProviderOperations();
    const provider = new AmbiguousFixtureProvider(() => operations.operations.size);
    const analytics: Array<{ name: string }> = [];
    const service = new DuelOpeningService(
      duels,
      repository,
      { forDuel: () => provider } as unknown as PackProviderService,
      operations as never,
      undefined,
      {
        recordServer: async (event: { name: string }) => {
          analytics.push(event);
        },
      } as never,
    );

    await expect(service.open('duel_recovery', 'first-attempt')).rejects.toThrow(
      'ambiguous fixture response',
    );

    expect(provider.generateInputs).toHaveLength(2);
    expect(provider.generateInputs.map((input) => input.recipientWallet)).toEqual([
      'escrow_duel_recovery',
      'escrow_duel_recovery',
    ]);
    expect(provider.openKeys.sort()).toEqual([
      'duel_recovery:creator:open',
      'duel_recovery:opponent:open',
    ]);
    expect(operations.forSide('creator').status).toBe(DuelProviderOperationStatus.OPENED);
    expect(operations.forSide('opponent').status).toBe(
      DuelProviderOperationStatus.RECOVERY_REQUIRED,
    );
    expect(analytics.some((event) => event.name === 'pack_reveal_started')).toBe(false);

    const recovered = await service.open('duel_recovery', 'retry-attempt');

    expect(recovered.status).toBe('awaiting_assets');
    expect(provider.generateInputs).toHaveLength(2);
    expect(provider.openKeys.sort()).toEqual([
      'duel_recovery:creator:open',
      'duel_recovery:opponent:open',
    ]);
    expect(operations.forSide('opponent')).toMatchObject({
      errorCode: null,
      normalizedOutcome: expect.objectContaining({ assetReference: 'fixture-opponent-card' }),
      status: DuelProviderOperationStatus.OPENED,
    });
    expect(operations.evidence).toHaveLength(2);
    expect(
      operations.evidence.every(
        (entry) =>
          entry.rawPayload.includes('fixture-') && entry.recipientWallet === 'escrow_duel_recovery',
      ),
    ).toBe(true);
    expect(analytics.filter((event) => event.name === 'pack_reveal_started')).toHaveLength(1);
    expect(analytics.filter((event) => event.name === 'pack_revealed')).toHaveLength(1);
  });
});

class FixtureProviderOperations {
  readonly evidence: Array<{
    rawPayload: string;
    recipientWallet: string;
  }> = [];
  readonly operations = new Map<string, ProviderOpeningOperation>();

  async reservePair(
    reservations: readonly [ProviderOperationReservation, ProviderOperationReservation],
  ): Promise<readonly [ProviderOpeningOperation, ProviderOpeningOperation]> {
    for (const reservation of reservations) {
      const key = operationKey(reservation.duelId, reservation.side);
      const existing = this.operations.get(key);
      if (existing) {
        if (
          existing.duelId !== reservation.duelId ||
          existing.recipientWallet !== reservation.recipientWallet ||
          existing.generateIdempotencyKey !== reservation.generateIdempotencyKey ||
          existing.openIdempotencyKey !== reservation.openIdempotencyKey
        ) {
          throw new Error('Fixture operation identity changed');
        }
        continue;
      }
      this.operations.set(key, {
        ...reservation,
        errorCode: null,
        evidence: null,
        id: `providerop_${reservation.duelId}_${reservation.side}`,
        normalizedOutcome: null,
        providerReference: null,
        status: DuelProviderOperationStatus.REQUESTED,
      });
    }
    return [
      this.forSide('creator', reservations[0].duelId),
      this.forSide('opponent', reservations[0].duelId),
    ];
  }

  async recordGenerated(
    operationId: string,
    providerReference: string,
  ): Promise<ProviderOpeningOperation> {
    const operation = this.byId(operationId);
    if (operation.providerReference && operation.providerReference !== providerReference) {
      throw new Error('Fixture provider reference changed');
    }
    return this.update(operation, {
      errorCode: null,
      providerReference,
      status: DuelProviderOperationStatus.GENERATED,
    });
  }

  async markOpening(operationId: string): Promise<ProviderOpeningOperation> {
    const operation = this.byId(operationId);
    if (operation.status === DuelProviderOperationStatus.OPENED) return operation;
    return this.update(operation, {
      errorCode: null,
      status: DuelProviderOperationStatus.OPENING,
    });
  }

  async recordOpened(input: {
    evidence: ProviderResponseEvidence;
    normalizedOutcome: NonNullable<ProviderOpeningOperation['normalizedOutcome']>;
    operationId: string;
    providerReference: string;
  }): Promise<ProviderOpeningOperation> {
    const operation = this.byId(input.operationId);
    this.evidence.push({
      rawPayload: input.evidence.rawPayload,
      recipientWallet: operation.recipientWallet,
    });
    return this.update(operation, {
      errorCode: null,
      evidence: input.evidence,
      normalizedOutcome: input.normalizedOutcome,
      providerReference: input.providerReference,
      status: DuelProviderOperationStatus.OPENED,
    });
  }

  async markRecovery(operationId: string, errorCode: string): Promise<ProviderOpeningOperation> {
    const operation = this.byId(operationId);
    if (operation.status === DuelProviderOperationStatus.OPENED) return operation;
    return this.update(operation, {
      errorCode,
      status: DuelProviderOperationStatus.RECOVERY_REQUIRED,
    });
  }

  forSide(side: 'creator' | 'opponent', duelId = 'duel_recovery'): ProviderOpeningOperation {
    const operation = this.operations.get(operationKey(duelId, side));
    if (!operation) throw new Error(`Missing ${side} fixture operation`);
    return operation;
  }

  private byId(operationId: string): ProviderOpeningOperation {
    const operation = [...this.operations.values()].find(
      (candidate) => candidate.id === operationId,
    );
    if (!operation) throw new Error(`Missing fixture operation ${operationId}`);
    return operation;
  }

  private update(
    operation: ProviderOpeningOperation,
    values: Partial<ProviderOpeningOperation>,
  ): ProviderOpeningOperation {
    const updated = { ...operation, ...values };
    this.operations.set(operationKey(operation.duelId, operation.side), updated);
    return updated;
  }
}

function operationKey(duelId: string, side: 'creator' | 'opponent'): string {
  return `${duelId}:${side}`;
}

class AmbiguousFixtureProvider extends PackProvider {
  readonly mode = 'mock' as const;
  readonly generateInputs: GeneratePackInput[] = [];
  readonly openKeys: string[] = [];
  readonly #opened = new Map<string, OpenedProviderPackSnapshot>();
  #ambiguousOpponent = true;

  constructor(private readonly reservedOperationCount: () => number) {
    super();
  }

  async generatePack(input: GeneratePackInput) {
    if (this.reservedOperationCount() !== 2) {
      throw new Error('Provider called before both operations were committed');
    }
    this.generateInputs.push(input);
    return { providerReference: `fixture-${input.side}`, status: 'generated' as const };
  }

  async openPack(input: OpenPackInput): Promise<ProviderPackSnapshot> {
    this.openKeys.push(input.idempotencyKey);
    const side = input.providerReference.endsWith('creator') ? 'creator' : 'opponent';
    const opened = fixtureOpenedSnapshot(side, input.providerReference);
    this.#opened.set(input.providerReference, opened);
    if (side === 'opponent' && this.#ambiguousOpponent) {
      this.#ambiguousOpponent = false;
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('ambiguous fixture response');
    }
    return opened;
  }

  async getPack(providerReference: string): Promise<ProviderPackSnapshot> {
    return (
      this.#opened.get(providerReference) ?? {
        providerReference,
        status: 'generated',
      }
    );
  }

  verifyOpenedSnapshot(snapshot: OpenedProviderPackSnapshot): void {
    assertProviderResponseEvidence(
      snapshot,
      fixtureEvidenceSignature(snapshot.evidence.rawPayload),
    );
  }
}

function fixtureOpenedSnapshot(
  side: 'creator' | 'opponent',
  providerReference: string,
): OpenedProviderPackSnapshot {
  const openedAt = new Date().toISOString();
  const unsigned = {
    openedAt,
    providerReference,
    result: {
      assetReference: `fixture-${side}-card`,
      displayName: `Fixture ${side} card`,
      insuredValue: {
        amount: side === 'creator' ? '50000001' : '50000000',
        currency: 'USDC' as const,
        decimals: 6 as const,
      },
      poolVersion: 'fixture-provider-pool-v1',
      sourceTimestamp: openedAt,
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    },
    status: 'opened' as const,
  };
  const rawPayload = rawProviderResponsePayload(unsigned);
  return {
    ...unsigned,
    evidence: createProviderResponseEvidence({
      rawPayload,
      signature: fixtureEvidenceSignature(rawPayload),
      signatureAlgorithm: 'sha256-fixture',
      signingKeyReference: 'fixture-provider-key-v1',
    }),
  };
}

function fixtureEvidenceSignature(rawPayload: string): string {
  return createHash('sha256').update(`fixture-signature:${rawPayload}`).digest('hex');
}

class OpeningRepository extends DuelRepository {
  readonly #duels: Map<string, Duel>;
  readonly resolvedModes: Duel['matchmakingMode'][] = [];

  constructor(duels: Duel[]) {
    super();
    this.#duels = new Map(duels.map((duel) => [duel.id, duel]));
  }

  async findOne(duelId: string): Promise<Duel | null> {
    return this.#duels.get(duelId) ?? null;
  }

  async transition(input: TransitionDuelRecord): Promise<Duel> {
    const duel = this.require(input.duelId);
    const transitioned = { ...duel, status: input.toStatus, version: duel.version + 1 };
    this.#duels.set(duel.id, transitioned);
    return transitioned;
  }

  async resolveOpenedPacks(input: ResolveOpenedPacksRecord): Promise<Duel> {
    const duel = this.require(input.duelId);
    const winnerWallet =
      input.comparison.winnerSide === 'creator'
        ? duel.creatorWallet
        : input.comparison.winnerSide === 'opponent'
          ? (duel.opponentWallet ?? null)
          : null;
    const resolved: Duel = {
      ...duel,
      result: {
        comparisonMetric: 'insured-value',
        outcomes: [input.creator, input.opponent].map((outcome) => ({
          assetReference: outcome.assetReference,
          displayName: outcome.displayName,
          insuredValue: outcome.insuredValue,
          isMock: input.isMock,
          openedAt: outcome.openedAt,
          provider: input.provider,
          providerReference: outcome.providerReference,
          poolVersion: outcome.poolVersion,
          resultHash: outcome.resultHash,
          side: outcome.side,
          sourceTimestamp: outcome.sourceTimestamp,
        })),
        resultHash: input.comparison.resultHash,
        settlementReady: true,
        tieRule: input.comparison.tieRule,
        valuationPolicyHash: input.creator.valuationPolicyHash,
        winnerSide: input.comparison.winnerSide,
      },
      status: 'awaiting_assets',
      version: duel.version + 1,
      winnerWallet,
    };
    this.resolvedModes.push(duel.matchmakingMode);
    this.#duels.set(duel.id, resolved);
    return resolved;
  }

  async cancel(): Promise<Duel> {
    throw new Error('Not used by this test');
  }

  async create(_input: CreateDuelRecord): Promise<Duel> {
    throw new Error('Not used by this test');
  }

  async expireTimedOut(): Promise<number> {
    return 0;
  }

  async findAll(_query: ListDuelsQuery): Promise<Page<Duel>> {
    return { data: [...this.#duels.values()], hasMore: false };
  }

  async join(): Promise<Duel> {
    throw new Error('Not used by this test');
  }

  async listEvents(): Promise<DuelEvent[]> {
    return [];
  }

  async listSettledForLeaderboard(): Promise<LeaderboardDuelPage> {
    return {
      data: [...this.#duels.values()].filter((duel) => duel.status === 'settled'),
      hasMore: false,
    };
  }

  async listTransactions(): Promise<DuelTransactionRecord[]> {
    return [];
  }

  setStatus(duelId: string, status: Duel['status']): void {
    const duel = this.require(duelId);
    this.#duels.set(duelId, { ...duel, status, version: duel.version + 1 });
  }

  private require(duelId: string): Duel {
    const duel = this.#duels.get(duelId);
    if (!duel) throw new Error(`Missing test duel ${duelId}`);
    return duel;
  }
}

function fundedDuel(id: string, houseOpponent: boolean): Duel {
  const now = new Date();
  return {
    createdAt: now.toISOString(),
    creatorWallet: CREATOR,
    environment: 'solana-devnet',
    escrowAddress: `escrow_${id}`,
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    houseOpponent,
    id,
    matchmakingMode: houseOpponent ? 'house' : 'direct',
    opponentWallet: OPPONENT,
    pack: {
      active: true,
      id: 'pokemon_50',
      name: 'Pokémon $50 Pack',
      price: { amount: '50000000', currency: 'USDC', decimals: 6 },
      provider: 'jupiter-gacha',
      providerPackId: 'pokemon_50',
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
    },
    providerMode: 'mock',
    stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
    status: 'funded',
    updatedAt: now.toISOString(),
    version: 3,
  };
}

function refundingDevnetDuel(): Duel {
  const duel = fundedDuel('duel_refunding', true);
  return {
    ...duel,
    providerMode: 'openpacksduel-devnet',
    result: {
      comparisonMetric: 'insured-value',
      outcomes: [],
      resultHash: 'result_hash',
      settlementReady: true,
      tieRule: 'return-original-assets-and-refund-platform-fees',
      valuationPolicyHash: CANONICAL_VALUATION_POLICY_HASH,
      winnerSide: 'creator',
    },
    status: 'refunding',
    winnerWallet: CREATOR,
  };
}
