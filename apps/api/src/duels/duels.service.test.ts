import { afterEach, describe, expect, test } from 'bun:test';
import { HttpException } from '@nestjs/common';

import type { Duel, DuelEvent, DuelTransactionRecord, Page } from '../domain.js';
import { PacksService } from '../packs/packs.service.js';
import type { ListDuelsQuery } from './duel.dto.js';
import {
  type CreateDuelRecord,
  DuelRepository,
  type LeaderboardDuelPage,
  type ResolveOpenedPacksRecord,
  type TransitionDuelRecord,
} from './duel.repository.js';
import { canTransition, isTransactionTransition } from './duel-state.js';
import { DuelsService } from './duels.service.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT = 'DeWQgPfic3khpn4F7QPu7AHoqyJbKuRk9vKZXdxo12Eu';
const originalAppUrl = process.env.DAILYDRAFT_APP_URL;
const originalNodeEnvironment = process.env.NODE_ENV;
const originalProviderMode = process.env.DAILYDRAFT_PROVIDER_MODE;

afterEach(() => {
  setEnvironment('DAILYDRAFT_APP_URL', originalAppUrl);
  setEnvironment('NODE_ENV', originalNodeEnvironment);
  setEnvironment('DAILYDRAFT_PROVIDER_MODE', originalProviderMode);
});

describe('DuelsService', () => {
  test('allows only forward or recovery state transitions', () => {
    expect(canTransition('matched', 'committing')).toBe(true);
    expect(canTransition('settling', 'settled')).toBe(true);
    expect(canTransition('settled', 'opening')).toBe(false);
    expect(canTransition('failed', 'refunding')).toBe(true);
    expect(isTransactionTransition('settle', 'settling', 'settled')).toBe(true);
    expect(isTransactionTransition('fund', 'settling', 'settled')).toBe(false);
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
    process.env.NODE_ENV = 'production';
    process.env.DAILYDRAFT_APP_URL = 'https://dailydraft.fun';
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
    expect((await service.getSocialCard(duel.id)).imageUrl).toEndWith(
      `/duel/${duel.id}/social/matched`,
    );
  });

  test('fails closed instead of generating localhost social links in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DAILYDRAFT_APP_URL;
    const service = new DuelsService(new FakeDuelRepository(), new PacksService());
    const duel = await service.create(
      {
        creatorWallet: WALLET,
        expiresAt: futureDate(),
        matchmakingMode: 'open',
        packId: 'pokemon_50',
      },
      'idempotency-key-social-card',
    );

    try {
      await service.getSocialCard(duel.id);
      throw new Error('Expected social link generation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
    }
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

  test('refuses to create a duel under an unrecognised provider mode', async () => {
    // An unknown mode must fail closed rather than silently falling back to mock pricing.
    process.env.DAILYDRAFT_PROVIDER_MODE = 'bogus-provider';
    const service = new DuelsService(new FakeDuelRepository(), new PacksService());

    const error = await service
      .create(
        {
          creatorWallet: WALLET,
          expiresAt: futureDate(),
          matchmakingMode: 'open',
          packId: 'pokemon_50',
        },
        'idempotency-key-0006',
      )
      .then(() => undefined)
      .catch((value: unknown) => value);

    expect((error as Error | undefined)?.message).toContain(
      'must be mock, dailydraft-devnet, or collector-crypt-sandbox',
    );
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

  async listSettledForLeaderboard(_limit: number): Promise<LeaderboardDuelPage> {
    return {
      data: [...this.#duels.values()].filter((duel) => duel.status === 'settled'),
      hasMore: false,
    };
  }

  async listTransactions(_duelId: string): Promise<DuelTransactionRecord[]> {
    return [];
  }

  async resolveOpenedPacks(_input: ResolveOpenedPacksRecord): Promise<Duel> {
    throw new Error('Not implemented by this test fake');
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

function setEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
