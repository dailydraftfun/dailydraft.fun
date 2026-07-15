import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotImplementedException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { IdempotencyKey } from '../common/idempotency-key.decorator.js';
import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import type { Duel, Page } from '../domain.js';
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
  ) {}

  @Get()
  findAll(@Query() query: ListDuelsQuery): Promise<Page<Duel>> {
    return this.duels.findAll(query);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(IntegrationKeyGuard)
  create(
    @Body() input: CreateDuelRequest,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<Duel> {
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
  @UseGuards(IntegrationKeyGuard)
  join(
    @Param() params: DuelIdParams,
    @Body() input: JoinDuelRequest,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<Duel> {
    return this.duels.join(params.duelId, input, idempotencyKey);
  }

  @Post(':duelId/cancel')
  @HttpCode(200)
  @UseGuards(IntegrationKeyGuard)
  cancel(
    @Param() params: DuelIdParams,
    @Body() input: CancelDuelRequest,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<Duel> {
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
  @UseGuards(IntegrationKeyGuard)
  async prepareTransaction(
    @Param() params: DuelIdParams,
    @Body() _input: PrepareTransactionRequest,
    @IdempotencyKey() _idempotencyKey: string,
  ): Promise<never> {
    await this.duels.findOne(params.duelId);
    throw new NotImplementedException(
      'Transaction preparation is disabled until the Solana escrow integration is live',
    );
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
