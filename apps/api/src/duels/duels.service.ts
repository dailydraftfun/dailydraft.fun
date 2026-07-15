import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { Duel, DuelStatus, Page } from '../domain.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { PacksService } from '../packs/packs.service.js';
import type { CreateDuelRequest, ListDuelsQuery } from './duel.dto.js';

const DEMO_WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';

@Injectable()
export class DuelsService {
  readonly #duels = new Map<string, Duel>();
  readonly #idempotency = new Map<string, string>();

  constructor(private readonly packs: PacksService) {
    const pack = packs.findOne('pokemon_50');
    this.#duels.set('duel_DEMO0000000001', {
      createdAt: '2026-07-15T00:00:00.000Z',
      creatorWallet: DEMO_WALLET,
      expiresAt: '2027-07-15T00:00:00.000Z',
      id: 'duel_DEMO0000000001',
      matchmakingMode: 'open',
      opponentWallet: null,
      pack,
      stake: pack.price,
      status: 'waiting',
      updatedAt: '2026-07-15T00:00:00.000Z',
    });
  }

  findAll(query: ListDuelsQuery): Page<Duel> {
    const eligible = [...this.#duels.values()].filter((duel) => {
      const statusMatches = !query.status || duel.status === (query.status as DuelStatus);
      const walletMatches =
        !query.wallet ||
        duel.creatorWallet === query.wallet ||
        duel.opponentWallet === query.wallet ||
        duel.winnerWallet === query.wallet;
      return statusMatches && walletMatches;
    });
    const start = resolveCursor(eligible, query.cursor);
    const data = eligible.slice(start, start + query.limit);
    const hasMore = start + data.length < eligible.length;

    return {
      data,
      hasMore,
      nextCursor: hasMore ? data.at(-1)?.id : null,
    };
  }

  findOne(duelId: string): Duel {
    const duel = this.#duels.get(duelId);
    if (!duel) throw new NotFoundException(`Duel ${duelId} was not found`);
    return duel;
  }

  create(input: CreateDuelRequest, idempotencyKey: string): Duel {
    const existingId = this.#idempotency.get(idempotencyKey);
    if (existingId) return this.findOne(existingId);
    if (input.matchmakingMode === 'direct' && !input.opponentWallet) {
      throw new BadRequestException('opponentWallet is required for direct matchmaking');
    }
    if (new Date(input.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const pack = this.packs.findOne(input.packId);
    const id = `duel_${crypto.randomUUID().replaceAll('-', '')}`;
    const now = new Date().toISOString();
    const duel: Duel = {
      createdAt: now,
      creatorWallet: input.creatorWallet,
      expiresAt: input.expiresAt,
      id,
      matchmakingMode: input.matchmakingMode,
      opponentWallet: input.opponentWallet ?? null,
      pack,
      stake: pack.price,
      status: 'waiting',
      updatedAt: now,
    };

    this.#duels.set(id, duel);
    this.#idempotency.set(idempotencyKey, id);
    return duel;
  }

  getSocialCard(duelId: string): {
    duelId: string;
    imageUrl: string;
    pageUrl: string;
    shareText: string;
    status: DuelStatus;
  } {
    const duel = this.findOne(duelId);
    const appUrl = (process.env.OPENPACKSDUEL_APP_URL ?? 'http://localhost:3001').replace(
      /\/$/,
      '',
    );
    const encodedId = encodeURIComponent(duel.id);
    return {
      duelId: duel.id,
      imageUrl: `${appUrl}/duel/${encodedId}/opengraph-image`,
      pageUrl: `${appUrl}/duel/${encodedId}`,
      shareText: `Watch my ${duel.pack.name} duel on OpenPacks Duel.`,
      status: duel.status,
    };
  }
}

function resolveCursor(duels: Duel[], cursor?: string): number {
  if (!cursor) return 0;
  const index = duels.findIndex((duel) => duel.id === cursor);
  if (index === -1) throw new BadRequestException('cursor does not identify a visible duel');
  return index + 1;
}
