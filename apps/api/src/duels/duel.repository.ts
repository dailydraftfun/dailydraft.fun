import type { Prisma } from '@openpacksduel/db';

import type {
  Duel,
  DuelEvent,
  DuelTransactionRecord,
  MatchmakingMode,
  Pack,
  Page,
} from '../domain.js';
import type { ComparedPackOutcomes, NormalizedPackOutcome } from '../providers/provider-result.js';
import type { ListDuelsQuery } from './duel.dto.js';

export interface CreateDuelRecord {
  creatorWallet: string;
  expiresAt: Date;
  houseOpponent: boolean;
  id: string;
  matchmakingMode: MatchmakingMode;
  opponentJoinedAt?: Date;
  opponentWallet?: string;
  pack: Pack;
  providerMode: 'collector-crypt-sandbox' | 'mock';
}

export interface TransitionDuelRecord {
  actorWallet?: string;
  data?: Record<string, unknown>;
  duelId: string;
  eventType: string;
  idempotencyKey: string;
  requestHash: string;
  toStatus: Duel['status'];
}

export interface ResolveOpenedPacksRecord {
  comparison: ComparedPackOutcomes;
  creator: NormalizedPackOutcome & { providerReference: string };
  duelId: string;
  idempotencyKey: string;
  isMock: boolean;
  opponent: NormalizedPackOutcome & { providerReference: string };
  provider: string;
  requestHash: string;
}

export abstract class DuelRepository {
  abstract cancel(
    duelId: string,
    wallet: string,
    reason: string,
    idempotencyKey: string,
    requestHash: string,
    now: Date,
  ): Promise<Duel>;

  abstract create(
    input: CreateDuelRecord,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<Duel>;

  abstract expireTimedOut(now: Date): Promise<number>;
  abstract findAll(query: ListDuelsQuery): Promise<Page<Duel>>;
  abstract findOne(duelId: string): Promise<Duel | null>;
  abstract join(
    duelId: string,
    wallet: string,
    idempotencyKey: string,
    requestHash: string,
    now: Date,
  ): Promise<Duel>;
  abstract listEvents(duelId: string): Promise<DuelEvent[]>;
  abstract listTransactions(duelId: string): Promise<DuelTransactionRecord[]>;
  abstract resolveOpenedPacks(input: ResolveOpenedPacksRecord): Promise<Duel>;
  abstract transition(input: TransitionDuelRecord): Promise<Duel>;
}

export type TransactionClient = Prisma.TransactionClient;
