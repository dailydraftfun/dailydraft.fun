import { describe, expect, test } from 'bun:test';

import type { Duel, DuelEvent, DuelTransactionRecord, Page } from '../domain.js';
import { PacksService } from '../packs/packs.service.js';
import { CollectorCryptPackProvider } from '../providers/collector-crypt-pack.provider.js';
import { MockPackProvider } from '../providers/mock-pack.provider.js';
import { PackProviderService } from '../providers/pack-provider.service.js';
import type { ListDuelsQuery } from './duel.dto.js';
import {
  type CreateDuelRecord,
  DuelRepository,
  type ResolveOpenedPacksRecord,
  type TransitionDuelRecord,
} from './duel.repository.js';
import { DuelOpeningService } from './duel-opening.service.js';
import { DuelsService } from './duels.service.js';

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
    const service = new DuelOpeningService(duels, repository, providers);

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
});

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
          resultHash: outcome.resultHash,
          side: outcome.side,
        })),
        resultHash: input.comparison.resultHash,
        settlementReady: input.comparison.winnerSide !== null,
        valuationPolicyHash: input.creator.valuationPolicyHash,
        winnerSide: input.comparison.winnerSide,
      },
      status: input.comparison.winnerSide ? 'awaiting_assets' : 'refunding',
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

  async listTransactions(): Promise<DuelTransactionRecord[]> {
    return [];
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
    },
    providerMode: 'mock',
    stake: { amount: '50000000', currency: 'USDC', decimals: 6 },
    status: 'funded',
    updatedAt: now.toISOString(),
    version: 3,
  };
}
