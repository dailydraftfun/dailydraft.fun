import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post } from '@nestjs/common';

// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import {
  ClaimGachaPaymentSignatureRequest,
  CreateFixtureGachaRipRequest,
  CreateGachaPaymentIntentRequest,
  GachaMachineParams,
  GachaPaymentIntentParams,
  VerifyGachaPaymentRequest,
} from './gacha.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GachaInventorySnapshotService } from './gacha-inventory-snapshot.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GachaPaymentService } from './gacha-payment.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GachaRipService } from './gacha-rip.service.js';

@Controller('gacha')
export class GachaController {
  constructor(
    private readonly snapshots: GachaInventorySnapshotService,
    private readonly rips: GachaRipService,
    private readonly payments: GachaPaymentService,
  ) {}

  @Get('capability')
  @Header('cache-control', 'no-store')
  capability() {
    return this.rips.capability();
  }

  @Get('machines/:machineKey/inventory')
  @Header('cache-control', 'no-store')
  findInventory(@Param() params: GachaMachineParams) {
    return this.snapshots.findLatestSealed(params.machineKey);
  }

  @Get('machines/:machineKey/odds')
  @Header('cache-control', 'no-store')
  findOdds(@Param() params: GachaMachineParams) {
    return this.rips.findCommittedOdds(params.machineKey);
  }

  @Post('machines/:machineKey/rip-commitments')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  createSeedCommitment(@Param() params: GachaMachineParams) {
    return this.rips.createSeedCommitment(params.machineKey);
  }

  @Post('machines/:machineKey/payment-intents')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  createPaymentIntent(
    @Param() params: GachaMachineParams,
    @Body() input: CreateGachaPaymentIntentRequest,
  ) {
    return this.payments.createIntent({
      machineKey: params.machineKey,
      payerWallet: input.payerWallet,
    });
  }

  // Preparation is a POST despite reading like a fetch: each call burns a fresh
  // blockhash and can expire the intent as a side effect, neither of which a
  // cacheable GET should do.
  @Post('payment-intents/:intentId/transaction')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  prepareTransaction(@Param() params: GachaPaymentIntentParams) {
    return this.payments.prepareTransaction(params.intentId);
  }

  @Post('payment-intents/:intentId/signature')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  claimPaymentSignature(
    @Param() params: GachaPaymentIntentParams,
    @Body() input: ClaimGachaPaymentSignatureRequest,
  ) {
    return this.payments.claimSignature({
      intentId: params.intentId,
      signature: input.signature,
    });
  }

  @Post('payment-intents/:intentId/verify')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  verifyPaymentIntent(
    @Param() params: GachaPaymentIntentParams,
    @Body() input: VerifyGachaPaymentRequest,
  ) {
    return this.payments.verifyIntent({
      intentId: params.intentId,
      signature: input.signature,
    });
  }

  @Post('rips')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  createFixtureRip(
    @Body() input: CreateFixtureGachaRipRequest,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ) {
    const idempotencyKey = idempotencyKeyHeader ?? input.idempotencyKey;
    return this.rips.createFixtureRip({
      ...input,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
  }
}
