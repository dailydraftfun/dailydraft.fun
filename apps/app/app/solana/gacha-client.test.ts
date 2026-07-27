import { describe, expect, test } from 'bun:test';
import {
  claimGachaPaymentSignature,
  createGachaPaymentIntent,
  createGachaRip,
  createGachaSeedCommitment,
  GachaApiRequestError,
  type GachaCapability,
  getGachaCapability,
  getGachaInventory,
  getGachaOdds,
  isGachaRipAvailable,
  isRetryableGachaRequestError,
  isTerminalGachaExecutionFailure,
  parseGachaCapability,
  prepareGachaPaymentTransaction,
  requestClaimedGachaPaymentSignature,
  requestGachaCapability,
  requestGachaInventory,
  requestGachaOdds,
  requestGachaPaymentIntent,
  requestGachaRip,
  requestGachaSeedCommitment,
  requestPreparedGachaPaymentTransaction,
  requestVerifiedGachaPayment,
  ripIdempotencyKey,
  verifyGachaPayment,
} from './gacha-client';

const BASE_URL = 'https://api.example.test/v1';
const SESSION_TOKEN = 'session_secret';

const OPEN_GATES = { acquisition: true, odds: true, provider: true, settlement: true };

type RecordedRequest = { init?: RequestInit; input: string | URL | Request };

function recordingFetcher(body: unknown, init?: ResponseInit) {
  const requests: RecordedRequest[] = [];
  const fetcher = (async (input: string | URL | Request, requestInit?: RequestInit) => {
    requests.push({ init: requestInit, input });
    return Response.json(body, init);
  }) as typeof fetch;
  return { fetcher, requests };
}

describe('gacha capability client', () => {
  test('reads the capability without caching so a flipped gate lands immediately', async () => {
    const { fetcher, requests } = recordingFetcher({
      availability: 'playable',
      gates: OPEN_GATES,
      providerMode: 'dailydraft-devnet',
      reason: 'Devnet machine is open',
    });

    await expect(requestGachaCapability(BASE_URL, undefined, fetcher)).resolves.toMatchObject({
      availability: 'playable',
      providerMode: 'dailydraft-devnet',
    });
    expect(requests[0]?.input).toBe(`${BASE_URL}/gacha/capability`);
    expect(requests[0]?.init).toMatchObject({ cache: 'no-store' });
    expect(requests[0]?.init?.headers).toBeUndefined();
  });

  test('forwards the abort signal so an unmounted surface stops polling', async () => {
    const controller = new AbortController();
    const { fetcher, requests } = recordingFetcher({
      availability: 'preview',
      gates: { acquisition: false, odds: false, provider: false, settlement: false },
      providerMode: 'fixture',
      reason: 'Machine is closed',
    });

    await requestGachaCapability(BASE_URL, controller.signal, fetcher);

    expect(requests[0]?.init?.signal).toBe(controller.signal);
  });

  test('accepts the devnet provider mode the OpenAPI enum has not caught up to', () => {
    // openapi.yaml still enumerates providerMode as [collector-crypt, fixture].
    // Narrowing to that enum would reject the only mode this surface runs in.
    expect(
      parseGachaCapability({
        availability: 'playable',
        gates: OPEN_GATES,
        providerMode: 'dailydraft-devnet',
        reason: 'Devnet machine is open',
      }),
    ).toMatchObject({ providerMode: 'dailydraft-devnet' });
  });

  test('rejects a capability payload missing any gate', () => {
    for (const malformed of [
      null,
      'playable',
      { availability: 'open', gates: OPEN_GATES, providerMode: 'fixture', reason: 'ok' },
      { availability: 'playable', gates: { odds: true }, providerMode: 'fixture', reason: 'ok' },
      { availability: 'playable', gates: OPEN_GATES, providerMode: 'fixture' },
      { availability: 'playable', gates: OPEN_GATES, reason: 'ok' },
    ]) {
      expect(() => parseGachaCapability(malformed)).toThrow(
        'The Sports Pack Gacha capability response was malformed.',
      );
    }
  });

  test('fails shut when a gate is closed even though availability reads playable', () => {
    const playable: GachaCapability = {
      availability: 'playable',
      gates: { ...OPEN_GATES },
      providerMode: 'dailydraft-devnet',
      reason: 'Devnet machine is open',
    };

    expect(isGachaRipAvailable(playable)).toBe(true);
    for (const gate of ['acquisition', 'odds', 'provider', 'settlement'] as const) {
      expect(isGachaRipAvailable({ ...playable, gates: { ...OPEN_GATES, [gate]: false } })).toBe(
        false,
      );
    }
    expect(isGachaRipAvailable({ ...playable, availability: 'preview' })).toBe(false);
  });
});

