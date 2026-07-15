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
  findAll(@Query() query: ListDuelsQuery): Promise<Page<Duel>> {
    return this.duels.findAll(query);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(DuelMutationGuard)
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
  findOne(@Param() params: DuelIdParams): Promise<Duel> {
    return this.duels.findOne(params.duelId);
  }

  @Post(':duelId/join')
  @HttpCode(200)
  @UseGuards(DuelMutationGuard)
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
  @UseGuards(DuelMutationGuard)
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

  @Post(':duelId/open-packs')
  @HttpCode(200)
  @UseGuards(IntegrationKeyGuard)
  openPacks(
    @Param() params: DuelIdParams,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<Duel> {
    return this.opening.open(params.duelId, idempotencyKey);
  }
}

export function assertWalletActor(authentication: DuelAuthentication, claimedWallet: string): void {
  if (authentication.kind === 'wallet-session' && authentication.wallet !== claimedWallet) {
    throw new ForbiddenException('Wallet session cannot act for another wallet');
  }
}
