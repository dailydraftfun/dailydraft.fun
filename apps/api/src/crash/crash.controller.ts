import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentDuelAuthentication, type DuelAuthentication } from '../auth/authentication.js';
import { WalletSessionGuard } from '../auth/wallet-session.guard.js';
import { IdempotencyKey } from '../common/idempotency-key.decorator.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import { CrashPlayerDecisionRequest, CrashRoundParams } from './crash-decision.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { CrashDecisionService } from './crash-decision.service.js';
import { CrashStateMachineError } from './crash-stage-state.js';

@Controller('crash/rounds')
@UseGuards(WalletSessionGuard)
export class CrashController {
  constructor(private readonly decisions: CrashDecisionService) {}

  @Get(':roundId')
  async currentStage(
    @Param() params: CrashRoundParams,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const current = await translateCrashErrors(() =>
      this.decisions.currentStage(params.roundId, requireWalletSession(authentication)),
    );
    setPrivateHeaders(response);
    return current;
  }

  @Post(':roundId/decisions')
  @HttpCode(200)
  async decide(
    @Param() params: CrashRoundParams,
    @Body() input: CrashPlayerDecisionRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @IdempotencyKey() idempotencyKey: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const current = await translateCrashErrors(() =>
      this.decisions.decide({
        action: input.action,
        expectedStage: input.expectedStage,
        expectedVersion: input.expectedVersion,
        idempotencyKey,
        playerWallet: requireWalletSession(authentication),
        roundId: params.roundId,
      }),
    );
    setPrivateHeaders(response);
    return current;
  }
}

function setPrivateHeaders(response: FastifyReply): void {
  response.header('cache-control', 'private, no-store');
  response.header('x-robots-tag', 'noindex, nofollow, noarchive');
}

function requireWalletSession(authentication: DuelAuthentication): string {
  if (authentication.kind !== 'wallet-session') {
    throw new NotFoundException('Crash round was not found');
  }
  return authentication.wallet;
}

async function translateCrashErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof CrashStateMachineError)) throw error;
    switch (error.code) {
      case 'NOT_FOUND':
        throw new NotFoundException(error.message);
      case 'DISABLED':
      case 'INVALID_EVIDENCE':
        throw new ServiceUnavailableException(error.message);
      case 'CONCURRENT_TRANSITION':
      case 'DEADLINE_EXPIRED':
      case 'IDEMPOTENCY_MISMATCH':
      case 'INVALID_TRANSITION':
        throw new ConflictException(error.message);
    }
  }
}