describe('gacha machine reads', () => {
  test('escapes the machine key on the inventory and odds routes', async () => {
    const inventory = recordingFetcher({ contentHash: 'a'.repeat(64), entries: [] });
    const odds = recordingFetcher({ bandMinimums: { base: '0' }, version: 3 });

    await requestGachaInventory(BASE_URL, 'sports/pack one', undefined, inventory.fetcher);
    await requestGachaOdds(BASE_URL, 'sports/pack one', undefined, odds.fetcher);

    expect(inventory.requests[0]?.input).toBe(
      `${BASE_URL}/gacha/machines/sports%2Fpack%20one/inventory`,
    );
    expect(odds.requests[0]?.input).toBe(`${BASE_URL}/gacha/machines/sports%2Fpack%20one/odds`);
  });

  test('returns the sealed band minimums the reveal keys its tier off', async () => {
    const { fetcher } = recordingFetcher({
      bandMinimums: { base: '0', chase: '5000000', plus: '250000', premium: '1000000' },
      version: 3,
    });

    await expect(requestGachaOdds(BASE_URL, 'football', undefined, fetcher)).resolves.toMatchObject(
      { bandMinimums: { chase: '5000000' } },
    );
  });
});

describe('gacha payment client', () => {
  test('authenticates a seed commitment with the wallet session', async () => {
    const { fetcher, requests } = recordingFetcher({
      commitmentId: 'gachaseed_abc',
      expiresAt: '2026-07-26T00:15:00.000Z',
      serverSeedHash: 'b'.repeat(64),
    });

    await requestGachaSeedCommitment(BASE_URL, 'football', SESSION_TOKEN, fetcher);

    expect(requests[0]).toMatchObject({
      init: {
        body: '{}',
        headers: {
          authorization: `Bearer ${SESSION_TOKEN}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
      input: `${BASE_URL}/gacha/machines/football/rip-commitments`,
    });
  });

  test('refuses every mutation before fetch when the wallet session is missing', async () => {
    const { fetcher, requests } = recordingFetcher({});

    await expect(requestGachaSeedCommitment(BASE_URL, 'football', null, fetcher)).rejects.toThrow(
      'Authenticate the connected wallet before opening a Sports Pack.',
    );
    expect(requests).toEqual([]);
  });

  test('omits the idempotency header on every route that does not read one', async () => {
    const intent = recordingFetcher({ intentId: `gachapay_${'a'.repeat(32)}` });
    const prepared = recordingFetcher({ serializedTransactionBase64: 'AQ==' });
    const claimed = recordingFetcher({ signature: 'sig' });
    const verified = recordingFetcher({ mintVerifiedOnChain: true });

    await requestGachaPaymentIntent(
      BASE_URL,
      'football',
      'PayerWallet',
      SESSION_TOKEN,
      intent.fetcher,
    );
    await requestPreparedGachaPaymentTransaction(
      BASE_URL,
      'gachapay_1',
      SESSION_TOKEN,
      prepared.fetcher,
    );
    await requestClaimedGachaPaymentSignature(
      BASE_URL,
      'gachapay_1',
      'c2lnbmVk',
      SESSION_TOKEN,
      claimed.fetcher,
    );
    await requestVerifiedGachaPayment(
      BASE_URL,
      'gachapay_1',
      'sig',
      SESSION_TOKEN,
      verified.fetcher,
    );

    for (const recorded of [
      intent.requests[0],
      prepared.requests[0],
      claimed.requests[0],
      verified.requests[0],
    ]) {
      expect(recorded?.init?.headers).toEqual({
        authorization: `Bearer ${SESSION_TOKEN}`,
        'content-type': 'application/json',
      });
    }
    expect(intent.requests[0]?.init?.body).toBe(JSON.stringify({ payerWallet: 'PayerWallet' }));
    expect(claimed.requests[0]?.init?.body).toBe(
      JSON.stringify({ signedTransactionBase64: 'c2lnbmVk' }),
    );
    expect(claimed.requests[0]?.input).toBe(
      `${BASE_URL}/gacha/payment-intents/gachapay_1/signature`,
    );
    expect(verified.requests[0]?.init?.body).toBe(JSON.stringify({ signature: 'sig' }));
    expect(prepared.requests[0]?.input).toBe(
      `${BASE_URL}/gacha/payment-intents/gachapay_1/transaction`,
    );
  });
});

describe('gacha rip client', () => {
  test('keys idempotency off the seed commitment so a retried submit resolves the same rip', async () => {
    const { fetcher, requests } = recordingFetcher({ rip: { id: 'gacharip_1' }, serverSeed: null });

    await requestGachaRip(
      BASE_URL,
      {
        commitmentId: 'gachaseed_abc',
        machineKey: 'football',
        oddsVersion: 2,
        paymentIntentId: 'gachapay_xyz',
        recipientWallet: 'RecipientWallet',
        seed: 'client-seed-0123456789',
      },
      SESSION_TOKEN,
      fetcher,
    );

    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: `Bearer ${SESSION_TOKEN}`,
      'idempotency-key': 'opd-rip-gachaseed_abc',
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      commitmentId: 'gachaseed_abc',
      idempotencyKey: 'opd-rip-gachaseed_abc',
      machineKey: 'football',
      oddsVersion: 2,
      paymentIntentId: 'gachapay_xyz',
      recipientWallet: 'RecipientWallet',
      seed: 'client-seed-0123456789',
    });
    expect(ripIdempotencyKey('gachaseed_abc')).toBe('opd-rip-gachaseed_abc');
  });

  test('omits the optional rip fields rather than sending them as null', async () => {
    const { fetcher, requests } = recordingFetcher({ rip: { id: 'gacharip_1' } });

    await requestGachaRip(
      BASE_URL,
      {
        commitmentId: 'gachaseed_abc',
        machineKey: 'football',
        recipientWallet: 'RecipientWallet',
        seed: 'client-seed-0123456789',
      },
      SESSION_TOKEN,
      fetcher,
    );

    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).not.toHaveProperty('oddsVersion');
    expect(body).not.toHaveProperty('paymentIntentId');
  });
});

describe('gacha request errors', () => {
  test('surfaces the problem detail so a closed machine explains itself', async () => {
    const fetcher = (async () =>
      Response.json(
        { detail: 'Gacha rip requires a verified payment intent' },
        { status: 409 },
      )) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await requestGachaSeedCommitment(BASE_URL, 'football', SESSION_TOKEN, fetcher);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GachaApiRequestError);
    expect(thrown).toMatchObject({
      message: 'Gacha rip requires a verified payment intent',
      retryable: false,
      status: 409,
    });
  });

  test('falls back to the status when the response carries no problem document', async () => {
    const fetcher = (async () =>
      new Response('<html>gateway</html>', { status: 502 })) as unknown as typeof fetch;

    await expect(
      requestGachaSeedCommitment(BASE_URL, 'football', SESSION_TOKEN, fetcher),
    ).rejects.toThrow('The Sports Pack Gacha request failed (502).');
  });

  test('retries only transient API and network failures', () => {
    expect(isRetryableGachaRequestError(new GachaApiRequestError('conflict', 409))).toBe(false);
    expect(isRetryableGachaRequestError(new GachaApiRequestError('rate limited', 429))).toBe(true);
    expect(isRetryableGachaRequestError(new GachaApiRequestError('unavailable', 503))).toBe(true);
    expect(isRetryableGachaRequestError(new TypeError('network failed'))).toBe(true);
  });

  test('recognizes only the server terminal execution verdict that safely releases an intent', () => {
    expect(
      isTerminalGachaExecutionFailure(
        new GachaApiRequestError('TRANSACTION_EXECUTION_ERROR: transfer failed', 409),
      ),
    ).toBe(true);
    expect(
      isTerminalGachaExecutionFailure(new GachaApiRequestError('SIGNATURE_MISMATCH', 409)),
    ).toBe(false);
    expect(
      isTerminalGachaExecutionFailure(new GachaApiRequestError('TRANSACTION_EXECUTION_ERROR', 503)),
    ).toBe(false);
    expect(isTerminalGachaExecutionFailure(new TypeError('network failed'))).toBe(false);
  });
});

describe('configured base URL', () => {
  // `NEXT_PUBLIC_DUEL_API_URL` is unset under `bun test`, so every convenience
  // wrapper fails shut on the same guard rather than firing a request at
  // `undefined/gacha/...`. Asserting all nine keeps a new endpoint from
  // silently skipping the check.
  const wrappers: [string, () => Promise<unknown>][] = [
    ['getGachaCapability', () => getGachaCapability()],
    ['getGachaInventory', () => getGachaInventory('football')],
    ['getGachaOdds', () => getGachaOdds('football')],
    ['createGachaSeedCommitment', () => createGachaSeedCommitment('football', SESSION_TOKEN)],
    [
      'createGachaPaymentIntent',
      () => createGachaPaymentIntent('football', 'payer', SESSION_TOKEN),
    ],
    [
      'prepareGachaPaymentTransaction',
      () => prepareGachaPaymentTransaction('gachaintent_1', SESSION_TOKEN),
    ],
    [
      'claimGachaPaymentSignature',
      () => claimGachaPaymentSignature('gachaintent_1', 'c2lnbmVk', SESSION_TOKEN),
    ],
    ['verifyGachaPayment', () => verifyGachaPayment('gachaintent_1', 'signature', SESSION_TOKEN)],
    [
      'createGachaRip',
      () =>
        createGachaRip(
          {
            commitmentId: 'gachaseed_1',
            machineKey: 'football',
            recipientWallet: 'payer',
            seed: 'f'.repeat(64),
          },
          SESSION_TOKEN,
        ),
    ],
  ];

  test.each(wrappers)('%s refuses to call an unconfigured API', async (_name, call) => {
    await expect(call()).rejects.toThrow('The Sports Pack Gacha API is not configured.');
  });
});
