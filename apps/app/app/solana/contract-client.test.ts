import { describe, expect, test } from 'bun:test';
import { contractFixtures, contractValues, OPENAPI_CONTRACT_VERSION } from '@dailydraft/contracts';

import {
  DuelApiRequestError,
  requestAuthenticatedDuel,
  requestCreateDuel,
  requestPreparedDuelIntent,
} from './duel-client';
import {
  createWalletSession,
  createWalletSessionAt,
  requestWalletChallenge,
  requestWalletChallengeAt,
  revokeWalletSession,
  validateWalletSession,
  validateWalletSessionAt,
} from './wallet-auth-client';

const baseUrl = 'https://api.example.test/v1';

describe('app contract client', () => {
  test('uses the shared wallet authentication request and response fixtures', async () => {
    const requests: Request[] = [];
    const responses = [
      contractFixtures.walletAuthentication.challengeResponse,
      contractFixtures.walletAuthentication.sessionResponse,
      {
        network: contractFixtures.walletAuthentication.sessionResponse.network,
        wallet: contractFixtures.walletAuthentication.sessionResponse.wallet,
      },
    ];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json(responses[requests.length - 1]);
    }) as typeof fetch;

    const challenge = await requestWalletChallengeAt(
      baseUrl,
      contractValues.creatorWallet,
      fetcher,
    );
    const session = await createWalletSessionAt(
      baseUrl,
      challenge,
      Uint8Array.from([1, 2, 3, 4]),
      fetcher,
    );
    const identity = await validateWalletSessionAt(baseUrl, session.token, fetcher);

    expect(challenge).toEqual(contractFixtures.walletAuthentication.challengeResponse);
    expect(session).toEqual(contractFixtures.walletAuthentication.sessionResponse);
    expect(identity).toEqual({
      network: session.network,
      wallet: session.wallet,
    });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['POST', `${baseUrl}/auth/challenges`],
      ['POST', `${baseUrl}/auth/sessions`],
      ['GET', `${baseUrl}/auth/session`],
    ]);
    expect(await requests[0]?.json()).toEqual(
      contractFixtures.walletAuthentication.challengeRequest,
    );
    expect(await requests[1]?.json()).toEqual(contractFixtures.walletAuthentication.sessionRequest);
    expect(requests[2]?.headers.get('authorization')).toBe(`Bearer ${session.token}`);
    expect(requests[2]?.cache).toBe('no-store');
  });

  test('keeps create, status, and transaction preparation auth and idempotency aligned', async () => {
    const requests: Request[] = [];
    const responses = [
      contractFixtures.duelStatus.response,
      contractFixtures.duelStatus.response,
      contractFixtures.transactionPreparation.response,
    ];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json(responses[requests.length - 1]);
    }) as typeof fetch;

    const created = await requestCreateDuel(
      baseUrl,
      contractFixtures.createDuel.request,
      contractValues.sessionToken,
      contractValues.idempotencyKey,
      fetcher,
    );
    const current = await requestAuthenticatedDuel(
      baseUrl,
      contractValues.duelId,
      contractValues.sessionToken,
      fetcher,
    );
    const prepared = await requestPreparedDuelIntent(
      baseUrl,
      contractValues.duelId,
      contractValues.creatorWallet,
      contractValues.sessionToken,
      contractValues.idempotencyKey,
      fetcher,
    );

    expect(created.version).toBe(contractFixtures.duelStatus.response.version);
    expect(current).toEqual(contractFixtures.duelStatus.response);
    expect(prepared).toEqual({
      ...contractFixtures.transactionPreparation.response,
      warnings: [...contractFixtures.transactionPreparation.response.warnings],
    });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['POST', `${baseUrl}/duels`],
      ['GET', `${baseUrl}/duels/${contractValues.duelId}`],
      ['POST', `${baseUrl}/duels/${contractValues.duelId}/transactions`],
    ]);
    expect(
      requests.every(
        (request) =>
          request.headers.get('authorization') === `Bearer ${contractValues.sessionToken}`,
      ),
    ).toBe(true);
    expect(requests[0]?.headers.get('idempotency-key')).toBe(contractValues.idempotencyKey);
    expect(requests[1]?.headers.get('idempotency-key')).toBeNull();
    expect(requests[2]?.headers.get('idempotency-key')).toBe(contractValues.idempotencyKey);
    expect(await requests[0]?.json()).toEqual(contractFixtures.createDuel.request);
    expect(await requests[2]?.json()).toEqual(contractFixtures.transactionPreparation.request);
  });

  test('distinguishes a revoked wallet session from a validation outage', async () => {
    for (const status of [401, 403]) {
      const fetcher = (async () => new Response(null, { status })) as unknown as typeof fetch;
      expect(
        await validateWalletSessionAt(baseUrl, contractValues.sessionToken, fetcher),
      ).toBeNull();
    }

    const detailedFailure = (async () =>
      Response.json(
        { detail: 'Session store unavailable.' },
        { status: 503 },
      )) as unknown as typeof fetch;
    await expect(
      validateWalletSessionAt(baseUrl, contractValues.sessionToken, detailedFailure),
    ).rejects.toThrow('Session store unavailable.');

    const bareFailure = (async () =>
      new Response(null, { status: 500 })) as unknown as typeof fetch;
    await expect(
      validateWalletSessionAt(baseUrl, contractValues.sessionToken, bareFailure),
    ).rejects.toThrow('Wallet authentication failed (500).');
  });

  test('fails public wallet authentication calls closed when the API is unconfigured', async () => {
    await expect(requestWalletChallenge(contractValues.creatorWallet)).rejects.toThrow(
      'Wallet authentication is unavailable',
    );
    await expect(
      createWalletSession(
        contractFixtures.walletAuthentication.challengeResponse,
        Uint8Array.from([1, 2, 3, 4]),
      ),
    ).rejects.toThrow('Wallet authentication is unavailable');
    await expect(validateWalletSession(contractValues.sessionToken)).rejects.toThrow(
      'Wallet authentication is unavailable',
    );
    await expect(revokeWalletSession(contractValues.sessionToken)).resolves.toBeUndefined();
  });

  test('preserves detailed and fallback errors for challenge and session creation', async () => {
    const detailedFailure = (async () =>
      Response.json(
        { detail: 'Challenge store unavailable.' },
        { status: 503 },
      )) as unknown as typeof fetch;
    await expect(
      requestWalletChallengeAt(baseUrl, contractValues.creatorWallet, detailedFailure),
    ).rejects.toThrow('Challenge store unavailable.');

    const bareFailure = (async () =>
      new Response(null, { status: 500 })) as unknown as typeof fetch;
    await expect(
      createWalletSessionAt(
        baseUrl,
        contractFixtures.walletAuthentication.challengeResponse,
        Uint8Array.from([1, 2, 3, 4]),
        bareFailure,
      ),
    ).rejects.toThrow('Wallet authentication failed (500).');
  });

  test('uses the platform fetcher when no wallet auth fetcher is injected', async () => {
    const originalFetch = globalThis.fetch;
    const responses = [
      contractFixtures.walletAuthentication.challengeResponse,
      contractFixtures.walletAuthentication.sessionResponse,
      {
        network: contractFixtures.walletAuthentication.sessionResponse.network,
        wallet: contractFixtures.walletAuthentication.sessionResponse.wallet,
      },
    ];
    let responseIndex = 0;
    globalThis.fetch = (async () =>
      Response.json(responses[responseIndex++])) as unknown as typeof fetch;

    try {
      const challenge = await requestWalletChallengeAt(baseUrl, contractValues.creatorWallet);
      const session = await createWalletSessionAt(
        baseUrl,
        challenge,
        Uint8Array.from([1, 2, 3, 4]),
      );
      expect(await validateWalletSessionAt(baseUrl, session.token)).toEqual({
        network: session.network,
        wallet: session.wallet,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('preserves shared problem detail and API version semantics', async () => {
    const fetcher = (async () =>
      Response.json(contractFixtures.problem.response, {
        status: contractFixtures.problem.response.status,
      })) as unknown as typeof fetch;

    const error = await requestAuthenticatedDuel(
      baseUrl,
      contractValues.duelId,
      contractValues.sessionToken,
      fetcher,
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(DuelApiRequestError);
    expect(error).toMatchObject({
      message: contractFixtures.problem.response.detail,
      retryable: false,
      status: contractFixtures.problem.response.status,
    });
    expect(contractFixtures.health.response.version).toBe(OPENAPI_CONTRACT_VERSION);
    expect(contractFixtures.publicProof.response.schemaVersion).toBe('dailydraft.receipt.v1');
  });
});
