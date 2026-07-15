import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

import { CurrentDuelAuthentication, type DuelAuthentication } from '../auth/authentication.js';
import { DuelMutationGuard } from '../auth/duel-mutation.guard.js';
import { assertWalletActor } from '../duels/duels.controller.js';
// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import { MatchmakingRequest, MatchmakingWalletRequest } from './matchmaking.dto.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { MatchmakingService } from './matchmaking.service.js';

@Controller('matchmaking')
@UseGuards(DuelMutationGuard)
export class MatchmakingController {
  constructor(private readonly matchmaking: MatchmakingService) {}

  @Post('search')
  @HttpCode(200)
  search(
    @Body() input: MatchmakingRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
  ) {
    assertWalletActor(authentication, input.wallet);
    return this.matchmaking.search(input);
  }

  @Post('continue')
  @HttpCode(200)
  continueSearch(
    @Body() input: MatchmakingRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
  ) {
    assertWalletActor(authentication, input.wallet);
    return this.matchmaking.search(input);
  }

  @Post('status')
  @HttpCode(200)
  status(
    @Body() input: MatchmakingWalletRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
  ) {
    assertWalletActor(authentication, input.wallet);
    return this.matchmaking.status(input.wallet);
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(
    @Body() input: MatchmakingWalletRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
  ) {
    assertWalletActor(authentication, input.wallet);
    return this.matchmaking.cancel(input.wallet);
  }

  @Post('house-fallback')
  @HttpCode(200)
  houseFallback(
    @Body() input: MatchmakingWalletRequest,
    @CurrentDuelAuthentication() authentication: DuelAuthentication,
  ) {
    assertWalletActor(authentication, input.wallet);
    return this.matchmaking.houseFallback(input.wallet);
  }
}
