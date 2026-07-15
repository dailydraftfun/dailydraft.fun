import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

// biome-ignore lint/style/useImportType: Nest needs DTO constructors for runtime validation metadata.
import { CreateWalletChallengeRequest, CreateWalletSessionRequest } from './auth.dto.js';
import { CurrentDuelAuthentication, getBearerToken } from './authentication.js';
import type { WalletAuthentication } from './wallet-auth.service.js';
// biome-ignore lint/style/useImportType: Nest uses the service class as a runtime injection token.
import { WalletAuthService } from './wallet-auth.service.js';
import { WalletSessionGuard } from './wallet-session.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly walletAuth: WalletAuthService) {}

  @Post('challenges')
  @HttpCode(201)
  createChallenge(@Body() input: CreateWalletChallengeRequest) {
    return this.walletAuth.issueChallenge(input.wallet);
  }

  @Post('sessions')
  @HttpCode(201)
  createSession(@Body() input: CreateWalletSessionRequest) {
    return this.walletAuth.createSession(input);
  }

  @Get('session')
  @UseGuards(WalletSessionGuard)
  getSession(@CurrentDuelAuthentication() authentication: WalletAuthentication) {
    return { network: 'solana-devnet', wallet: authentication.wallet } as const;
  }

  @Post('session/revoke')
  @HttpCode(204)
  @UseGuards(WalletSessionGuard)
  async revokeSession(@Req() request: FastifyRequest): Promise<void> {
    await this.walletAuth.revoke(getBearerToken(request));
  }
}
