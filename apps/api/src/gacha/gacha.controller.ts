import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  assertWalletActor,
  CurrentDuelAuthentication,
  type DuelAuthentication,
} from '../auth/authentication.js';
import { WalletSessionGuard } from '../auth/wallet-session.guard.js';
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
import { GachaPaymentService } from './gacha-payment.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { GachaRipService } from './gacha-rip.service.js';

@Controller('gacha')
export class GachaController {
  constructor(
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
    return this.rips.findCommittedInventory(params.machineKey);
  }

  @Get('machines/:machineKey/odds')
  @Header('cache-control', 'no-store')
  findOdds(@Param() params: GachaMachineParams) {
    return this.rips.findCommittedOdds(params.machineKey);
  }

  // A seed commitment is the house's half of the commit-reveal pair and names no
  // wallet, so a session is all this route can bind to. The guard still matters:
  // without it the commitment pool is an unauthenticated write.
  @Post('machines/:machineKey/rip-commitments')
  @UseGuards(WalletSessionGuard)
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  createSeedCommitment(@Param() params: GachaMachineParams) {
    return this.rips.createSeedCommitment(params.machineKey);
  }

  @Post('machines/:machineKey/payment-intents')
  @UseGuards(WalletSessionGuard)
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  // `async` on a handler that only awaits nothing looks redundant, but it makes
  // an authorisation failure a rejected promise rather than a synchronous throw,
  // matching the intent-scoped routes below.
  async createPaymentIntent(
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @Param() params: GachaMachineParams,
    @Body() input: CreateGachaPaymentIntentRequest,
  ) {
    assertGachaWalletActor(authentication, input.payerWallet);
    return this.payments.createIntent({
      machineKey: params.machineKey,
      payerWallet: input.payerWallet,
    });
  }

  // Preparation is a POST despite reading like a fetch: each call burns a fresh
  // blockhash and can expire the intent as a side effect, neither of which a
  // cacheable GET should do.
  @Post('payment-intents/:intentId/transaction')
  @UseGuards(WalletSessionGuard)
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  async prepareTransaction(
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @Param() params: GachaPaymentIntentParams,
  ) {
    await this.assertIntentPayer(authentication, params.intentId);
    return this.payments.prepareTransaction(params.intentId);
  }

  @Post('payment-intents/:intentId/signature')
  @UseGuards(WalletSessionGuard)
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async claimPaymentSignature(
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @Param() params: GachaPaymentIntentParams,
    @Body() input: ClaimGachaPaymentSignatureRequest,
  ) {
    await this.assertIntentPayer(authentication, params.intentId);
    return this.payments.claimSignature({
      intentId: params.intentId,
      signedTransactionBase64: input.signedTransactionBase64,
    });
  }

  @Post('payment-intents/:intentId/verify')
  @UseGuards(WalletSessionGuard)
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async verifyPaymentIntent(
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @Param() params: GachaPaymentIntentParams,
    @Body() input: VerifyGachaPaymentRequest,
  ) {
    await this.assertIntentPayer(authentication, params.intentId);
    return this.payments.verifyIntent({
      intentId: params.intentId,
      signature: input.signature,
    });
  }

  @Post('rips')
  @UseGuards(WalletSessionGuard)
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  // `async` for the same reason as `createPaymentIntent`: a refused rip should
  // reject, not throw before the promise exists.
  async createFixtureRip(
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
    @Body() input: CreateFixtureGachaRipRequest,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ) {
    assertGachaWalletActor(authentication, input.recipientWallet);
    const idempotencyKey = idempotencyKeyHeader ?? input.idempotencyKey;
    return this.rips.createFixtureRip({
      ...input,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
  }

  /**
   * Bind an intent-scoped route to the wallet the intent was opened for.
   *
   * The intent id travels on-chain as the transfer memo, so possession of it
   * proves nothing. Each of these routes advances or consumes the payer's
   * lifecycle — preparing burns a blockhash and can expire the intent — so the
   * caller has to be the payer, not merely someone who watched the cluster.
   */
  private async assertIntentPayer(
    authentication: DuelAuthentication,
    intentId: string,
  ): Promise<void> {
    assertGachaWalletActor(authentication, await this.payments.findIntentPayerWallet(intentId));
  }
}

function assertGachaWalletActor(authentication: DuelAuthentication, claimedWallet: string): void {
  if (authentication.kind !== 'wallet-session') {
    throw new ForbiddenException('Gacha routes require a wallet session');
  }
  assertWalletActor(authentication, claimedWallet);
}
