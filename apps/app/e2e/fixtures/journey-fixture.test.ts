import { describe, expect, test } from 'bun:test';

import { journeyTestIds } from '../../app/e2e/journey-test-ids';
import { parseProductCapabilities } from '../../app/solana/duel-client';
import { parseGameCatalog } from '../../app/games/games-client';
import { DuelJourneyFixture, journeyGameCatalog, journeyOpponentWallet } from './journey-fixture';

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

  test('serves the complete canonical Games hub catalog', () => {
    const fixture = new DuelJourneyFixture('games-hub');
    const response = fixture.handleApi({ method: 'GET', path: '/games/catalog' });

    expect(response.status).toBe(200);
    expect(parseGameCatalog(response.body)).toEqual(journeyGameCatalog());
    expect(journeyGameCatalog().modes.map((mode) => mode.id)).toEqual([
      'duel',
      'gacha',
      'flip',
      'crash',
    ]);
  });

  test('validates the seeded wallet session used by refresh journeys', () => {
    const fixture = new DuelJourneyFixture('session-validation');
    const authorization = authenticate(fixture);

    expect(
      fixture.handleApi({
        authorization,
        method: 'GET',
        path: '/auth/session',
      }),
    ).toEqual({
      body: {
        network: 'solana-devnet',
        wallet: fixture.bootstrap().wallet.address,
      },
      status: 200,
    });
    expect(
      fixture.handleApi({
        authorization: 'Bearer invalid-session',
        method: 'GET',
        path: '/auth/session',
      }).status,
    ).toBe(401);
  });

  test('serves pseudonymous settled activity without exposing fixture wallets', () => {
    const fixture = new DuelJourneyFixture('verified-activity');
    const response = fixture.handleApi({ method: 'GET', path: '/games/activity?limit=4' });
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [
        {
          mode: 'duel',
          participants: [
            { label: 'Player 7K2M', role: 'player' },
            { label: 'Player P4Q9', role: 'player' },
          ],
          result: 'winner-verified',
          verification: 'settled-rgs-proof',
        },
      ],
      schemaVersion: 'dailydraft.verified-game-activity.v1',
    });
    expect(serialized).not.toContain('11111111111111111111111111111111');
    expect(serialized).not.toContain(journeyOpponentWallet);
  });

  test('keeps preflight reconciliation matched until a funding submission exists', () => {
    const fixture = new DuelJourneyFixture('funding-boundary');
    const authorization = authenticate(fixture);
    const duel = createDirectDuel(fixture, authorization);

    const preflight = fixture.handleApi({
      authorization,
      body: {},
      method: 'POST',
      path: `/duels/${duel.id}/transactions/reconciliation`,
    });
    expect(preflight.body).toEqual(
      expect.objectContaining({
        duelStatus: 'matched',
        reconciliation: expect.objectContaining({ checked: 0, finalized: 0 }),
      }),
    );
    expect(fixture.snapshot().duel?.status).toBe('matched');

    const intent = fixture.handleApi({
      authorization,
      body: { action: 'fund', wallet: fixture.bootstrap().wallet.address },
      method: 'POST',
      path: `/duels/${duel.id}/transactions`,
    }).body as { id: string };
    expect(
      fixture.handleApi({
        authorization,
        body: { signature: 'fixture-signature' },
        method: 'POST',
        path: `/duels/${duel.id}/transactions/${intent.id}/submissions`,
      }).status,
    ).toBe(200);

    const funded = fixture.handleApi({
      authorization,
      body: {},
      method: 'POST',
      path: `/duels/${duel.id}/transactions/reconciliation`,
    });
    expect(funded.body).toEqual(
      expect.objectContaining({
        duelStatus: 'funded',
        reconciliation: expect.objectContaining({ checked: 1, finalized: 1 }),
      }),
    );
    expect(fixture.snapshot().duel?.status).toBe('funded');

    settle(fixture, duel.id, authorization);
    const postSettlement = fixture.handleApi({
      authorization,
      body: {},
      method: 'POST',
      path: `/duels/${duel.id}/transactions/reconciliation`,
    });
    expect(postSettlement.body).toEqual(
      expect.objectContaining({
        duelStatus: 'settled',
        reconciliation: expect.objectContaining({ checked: 1, finalized: 1 }),
      }),
    );
    expect(fixture.snapshot().duel?.status).toBe('settled');
  });

  test('fails RPC confirmation transiently without duplicating a submitted payment', () => {
    const fixture = new DuelJourneyFixture('rpc-ambiguity');
    const authorization = authenticate(fixture);
    const duel = createDirectDuel(fixture, authorization);
    submitFunding(fixture, duel.id, authorization);
    fixture.failNextReconciliations();

    const unavailable = fixture.handleApi({
      authorization,
      body: {},
      method: 'POST',
      path: `/duels/${duel.id}/transactions/reconciliation`,
    });
    expect(unavailable).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({ status: 503 }),
        status: 503,
      }),
    );
    expect(fixture.snapshot().duel?.status).toBe('committing');

    const recovered = fixture.handleApi({
      authorization,
      body: {},
      method: 'POST',
      path: `/duels/${duel.id}/transactions/reconciliation`,
    });
    expect(recovered.body).toEqual(
      expect.objectContaining({
        duelStatus: 'funded',
        reconciliation: expect.objectContaining({ finalized: 1 }),
      }),
    );
    expect(
      fixture.snapshot().requests.filter((request) => request.endsWith('/submissions')),
    ).toHaveLength(1);
  });

  test('abandons a rejected intent before preparing a distinct replacement', () => {
    const fixture = new DuelJourneyFixture('wallet-rejection');
    const authorization = authenticate(fixture);
    const duel = createDirectDuel(fixture, authorization);
    const firstIntent = fixture.handleApi({
      authorization,
      body: { action: 'fund', wallet: fixture.bootstrap().wallet.address },
      method: 'POST',
      path: `/duels/${duel.id}/transactions`,
    }).body as { id: string };

    expect(
      fixture.handleApi({
        authorization,
        body: {},
        method: 'POST',
        path: `/duels/${duel.id}/transactions/${firstIntent.id}/rejections`,
      }).status,
    ).toBe(200);
    fixture.handleApi({
      authorization,
      body: {},
      method: 'POST',
      path: `/duels/${duel.id}/transactions/reconciliation`,
    });
    const replacement = fixture.handleApi({
      authorization,
      body: { action: 'fund', wallet: fixture.bootstrap().wallet.address },
      method: 'POST',
      path: `/duels/${duel.id}/transactions`,
    }).body as { id: string };

    expect(replacement.id).not.toBe(firstIntent.id);
    expect(fixture.snapshot().duel?.status).toBe('matched');
    expect(requestsEndingWith(fixture.snapshot().requests, '/submissions')).toHaveLength(0);
  });

  test('holds and completes one public matchmaking search without creating payment', () => {
    const fixture = new DuelJourneyFixture('matching-reload');
    const authorization = authenticate(fixture);
    fixture.holdMatchmaking();

    const searching = fixture.handleApi({
      authorization,
      body: { packId: 'pokemon_50', wallet: fixture.bootstrap().wallet.address },
      method: 'POST',
      path: '/matchmaking/search',
    });
    const duelId = (searching.body as { duelId: string }).duelId;
    expect(searching.body).toEqual(
      expect.objectContaining({ opponentWallet: null, state: 'searching' }),
    );
    expect(fixture.snapshot().duel).toEqual(
      expect.objectContaining({ id: duelId, opponentWallet: null, status: 'waiting' }),
    );

    const restored = fixture.handleApi({
      authorization,
      body: { wallet: fixture.bootstrap().wallet.address },
      method: 'POST',
      path: '/matchmaking/status',
    });
    expect(restored.body).toEqual(expect.objectContaining({ duelId, state: 'searching' }));

    fixture.completeMatchmaking();
    const matched = fixture.handleApi({
      authorization,
      body: { packId: 'pokemon_50', wallet: fixture.bootstrap().wallet.address },
      method: 'POST',
      path: '/matchmaking/continue',
    });
    expect(matched.body).toEqual(expect.objectContaining({ duelId, state: 'matched' }));
    expect(fixture.snapshot().duel).toEqual(
      expect.objectContaining({ id: duelId, status: 'matched' }),
    );
    expect(requestsEndingWith(fixture.snapshot().requests, '/matchmaking/search')).toHaveLength(1);
    expect(requestsEndingWith(fixture.snapshot().requests, '/submissions')).toHaveLength(0);
  });

  test('holds lifecycle reload checkpoints without duplicating or mutating outcomes', () => {
    for (const checkpoint of ['opening', 'settling'] as const) {
      const fixture = new DuelJourneyFixture(`reload-${checkpoint}`);
      const authorization = authenticate(fixture);
      const duel = createDirectDuel(fixture, authorization);
      submitFunding(fixture, duel.id, authorization);
      fixture.handleApi({
        authorization,
        body: {},
        method: 'POST',
        path: `/duels/${duel.id}/transactions/reconciliation`,
      });
      fixture.holdLifecycleAt(checkpoint);

      const staged = settle(fixture, duel.id, authorization);
      const committedHash = staged.result?.resultHash;
      expect(staged.status).toBe(checkpoint);
      if (checkpoint === 'opening') {
        expect(staged.result).toBeNull();
      } else {
        expect(committedHash).toBeTruthy();
      }

      fixture.releaseLifecycle();
      const settledHash = fixture.snapshot().duel?.result?.resultHash;
      expect(settledHash).toBeTruthy();
      if (committedHash) expect(settledHash).toBe(committedHash);
      expect(fixture.snapshot().duel).toEqual(
        expect.objectContaining({
          result: expect.objectContaining({ resultHash: settledHash }),
          status: 'settled',
        }),
      );
      expect(
        fixture.snapshot().requests.filter((request) => request.endsWith('/open-packs')),
      ).toHaveLength(1);
    }
  });

  test('covers the deterministic House terminal and fail-closed journey matrix', () => {
    for (const winner of ['player', 'house'] as const) {
      const fixture = new DuelJourneyFixture(`house-${winner}`, {
        houseEnabled: true,
        houseWinner: winner,
      });
      const authorization = authenticate(fixture);
      const duel = createHouseDuel(fixture, authorization);
      submitFunding(fixture, duel.id, authorization);
      reconcileFunding(fixture, duel.id, authorization);
      const terminal = settle(fixture, duel.id, authorization);

      expect(terminal).toEqual(
        expect.objectContaining({
          houseOpponent: true,
          matchmakingMode: 'house',
          result: expect.objectContaining({
            comparisonMetric: 'insured-value',
            winnerSide: winner === 'player' ? 'creator' : 'opponent',
          }),
          status: 'settled',
        }),
      );
      expect(requestsEndingWith(fixture.snapshot().requests, '/submissions')).toHaveLength(1);
    }

    const rejected = new DuelJourneyFixture('house-limit', { houseEnabled: true });
    rejected.disableHouseAdmission('House tier is disabled: minimum liquidity');
    const capability = rejected.handleApi({ method: 'GET', path: '/health/capabilities' });
    expect(capability.body).toMatchObject({
      modes: {
        house: {
          enabled: false,
          reason: 'House tier is disabled: minimum liquidity',
        },
      },
    });
    expect(requestsEndingWith(rejected.snapshot().requests, '/transactions')).toHaveLength(0);
    expect(requestsEndingWith(rejected.snapshot().requests, '/submissions')).toHaveLength(0);

    const paused = fundedHouseFixture('house-pause');
    paused.fixture.disableHouseAdmission('New duel exposure is paused by an operator');
    expect(
      (
        paused.fixture.handleApi({ method: 'GET', path: '/health/capabilities' }).body as {
          modes: { house: { enabled: boolean } };
        }
      ).modes.house.enabled,
    ).toBe(false);
    expect(settle(paused.fixture, paused.duelId, paused.authorization).status).toBe('settled');
    expect(requestsEndingWith(paused.fixture.snapshot().requests, '/submissions')).toHaveLength(1);

    const refunded = fundedHouseFixture('house-refund');
    refunded.fixture.refundHouseOnOpen();
    expect(settle(refunded.fixture, refunded.duelId, refunded.authorization).status).toBe(
      'refunded',
    );
    expect(settle(refunded.fixture, refunded.duelId, refunded.authorization).status).toBe(
      'refunded',
    );
    expect(requestsEndingWith(refunded.fixture.snapshot().requests, '/submissions')).toHaveLength(
      1,
    );

    const resumable = fundedHouseFixture('house-resumable');
    resumable.fixture.holdLifecycleAt('settling');
    const held = settle(resumable.fixture, resumable.duelId, resumable.authorization);
    const committedHash = held.result?.resultHash;
    expect(held.status).toBe('settling');
    resumable.fixture.releaseLifecycle();
    expect(resumable.fixture.snapshot().duel).toMatchObject({
      result: { resultHash: committedHash },
      status: 'settled',
    });
    expect(requestsEndingWith(resumable.fixture.snapshot().requests, '/submissions')).toHaveLength(
      1,
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

function createHouseDuel(fixture: DuelJourneyFixture, authorization: string) {
  const response = fixture.handleApi({
    authorization,
    body: {
      creatorWallet: fixture.bootstrap().wallet.address,
      matchmakingMode: 'house',
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

function submitFunding(fixture: DuelJourneyFixture, duelId: string, authorization: string): void {
  const intent = fixture.handleApi({
    authorization,
    body: { action: 'fund', wallet: fixture.bootstrap().wallet.address },
    method: 'POST',
    path: `/duels/${duelId}/transactions`,
  }).body as { id: string };
  const submission = fixture.handleApi({
    authorization,
    body: { signature: 'fixture-signature' },
    method: 'POST',
    path: `/duels/${duelId}/transactions/${intent.id}/submissions`,
  });
  expect(submission.status).toBe(200);
}

function reconcileFunding(
  fixture: DuelJourneyFixture,
  duelId: string,
  authorization: string,
): void {
  const response = fixture.handleApi({
    authorization,
    body: {},
    method: 'POST',
    path: `/duels/${duelId}/transactions/reconciliation`,
  });
  expect(response.status).toBe(200);
  expect(fixture.snapshot().duel?.status).toBe('funded');
}

function fundedHouseFixture(seed: string): {
  authorization: string;
  duelId: string;
  fixture: DuelJourneyFixture;
} {
  const fixture = new DuelJourneyFixture(seed, { houseEnabled: true });
  const authorization = authenticate(fixture);
  const duel = createHouseDuel(fixture, authorization);
  submitFunding(fixture, duel.id, authorization);
  reconcileFunding(fixture, duel.id, authorization);
  return { authorization, duelId: duel.id, fixture };
}

function requestsEndingWith(requests: string[], suffix: string): string[] {
  return requests.filter((request) => request.endsWith(suffix));
}
