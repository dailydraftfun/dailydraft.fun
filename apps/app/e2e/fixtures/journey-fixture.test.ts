import { describe, expect, test } from 'bun:test';

import { journeyTestIds } from '../../app/e2e/journey-test-ids';
import { parseProductCapabilities } from '../../app/solana/duel-client';
import { DuelJourneyFixture } from './journey-fixture';

describe('deterministic duel journey fixture', () => {
  test('replays the same wallet, RPC, duel, and provider contract for a seed', () => {
    const first = new DuelJourneyFixture('replay');
    const second = new DuelJourneyFixture('replay');

    expect(first.bootstrap()).toEqual(second.bootstrap());
    expect(first.handleRpc({ id: 1, jsonrpc: '2.0', method: 'getGenesisHash' })).toEqual(
      second.handleRpc({ id: 1, jsonrpc: '2.0', method: 'getGenesisHash' }),
    );
    const firstAuthorization = authenticate(first);
    const secondAuthorization = authenticate(second);

    const firstDuel = createDirectDuel(first, firstAuthorization);
    const secondDuel = createDirectDuel(second, secondAuthorization);
    expect(firstDuel).toEqual(secondDuel);

    const firstSettled = settle(first, firstDuel.id, firstAuthorization);
    const secondSettled = settle(second, secondDuel.id, secondAuthorization);
    expect(firstSettled).toEqual(secondSettled);
    expect(firstSettled.result?.outcomes.map((outcome) => outcome.provider)).toEqual([
      'journey-fixture',
      'journey-fixture',
    ]);
  });

  test('isolates mutable state between tests and resets to an empty lobby', () => {
    const first = new DuelJourneyFixture('isolation');
    const second = new DuelJourneyFixture('isolation');
    const authorization = authenticate(first);
    createDirectDuel(first, authorization);

    expect(first.snapshot().duel).not.toBeNull();
    expect(second.snapshot()).toEqual({
      authenticated: false,
      duel: null,
      requests: [],
      seed: 'isolation',
    });

    first.reset();
    expect(first.snapshot()).toEqual(second.snapshot());
  });

  test('keeps the deterministic capability response compatible with the product contract', () => {
    const fixture = new DuelJourneyFixture('capabilities');
    const response = fixture.handleApi({ method: 'GET', path: '/health/capabilities' });

    expect(response.status).toBe(200);
    expect(parseProductCapabilities(response.body)).toEqual(
      expect.objectContaining({
        modes: expect.objectContaining({
          direct: { enabled: true, reason: null },
          open: { enabled: true, reason: null },
        }),
        packs: expect.arrayContaining([
          expect.objectContaining({ enabled: true, id: 'pokemon_50', tier: 50 }),
        ]),
      }),
    );
  });

  test('fails incomplete and unsupported setup with targeted errors', () => {
    expect(() => new DuelJourneyFixture('INVALID SEED')).toThrow(
      'Journey fixture seed must use 1-32 lowercase letters, numbers, or hyphens.',
    );
    const fixture = new DuelJourneyFixture('errors');
    expect(() =>
      fixture.handleApi({ body: null, method: 'POST', path: '/auth/challenges' }),
    ).toThrow('Journey fixture wallet challenge body is incomplete.');
    const authorization = authenticate(fixture);
    expect(
      fixture.handleApi({
        authorization,
        method: 'POST',
        path: '/unimplemented',
      }),
    ).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          detail: 'Journey API fixture does not implement POST /unimplemented.',
        }),
        status: 501,
      }),
    );
  });

  test('keeps primary action and meaning-bearing result identifiers unique', () => {
    const identifiers = [
      journeyTestIds.battle,
      journeyTestIds.battleBack,
      journeyTestIds.duelHeadline,
      journeyTestIds.duelPhase,
      journeyTestIds.entryTier,
      journeyTestIds.error,
      journeyTestIds.lobby,
      ...Object.values(journeyTestIds.mode),
      journeyTestIds.opponentWallet,
      journeyTestIds.persistedDuel,
      journeyTestIds.persistedDuelCancel,
      journeyTestIds.persistedDuelContinue,
      journeyTestIds.persistedDuelCopy,
      journeyTestIds.persistedDuelFund,
      journeyTestIds.persistedDuelHouse,
      journeyTestIds.persistedDuelRestart,
      journeyTestIds.primaryAction,
      ...Object.values(journeyTestIds.pull),
      ...Object.values(journeyTestIds.pullName),
      ...Object.values(journeyTestIds.pullValue),
      ...Object.values(journeyTestIds.provider),
      journeyTestIds.resultMargin,
      journeyTestIds.resultRematch,
      journeyTestIds.resultShare,
      journeyTestIds.resultTotalValue,
      journeyTestIds.settlementReference,
      ...[25, 50, 100].map(journeyTestIds.tier),
      journeyTestIds.transactionCancel,
      journeyTestIds.transactionConfirm,
      journeyTestIds.transactionDialog,
      journeyTestIds.transactionFundingSide,
      journeyTestIds.transactionPurpose,
      journeyTestIds.transactionValue,
      journeyTestIds.transactionWallet,
      journeyTestIds.walletAuthenticationPrepare,
      journeyTestIds.walletAuthenticationSign,
      journeyTestIds.walletDialog,
      journeyTestIds.walletDisconnect,
      journeyTestIds.walletMenu,
      journeyTestIds.walletOption,
      ...Object.values(journeyTestIds.winner),
    ];

    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(identifiers.every((identifier) => /^journey-[a-z0-9-]+$/.test(identifier))).toBe(true);
  });
});

function authenticate(fixture: DuelJourneyFixture): string {
  const bootstrap = fixture.bootstrap();
  const challenge = fixture.handleApi({
    body: { wallet: bootstrap.wallet.address },
    method: 'POST',
    path: '/auth/challenges',
  }).body as { challengeId: string };
  const session = fixture.handleApi({
    body: {
      challengeId: challenge.challengeId,
      signature: 'fixture-signature',
      wallet: bootstrap.wallet.address,
    },
    method: 'POST',
    path: '/auth/sessions',
  });
  expect(session.status).toBe(200);
  return `Bearer ${(session.body as { token: string }).token}`;
}

function createDirectDuel(fixture: DuelJourneyFixture, authorization: string) {
  const response = fixture.handleApi({
    authorization,
    body: {
      creatorWallet: fixture.bootstrap().wallet.address,
      matchmakingMode: 'direct',
      opponentWallet: 'So11111111111111111111111111111111111111112',
    },
    method: 'POST',
    path: '/duels',
  });
  expect(response.status).toBe(200);
  return response.body as NonNullable<ReturnType<DuelJourneyFixture['snapshot']>['duel']>;
}

function settle(fixture: DuelJourneyFixture, duelId: string, authorization: string) {
  const response = fixture.handleApi({
    authorization,
    body: {},
    method: 'POST',
    path: `/duels/${duelId}/open-packs`,
  });
  expect(response.status).toBe(200);
  return response.body as NonNullable<ReturnType<DuelJourneyFixture['snapshot']>['duel']>;
}
