import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentDuelAuthentication, type DuelAuthentication } from '../auth/authentication.js';
import { DuelMutationGuard } from '../auth/duel-mutation.guard.js';
import { IdempotencyKey } from '../common/idempotency-key.decorator.js';
import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import type { Duel, Page } from '../domain.js';
import { RealValueAdmission, RealValuePolicyGuard } from '../policy/real-value-policy.guard.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DuelFundingService } from '../transactions/duel-funding.service.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import {
  CancelDuelRequest,
  CreateDuelRequest,
  DuelIdParams,
  JoinDuelRequest,
  ListDuelsQuery,
  PrepareTransactionRequest,
  WalletParams,
} from './duel.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DuelOpeningService } from './duel-opening.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DuelsService } from './duels.service.js';

@Controller('duels')
export class DuelsController {
  constructor(
    private readonly duels: DuelsService,
    private readonly opening: DuelOpeningService,
    private readonly funding: DuelFundingService,
  ) {}

  @Get()
  @UseGuards(IntegrationKeyGuard)
  findAll(@Query() query: ListDuelsQuery): Promise<Page<Duel>> {
    return this.duels.findAll(query);
  }

  @Post()
  @HttpCode(201)
  @RealValueAdmission('duel.create')
  @UseGuards(DuelMutationGuard, RealValuePolicyGuard)
  create(
    @Body() input: CreateDuelRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Duel> {
    assertWalletActor(authentication, input.creatorWallet);
    return this.duels.create(input, idempotencyKey).then((duel) => {
      response.header('location', `/v1/duels/${duel.id}`);
      return duel;
    });
  }

  @Get(':duelId')
  @UseGuards(DuelMutationGuard)
  async findOne(
    @Param() params: DuelIdParams,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Duel> {
    response.header('cache-control', 'private, no-store');
    response.header('x-robots-tag', 'noindex, nofollow, noarchive');
    const duel = await this.duels.findOne(params.duelId);
    assertDuelParticipant(authentication, duel);
    return duel;
  }

  @Post(':duelId/join')
  @HttpCode(200)
  @RealValueAdmission('duel.join')
  @UseGuards(DuelMutationGuard, RealValuePolicyGuard)
  join(
    @Param() params: DuelIdParams,
    @Body() input: JoinDuelRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<Duel> {
    assertWalletActor(authentication, input.wallet);
    return this.duels.join(params.duelId, input, idempotencyKey);
  }

  @Post(':duelId/cancel')
  @HttpCode(200)
  @UseGuards(DuelMutationGuard)
  cancel(
    @Param() params: DuelIdParams,
    @Body() input: CancelDuelRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<Duel> {
    assertWalletActor(authentication, input.wallet);
    return this.duels.cancel(params.duelId, input, idempotencyKey);
  }

  @Get(':duelId/events')
  @UseGuards(IntegrationKeyGuard)
  listEvents(@Param() params: DuelIdParams) {
    return this.duels.listEvents(params.duelId);
  }

  @Get(':duelId/transactions')
  @UseGuards(IntegrationKeyGuard)
  listTransactions(@Param() params: DuelIdParams) {
    return this.duels.listTransactions(params.duelId);
  }

  @Post(':duelId/transactions')
  @HttpCode(201)
  @RealValueAdmission('duel.funding.prepare')
  @UseGuards(DuelMutationGuard, RealValuePolicyGuard)
  prepareTransaction(
    @Param() params: DuelIdParams,
    @Body() input: PrepareTransactionRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    assertWalletActor(authentication, input.wallet);
    return this.funding.prepare({
      duelId: params.duelId,
      idempotencyKey,
      wallet: input.wallet,
    });
  }

  @Get(':duelId/social-card')
  getSocialCard(@Param() params: DuelIdParams) {
    return this.duels.getSocialCard(params.duelId);
  }

  @Get(':duelId/rematch-opponent')
  @UseGuards(DuelMutationGuard)
  async getRematchOpponent(
    @Param() params: DuelIdParams,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header('cache-control', 'private, no-store');
    response.header('x-robots-tag', 'noindex, nofollow, noarchive');
    const duel = await this.duels.findOne(params.duelId);
    return resolvePrivateRematchOpponent(authentication, duel);
  }

  @Get(':duelId/receipt')
  getReceipt(@Param() params: DuelIdParams, @Res({ passthrough: true }) response: FastifyReply) {
    response.header('content-disposition', `attachment; filename="${params.duelId}.receipt.json"`);
    response.header('cache-control', 'private, no-store');
    response.header('x-robots-tag', 'noindex, nofollow, noarchive');
    return this.duels.getPublicReceipt(params.duelId);
  }

  @Post(':duelId/open-packs')
  @HttpCode(200)
  @RealValueAdmission('duel.pack.open')
  @UseGuards(DuelMutationGuard, RealValuePolicyGuard)
  async openPacks(
    @Param() params: DuelIdParams,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<Duel> {
    const duel = await this.duels.findOne(params.duelId);
    assertDuelParticipant(authentication, duel);
    return this.opening.open(params.duelId, idempotencyKey);
  }
}

@Controller('profiles')
export class DuelProfilesController {
  constructor(private readonly duels: DuelsService) {}

  @Get(':wallet')
  getProfile(@Param() params: WalletParams, @Res({ passthrough: true }) response: FastifyReply) {
    response.header('cache-control', 'private, no-store');
    response.header('x-robots-tag', 'noindex, nofollow, noarchive');
    return this.duels.getPublicProfile(params.wallet);
  }
}

@Controller('leaderboard')
export class DuelLeaderboardController {
  constructor(private readonly duels: DuelsService) {}

  @Get()
  async getLeaderboard(@Res({ passthrough: true }) response: FastifyReply) {
    const snapshot = await this.duels.getPublicLeaderboard();
    response.header('cache-control', 'public, max-age=30, stale-while-revalidate=120');
    response.header('x-robots-tag', 'noindex, nofollow, noarchive');
    return snapshot;
  }
}

export function assertWalletActor(authentication: DuelAuthentication, claimedWallet: string): void {
  if (authentication.kind === 'wallet-session' && authentication.wallet !== claimedWallet) {
    throw new ForbiddenException('Wallet session cannot act for another wallet');
  }
}

export function assertDuelParticipant(authentication: DuelAuthentication, duel: Duel): void {
  if (
    authentication.kind === 'wallet-session' &&
    ![duel.creatorWallet, duel.opponentWallet].includes(authentication.wallet)
  ) {
    throw new ForbiddenException('Wallet session is not a participant in this duel');
  }
}

export function resolvePrivateRematchOpponent(
  authentication: DuelAuthentication,
  duel: Pick<Duel, 'creatorWallet' | 'houseOpponent' | 'opponentWallet' | 'status'>,
): { side: 'creator' | 'opponent'; wallet: string } {
  if (
    authentication.kind !== 'wallet-session' ||
    duel.status !== 'settled' ||
    duel.houseOpponent ||
    !duel.opponentWallet
  ) {
    throw new ForbiddenException('Private rematch is unavailable for this wallet');
  }
  if (authentication.wallet === duel.creatorWallet) {
    return { side: 'opponent', wallet: duel.opponentWallet };
  }
  if (authentication.wallet === duel.opponentWallet) {
    return { side: 'creator', wallet: duel.creatorWallet };
  }
  throw new ForbiddenException('Private rematch is unavailable for this wallet');
}
