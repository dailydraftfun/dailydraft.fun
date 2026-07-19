import { describe, expect, test } from 'bun:test';
import {
  DuelApiRequestError,
  isRetryableDuelRequestError,
  requestAuthenticatedDuel,
  requestPrivateRematchOpponent,
} from './duel-client';

describe('authenticated duel client', () => {
  test('never refreshes participant state without the wallet session', async () => {
    const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ input, init });
      return Response.json({ id: 'duel_private', status: 'opening' });
    }) as typeof fetch;

    await requestAuthenticatedDuel(
      'https://api.example.test/v1',
      'duel_private',
      'session_secret',
      fetcher,
    );

    expect(requests).toEqual([
      {
        input: 'https://api.example.test/v1/duels/duel_private',
        init: {
          cache: 'no-store',
          headers: { authorization: 'Bearer session_secret' },
        },
      },
    ]);
  });
});

describe('private rematch opponent client', () => {
  test('sends an authenticated no-store request and returns only the opponent contract', async () => {
    const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ input, init });
      return Response.json({ side: 'opponent', wallet: 'opponent_wallet' });
    }) as typeof fetch;

    await expect(
      requestPrivateRematchOpponent(
        'https://api.example.test/v1',
        'duel/with spaces',
        'session_secret',
        fetcher,
      ),
    ).resolves.toEqual({ side: 'opponent', wallet: 'opponent_wallet' });
    expect(requests).toEqual([
      {
        input: 'https://api.example.test/v1/duels/duel%2Fwith%20spaces/rematch-opponent',
        init: {
          cache: 'no-store',
          headers: { authorization: 'Bearer session_secret' },
        },
      },
    ]);
  });

  test('preserves forbidden status so spectators differ from verification failures', async () => {
    const fetcher = (async () =>
      Response.json(
        { detail: 'Private rematch is unavailable for this wallet' },
        { status: 403 },
      )) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await requestPrivateRematchOpponent(
        'https://api.example.test/v1',
        'duel_private',
        'session_secret',
        fetcher,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DuelApiRequestError);
    expect(thrown).toMatchObject({ retryable: false, status: 403 });
  });

  test('retries only transient API and network failures', () => {
    expect(isRetryableDuelRequestError(new DuelApiRequestError('missing', 404))).toBe(false);
    expect(isRetryableDuelRequestError(new DuelApiRequestError('rate limited', 429))).toBe(true);
    expect(isRetryableDuelRequestError(new DuelApiRequestError('unavailable', 503))).toBe(true);
    expect(isRetryableDuelRequestError(new TypeError('network failed'))).toBe(true);
  });
});
