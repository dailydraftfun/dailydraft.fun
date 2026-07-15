import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { AnalyticsService } from '../analytics/analytics.service.js';
import type { Duel, DuelEvent, DuelTransactionRecord, Page } from '../domain.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { PacksService } from '../packs/packs.service.js';
import type {
  CancelDuelRequest,
  CreateDuelRequest,
  JoinDuelRequest,
  ListDuelsQuery,
} from './duel.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the repository class as a runtime injection token.
import { DuelRepository } from './duel.repository.js';
import { hashDuelRequest } from './prisma-duel.repository.js';

const DEFAULT_HOUSE_DEVNET_WALLET = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const MAX_DUEL_LIFETIME_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class DuelsService {
  constructor(
    private readonly repository: DuelRepository,
    private readonly packs: PacksService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  async findAll(query: ListDuelsQuery): Promise<Page<Duel>> {
    await this.repository.expireTimedOut(new Date());
    return this.repository.findAll(query);
  }

  async findOne(duelId: string): Promise<Duel> {
    await this.repository.expireTimedOut(new Date());
    const duel = await this.repository.findOne(duelId);
    if (!duel) throw new NotFoundException(`Duel ${duelId} was not found`);
    return duel;
  }

  async create(input: CreateDuelRequest, idempotencyKey: string): Promise<Duel> {
    validateCreation(input);
    const pack = this.packs.findOne(input.packId);
    const isHouse = input.matchmakingMode === 'house';
    const providerMode = resolveProviderMode();
    if (isHouse && input.creatorWallet === resolveHouseWallet()) {
      throw new BadRequestException('The configured house wallet cannot challenge itself');
    }
    const request = { ...input, environment: 'solana-devnet', providerMode };

    const duel = await this.repository.create(
      {
        creatorWallet: input.creatorWallet,
        expiresAt: new Date(input.expiresAt),
        houseOpponent: isHouse,
        id: createDuelId(),
        matchmakingMode: input.matchmakingMode,
        ...(isHouse ? { opponentJoinedAt: new Date(), opponentWallet: resolveHouseWallet() } : {}),
        ...(input.opponentWallet ? { opponentWallet: input.opponentWallet } : {}),
        pack,
        providerMode,
      },
      idempotencyKey,
      hashDuelRequest(request),
    );
    await this.analytics?.recordServer({
      duelId: duel.id,
      mode: duel.matchmakingMode,
      name: 'duel_created',
      ...(input.analyticsSessionId ? { sessionId: input.analyticsSessionId } : {}),
      status: duel.status,
      tier: moneyToTier(duel.stake.amount, duel.stake.decimals),
    });
    if (duel.status === 'matched') {
      await this.analytics?.recordServer({
        duelId: duel.id,
        mode: duel.matchmakingMode,
        name: 'duel_matched',
        ...(input.analyticsSessionId ? { sessionId: input.analyticsSessionId } : {}),
        status: duel.status,
        tier: moneyToTier(duel.stake.amount, duel.stake.decimals),
      });
    }
    return duel;
  }

  async join(duelId: string, input: JoinDuelRequest, idempotencyKey: string): Promise<Duel> {
    const now = new Date();
    await this.repository.expireTimedOut(now);
    const duel = await this.repository.join(
      duelId,
      input.wallet,
      idempotencyKey,
      hashDuelRequest(input),
      now,
    );
    await this.analytics?.recordServer({
      duelId: duel.id,
      mode: duel.matchmakingMode,
      name: 'duel_matched',
      ...(input.analyticsSessionId ? { sessionId: input.analyticsSessionId } : {}),
      status: duel.status,
      tier: moneyToTier(duel.stake.amount, duel.stake.decimals),
    });
    return duel;
  }

  async cancel(duelId: string, input: CancelDuelRequest, idempotencyKey: string): Promise<Duel> {
    const now = new Date();
    await this.repository.expireTimedOut(now);
    const current = await this.repository.findOne(duelId);
    if (!current) throw new NotFoundException(`Duel ${duelId} was not found`);
    if (current.status === 'cancelled' && current.cancellationReason === 'timeout') return current;

    const duel = await this.repository.cancel(
      duelId,
      input.wallet,
      normalizeReason(input.reason),
      idempotencyKey,
      hashDuelRequest(input),
      now,
    );
    await this.analytics?.recordServer({
      duelId: duel.id,
      mode: duel.matchmakingMode,
      name: 'duel_cancelled',
      ...(input.analyticsSessionId ? { sessionId: input.analyticsSessionId } : {}),
      status: duel.status,
      tier: moneyToTier(duel.stake.amount, duel.stake.decimals),
    });
    return duel;
  }

  async listEvents(duelId: string): Promise<DuelEvent[]> {
    await this.findOne(duelId);
    return this.repository.listEvents(duelId);
  }

  async listTransactions(duelId: string): Promise<DuelTransactionRecord[]> {
    await this.findOne(duelId);
    return this.repository.listTransactions(duelId);
  }

  async getSocialCard(duelId: string): Promise<{
    duelId: string;
    imageUrl: string;
    pageUrl: string;
    shareText: string;
    status: Duel['status'];
  }> {
    const duel = await this.findOne(duelId);
    const appUrl = (process.env.OPENPACKSDUEL_APP_URL ?? 'http://localhost:3001').replace(
      /\/$/,
      '',
    );
    const encodedId = encodeURIComponent(duel.id);
    const socialStatus = toSocialStatus(duel.status);
    return {
      duelId: duel.id,
      imageUrl: `${appUrl}/duel/${encodedId}/social/${socialStatus}`,
      pageUrl: `${appUrl}/duel/${encodedId}`,
      shareText: `Watch my ${duel.pack.name} duel on OpenPacks Duel.`,
      status: duel.status,
    };
  }
}

function toSocialStatus(status: Duel['status']): string {
  if (status === 'committing') return 'matched';
  if (status === 'settling') return 'awaiting_assets';
  if (status === 'cancelling') return 'cancelled';
  if (status === 'refunding') return 'refunded';
  return status;
}

function validateCreation(input: CreateDuelRequest): void {
  if (input.matchmakingMode === 'direct' && !input.opponentWallet) {
    throw new BadRequestException('opponentWallet is required for direct matchmaking');
  }
  if (input.matchmakingMode !== 'direct' && input.opponentWallet) {
    throw new BadRequestException('opponentWallet is only accepted for direct matchmaking');
  }
  if (input.creatorWallet === input.opponentWallet) {
    throw new BadRequestException('A wallet cannot duel itself');
  }

  const expiresAt = new Date(input.expiresAt).getTime();
  const now = Date.now();
  if (expiresAt <= now) throw new BadRequestException('expiresAt must be in the future');
  if (expiresAt - now > MAX_DUEL_LIFETIME_MS) {
    throw new BadRequestException('expiresAt cannot be more than 24 hours in the future');
  }
}

function resolveProviderMode(): 'collector-crypt-sandbox' | 'mock' {
  const mode = process.env.OPENPACKSDUEL_PROVIDER_MODE ?? 'mock';
  if (mode === 'mock' || mode === 'collector-crypt-sandbox') return mode;
  throw new ConflictException(
    'OPENPACKSDUEL_PROVIDER_MODE must be mock or collector-crypt-sandbox',
  );
}

function resolveHouseWallet(): string {
  return process.env.OPENPACKSDUEL_HOUSE_DEVNET_WALLET ?? DEFAULT_HOUSE_DEVNET_WALLET;
}

function normalizeReason(reason?: string): string {
  const normalized = reason?.trim();
  return normalized ? `player:${normalized}` : 'player_cancelled';
}

function createDuelId(): string {
  return `duel_${crypto.randomUUID().replaceAll('-', '')}`;
}

function moneyToTier(amount: string, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}
