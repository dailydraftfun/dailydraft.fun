import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentDuelAuthentication, type DuelAuthentication } from '../auth/authentication.js';
import { DuelMutationGuard } from '../auth/duel-mutation.guard.js';
import { IdempotencyKey } from '../common/idempotency-key.decorator.js';
import { IntegrationKeyGuard } from '../common/integration-key.guard.js';
import type { DuelIdParams } from '../duels/duel.dto.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import { PrepareProviderEscrowRequest } from './provider-settlement.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { ProviderSettlementService } from './provider-settlement.service.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import {
  ReconciliationQuery,
  RecordSubmissionRequest,
  TransactionSubmissionParams,
} from './transaction-monitor.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { TransactionMonitorService } from './transaction-monitor.service.js';
import { WorkerKeyGuard } from './worker-key.guard.js';

@Controller('duels/:duelId/transactions')
export class TransactionSubmissionController {
  constructor(private readonly monitor: TransactionMonitorService) {}

  @Post(':transactionId/submissions')
  @HttpCode(202)
  @UseGuards(DuelMutationGuard)
  bindSubmission(
    @Param() params: TransactionSubmissionParams,
    @Body() input: RecordSubmissionRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.monitor.bindSubmission({
      ...(authentication.kind === 'wallet-session' ? { actorWallet: authentication.wallet } : {}),
      duelId: params.duelId,
      idempotencyKey,
      signature: input.signature,
      transactionId: params.transactionId,
    });
  }
}

@Controller('internal/reconciliation/solana')
@UseGuards(WorkerKeyGuard)
export class TransactionReconciliationController {
  constructor(private readonly monitor: TransactionMonitorService) {}

  @Get()
  reconcileFromCron(@Query() query: ReconciliationQuery) {
    return this.monitor.reconcile(query.limit);
  }

  @Post()
  @HttpCode(200)
  reconcileManually(@Query() query: ReconciliationQuery) {
    return this.monitor.reconcile(query.limit);
  }
}

@Controller('internal/provider/duels/:duelId/escrow/transactions')
@UseGuards(IntegrationKeyGuard)
export class ProviderSettlementController {
  constructor(private readonly settlement: ProviderSettlementService) {}

  @Post()
  @HttpCode(201)
  prepare(
    @Param() params: DuelIdParams,
    @Body() input: PrepareProviderEscrowRequest,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.settlement.prepare({ duelId: params.duelId, idempotencyKey, ...input });
  }
}
