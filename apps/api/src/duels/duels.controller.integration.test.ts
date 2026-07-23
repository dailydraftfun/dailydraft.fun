import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { DuelMutationGuard } from '../auth/duel-mutation.guard.js';
import type { WalletAuthentication } from '../auth/wallet-auth.service.js';
import { WalletAuthService } from '../auth/wallet-auth.service.js';
import type { Duel } from '../domain.js';
import { RealValuePolicyGuard } from '../policy/real-value-policy.guard.js';
import { RealValuePolicyService } from '../policy/real-value-policy.service.js';
import { DuelFundingService } from '../transactions/duel-funding.service.js';
import { DuelOpeningService } from './duel-opening.service.js';
import { DuelsController } from './duels.controller.js';
import { DuelsService } from './duels.service.js';

const CREATOR_WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OPPONENT_WALLET = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const SPECTATOR_WALLET = '7YWHMfk9JZe0LMdzHpYvCWHrGkpmQXJVhqBYoZ9UwNKq';
const duel = {
  creatorWallet: CREATOR_WALLET,
  houseOpponent: false,
  id: 'duel_private',
  opponentWallet: OPPONENT_WALLET,
  status: 'settled',
} as Duel;

const authService = {
  authenticate: async (token?: string): Promise<WalletAuthentication> => {
    if (token === 'participant_session') {
      return {
        kind: 'wallet-session',
        sessionId: 'auths_participant',
        wallet: CREATOR_WALLET,
      };
    }
    if (token === 'spectator_session') {
      return {
        kind: 'wallet-session',
        sessionId: 'auths_spectator',
        wallet: SPECTATOR_WALLET,
      };
    }
    throw new UnauthorizedException('Missing or invalid wallet session');
  },
} as WalletAuthService;

const duelsService = {
  findOne: async (duelId: string) => {
    if (duelId !== duel.id) throw new Error('Unexpected duel id');
    return duel;
  },
} as DuelsService;

@Module({
  controllers: [DuelsController],
  providers: [
    DuelMutationGuard,
    RealValuePolicyGuard,
    { provide: WalletAuthService, useValue: authService },
    {
      provide: RealValuePolicyService,
      useValue: { assertAllowed: () => Promise.resolve({ allowed: true }) },
    },
    { provide: DuelsService, useValue: duelsService },
    { provide: DuelOpeningService, useValue: {} },
    { provide: DuelFundingService, useValue: {} },
  ],
})
class TestDuelsModule {}

describe('private duel HTTP authorization', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(TestDuelsModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  test.each([
    '/duels/duel_private',
    '/duels/duel_private/rematch-opponent',
  ])('rejects anonymous and spectator access to %s', async (url) => {
    const anonymous = await app.inject({ method: 'GET', url });
    const spectator = await app.inject({
      headers: { authorization: 'Bearer spectator_session' },
      method: 'GET',
      url,
    });

    expect(anonymous.statusCode).toBe(401);
    expect(spectator.statusCode).toBe(403);
  });

  test.each([
    '/duels/duel_private',
    '/duels/duel_private/rematch-opponent',
  ])('returns participant-only state with private headers from %s', async (url) => {
    const response = await app.inject({
      headers: { authorization: 'Bearer participant_session' },
      method: 'GET',
      url,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  });
});
