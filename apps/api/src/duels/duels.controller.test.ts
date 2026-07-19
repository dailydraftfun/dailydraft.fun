import { describe, expect, test } from 'bun:test';
import type { FastifyReply } from 'fastify';

import type { Duel } from '../domain.js';
import type { DuelFundingService } from '../transactions/duel-funding.service.js';
import type { DuelOpeningService } from './duel-opening.service.js';
import {
  assertDuelParticipant,
  assertWalletActor,
  DuelsController,
  resolvePrivateRematchOpponent,
} from './duels.controller.js';
import type { DuelsService } from './duels.service.js';

const WALLET = '9xQeWvG816bUx9EPfEZvD6nGQ3xM4wzHY6zvQ3z9gJ1';
const OTHER_WALLET = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const SPECTATOR_WALLET = '7YWHMfk9JZe0LMdzHpYvCWHrGkpmQXJVhqBYoZ9UwNKq';

describe('duel mutation wallet binding', () => {
  test('allows a wallet session to act for its own address', () => {
    expect(() =>
      assertWalletActor(
        { kind: 'wallet-session', sessionId: 'auths_test', wallet: WALLET },
        WALLET,
      ),
    ).not.toThrow();
  });

  test('rejects a wallet session claiming another address', () => {
    expect(() =>
      assertWalletActor(
        { kind: 'wallet-session', sessionId: 'auths_test', wallet: WALLET },
        OTHER_WALLET,
      ),
    ).toThrow('cannot act for another wallet');
  });

  test('keeps server integration credentials authorized for orchestration', () => {
    expect(() => assertWalletActor({ kind: 'integration' }, OTHER_WALLET)).not.toThrow();
  });

  test('keeps raw duel state participant-only while allowing server orchestration', () => {
    const duel = {
      creatorWallet: WALLET,
      opponentWallet: OTHER_WALLET,
    } as Duel;

    expect(() =>
      assertDuelParticipant(
        { kind: 'wallet-session', sessionId: 'auths_creator', wallet: WALLET },
        duel,
      ),
    ).not.toThrow();
    expect(() =>
      assertDuelParticipant(
        { kind: 'wallet-session', sessionId: 'auths_spectator', wallet: SPECTATOR_WALLET },
        duel,
      ),
    ).toThrow('not a participant');
    expect(() => assertDuelParticipant({ kind: 'integration' }, duel)).not.toThrow();
  });
});

describe('private rematch opponent resolution', () => {
  const settledDuel = {
    creatorWallet: WALLET,
    houseOpponent: false,
    opponentWallet: OTHER_WALLET,
    status: 'settled',
  } as const;

  test('returns only the other participant wallet and side', () => {
    expect(
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_creator', wallet: WALLET },
        settledDuel,
      ),
    ).toEqual({ side: 'opponent', wallet: OTHER_WALLET });
    expect(
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_opponent', wallet: OTHER_WALLET },
        settledDuel,
      ),
    ).toEqual({ side: 'creator', wallet: WALLET });
  });

  test('reveals no participant wallet to spectators or invalid rematches', () => {
    expect(() =>
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_spectator', wallet: SPECTATOR_WALLET },
        settledDuel,
      ),
    ).toThrow('Private rematch is unavailable');
    expect(() =>
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_creator', wallet: WALLET },
        { ...settledDuel, status: 'opening' },
      ),
    ).toThrow('Private rematch is unavailable');
    expect(() =>
      resolvePrivateRematchOpponent(
        { kind: 'wallet-session', sessionId: 'auths_creator', wallet: WALLET },
        { ...settledDuel, houseOpponent: true },
      ),
    ).toThrow('Private rematch is unavailable');
  });

  test('wires the authenticated endpoint with private response headers', async () => {
    const requestedDuelIds: string[] = [];
    const service = {
      findOne: async (duelId: string) => {
        requestedDuelIds.push(duelId);
        return settledDuel as unknown as Duel;
      },
    } as unknown as DuelsService;
    const controller = new DuelsController(
      service,
      {} as DuelOpeningService,
      {} as DuelFundingService,
    );
    const headers = new Map<string, string>();
    const response = {
      header: (name: string, value: string) => {
        headers.set(name, value);
        return response;
      },
    } as unknown as FastifyReply;

    await expect(
      controller.getRematchOpponent(
        { duelId: 'duel_private' },
        { kind: 'wallet-session', sessionId: 'auths_creator', wallet: WALLET },
        response,
      ),
    ).resolves.toEqual({ side: 'opponent', wallet: OTHER_WALLET });
    expect(requestedDuelIds).toEqual(['duel_private']);
    expect(Object.fromEntries(headers)).toEqual({
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    });
  });

  test('keeps raw duel lookup authenticated and non-cacheable', async () => {
    const service = {
      findOne: async () => settledDuel as unknown as Duel,
    } as unknown as DuelsService;
    const controller = new DuelsController(
      service,
      {} as DuelOpeningService,
      {} as DuelFundingService,
    );
    const headers = new Map<string, string>();
    const response = {
      header: (name: string, value: string) => {
        headers.set(name, value);
        return response;
      },
    } as unknown as FastifyReply;

    await expect(
      controller.findOne(
        { duelId: 'duel_private' },
        { kind: 'wallet-session', sessionId: 'auths_creator', wallet: WALLET },
        response,
      ),
    ).resolves.toMatchObject(settledDuel);
    expect(Object.fromEntries(headers)).toEqual({
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    });
  });
});
