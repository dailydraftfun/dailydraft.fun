import { describe, expect, test } from 'bun:test';

import type { Duel, DuelEvent, DuelTransactionRecord, Page } from '../domain.js';
import { PacksService } from '../packs/packs.service.js';
import type { ListDuelsQuery } from './duel.dto.js';
import {
  type CreateDuelRecord,
  DuelRepository,
  type TransitionDuelRecord,
} from './duel.repository.js';
import { DuelsService } from './duels.service.js';
import { canTransition } from './prisma-duel.repository.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';

describe('DuelsService', () => {
  test('allows only forward or recovery state transitions', () => {
    expect(canTransition('matched', 'committing')).toBe(true);
    expect(canTransition('settling', 'settled')).toBe(true);
    expect(canTransition('settled', 'opening')).toBe(false);
    expect(canTransition('failed', 'refunding')).toBe(true);
  });

  test('replays an idempotent create request from durable storage', async () => {
    const service = new DuelsService(new FakeDuelRepository(), new PacksService());
    const input = {
      creatorWallet: WALLET,
      expiresAt: futureDate(),
      matchmakingMode: 'open' as const,
      packId: 'pokemon_50',
    };

    const first = await service.create(input, 'idempotency-key-0001');
    const replay = await service.create(input, 'idempotency-key-0001');

    expect(replay.id).toBe(first.id);
    expect(replay.environment).toBe('solana-devnet');
    expect(replay.providerMode).toBe('mock');
  });

  test('requires an opponent for direct matchmaking', async () => {
    const service = new DuelsService(new FakeDuelRepository(), new PacksService());

    expect(
      service.create(
        {
          creatorWallet: WALLET,
          expiresAt: futureDate(),
          matchmakingMode: 'direct',
          packId: 'pokemon_50',
        },
        'idempotency-key-0002',
      ),
    ).rejects.toThrow('opponentWallet is required');
  });

  test('creates a disclosed devnet house match without marking it funded', async () => {
    const service = new DuelsService(new FakeDuelRepository(), new PacksService());

    const duel = await service.create(
      {
        creatorWallet: WALLET,
        expiresAt: futureDate(),
        matchmakingMode: 'house',
        packId: 'pokemon_50',
      },
      'idempotency-key-0003',
    );

    expect(duel.houseOpponent).toBe(true);
    expect(duel.status).toBe('matched');
    expect(duel.opponentWallet).toBe(OPPONENT);
  });

  test('joins an open duel once and records the opponent wallet', async () => {
    const service = new DuelsService(new FakeDuelRepository(), new PacksService());
    const duel = await service.create(
      {
        creatorWallet: WALLET,
        expiresAt: futureDate(),
        matchmakingMode: 'open',
        packId: 'pokemon_50',
      },
      'idempotency-key-0004',
    );

    const joined = await service.join(duel.id, { wallet: OPPONENT }, 'idempotency-key-0005');

    expect(joined.status).toBe('matched');
    expect(joined.opponentWallet).toBe(OPPONENT);
  });
});

class FakeDuelRepository extends DuelRepository {
  readonly #duels = new Map<string, Duel>();
  readonly #idempotency = new Map<string, string>();

  async create(
    input: CreateDuelRecord,
    idempotencyKey: string,
    _requestHash: string,
  ): Promise<Duel> {
    const existing = this.#idempotency.get(`create:${idempotencyKey}`);
    if (existing) return this.#duels.get(existing) as Duel;
    const now = new Date().toISOString();
    const duel: Duel = {
      createdAt: now,
      creatorWallet: input.creatorWallet,
      environment: 'solana-devnet',
      expiresAt: input.expiresAt.toISOString(),
      houseOpponent: input.houseOpponent,
      id: input.id,
      matchmakingMode: input.matchmakingMode,
      opponentJoinedAt: input.opponentJoinedAt?.toISOString() ?? null,
      opponentWallet: input.opponentWallet ?? null,
      pack: input.pack,
      providerMode: input.providerMode,
      stake: input.pack.price,
      status: input.houseOpponent ? 'matched' : 'waiting',
      updatedAt: now,
      version: 1,
    };
    this.#duels.set(duel.id, duel);
    this.#idempotency.set(`create:${idempotencyKey}`, duel.id);
    return duel;
  }

  async join(
    duelId: string,
    wallet: string,
    _idempotencyKey: string,
    _requestHash: string,
    now: Date,
  ): Promise<Duel> {
    const duel = this.#duels.get(duelId) as Duel;
    const joined = {
      ...duel,
      opponentJoinedAt: now.toISOString(),
      opponentWallet: wallet,
      status: 'matched' as const,
      version: duel.version + 1,
    };
    this.#duels.set(duelId, joined);
    return joined;
  }

  async cancel(
    duelId: string,
    _wallet: string,
    reason: string,
    _idempotencyKey: string,
    _requestHash: string,
    _now: Date,
  ): Promise<Duel> {
    const duel = this.#duels.get(duelId) as Duel;
    const cancelled = {
      ...duel,
      cancellationReason: reason,
      status: 'cancelled' as const,
      version: duel.version + 1,
    };
    this.#duels.set(duelId, cancelled);
    return cancelled;
  }

  async expireTimedOut(now: Date): Promise<number> {
    let expired = 0;
    for (const [id, duel] of this.#duels) {
      if (new Date(duel.expiresAt) <= now && ['matched', 'waiting'].includes(duel.status)) {
        this.#duels.set(id, {
          ...duel,
          cancellationReason: 'timeout',
          status: 'cancelled',
          version: duel.version + 1,
        });
        expired += 1;
      }
    }
    return expired;
  }

  async findAll(_query: ListDuelsQuery): Promise<Page<Duel>> {
    return { data: [...this.#duels.values()], hasMore: false, nextCursor: null };
  }

  async findOne(duelId: string): Promise<Duel | null> {
    return this.#duels.get(duelId) ?? null;
  }

  async listEvents(_duelId: string): Promise<DuelEvent[]> {
    return [];
  }

  async listTransactions(_duelId: string): Promise<DuelTransactionRecord[]> {
    return [];
  }

  async transition(input: TransitionDuelRecord): Promise<Duel> {
    const duel = this.#duels.get(input.duelId) as Duel;
    const transitioned = { ...duel, status: input.toStatus, version: duel.version + 1 };
    this.#duels.set(input.duelId, transitioned);
    return transitioned;
  }
}

function futureDate(): string {
  return new Date(Date.now() + 60 * 60 * 1_000).toISOString();
}
