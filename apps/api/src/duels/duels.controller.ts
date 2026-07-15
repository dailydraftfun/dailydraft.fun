import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotImplementedException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { IdempotencyKeyPipe } from '../common/idempotency-key.pipe.js';
import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import type { Duel, Page } from '../domain.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import {
  CreateDuelRequest,
  DuelIdParams,
  ListDuelsQuery,
  PrepareTransactionRequest,
} from './duel.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { DuelsService } from './duels.service.js';

@Controller('duels')
export class DuelsController {
  constructor(private readonly duels: DuelsService) {}

  @Get()
  findAll(@Query() query: ListDuelsQuery): Page<Duel> {
    return this.duels.findAll(query);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(IntegrationKeyGuard)
  create(
    @Body() input: CreateDuelRequest,
    @Headers('idempotency-key', IdempotencyKeyPipe) idempotencyKey: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Duel {
    const duel = this.duels.create(input, idempotencyKey);
    response.header('location', `/v1/duels/${duel.id}`);
    return duel;
  }

  @Get(':duelId')
  findOne(@Param() params: DuelIdParams): Duel {
    return this.duels.findOne(params.duelId);
  }

  @Post(':duelId/transactions')
  @UseGuards(IntegrationKeyGuard)
  prepareTransaction(
    @Param() params: DuelIdParams,
    @Body() _input: PrepareTransactionRequest,
    @Headers('idempotency-key', IdempotencyKeyPipe) _idempotencyKey: string,
  ): never {
    this.duels.findOne(params.duelId);
    throw new NotImplementedException(
      'Transaction preparation is disabled until the Solana escrow integration is live',
    );
  }

  @Get(':duelId/social-card')
  getSocialCard(@Param() params: DuelIdParams) {
    return this.duels.getSocialCard(params.duelId);
  }
}
